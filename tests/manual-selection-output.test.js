'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
const {createEnvironment}=require('./manual-fixtures');
const E=require('../lib/export-selection');
function fixture(e,id,selection={}){
  const cid=e.chat(1).id,raw={id:cid,title:'Selected output',branchNode:'a2',created:'2026-11-01T00:00:00Z',updated:'2026-11-02T00:00:00Z',warnings:[],messages:[
    {id:'q1',role:'user',content:'CHOSEN QUESTION',textContent:'CHOSEN QUESTION',attachments:[
      {key:'file:file_upload',fileId:'file_upload',sandboxPath:null,name:'upload.bin',origin:'uploaded',messageId:'q1',sizeBytes:4}]},
    {id:'a1',role:'assistant',content:'CHOSEN ANSWER',textContent:'CHOSEN ANSWER',attachments:[
      {key:'file:file_generated',fileId:'file_generated',sandboxPath:null,name:'generated.txt',origin:'generated',messageId:'a1',sizeBytes:10}]},
    {id:'q2',role:'user',content:'PRIVATE UNSELECTED QUESTION',textContent:'PRIVATE UNSELECTED QUESTION',attachments:[]},
    {id:'a2',role:'assistant',content:'PRIVATE UNSELECTED ANSWER',textContent:'PRIVATE UNSELECTED ANSWER',attachments:[]}
  ]};
  e.normalizedChats.set(cid,raw);e.downloadState='in_progress';
  e.blobs.set('file_upload',Uint8Array.from([0,128,255,17]));e.blobs.set('file_generated',new TextEncoder().encode('plain text'));
  const o=e.opts(id,[e.chat(1)],'download','current');
  o.exportSelection={...E.DEFAULTS,completeConversation:false,conversationId:cid,branchNode:'a2',messageIds:['q1','a1'],...selection};
  return o;
}
function offscreen(e){
  let listener;
  const world={console,Blob,URL,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Response,CompressionStream,Date,setTimeout,
    ChatArchiveManualStore:e.S,ChatArchivePaths:e.box.ChatArchivePaths,
    chrome:{runtime:{id:'self',onMessage:{addListener:f=>listener=f}}}};
  vm.createContext(world);
  for(const f of ['hash','zip','manual-output'])vm.runInContext(fs.readFileSync(__dirname+'/../lib/'+f+'.js','utf8'),world);
  const command=(type,id)=>new Promise(resolve=>assert.equal(listener({target:'cae-manual-output',type,jobId:id},{id:'self'},resolve),true));
  return {world,command};
}
function unpack(bytes,crc){
  const b=Buffer.from(bytes),files=new Map();let offset=0;
  while(offset+4<=b.length&&b.readUInt32LE(offset)===0x04034b50){
    const method=b.readUInt16LE(offset+8),checksum=b.readUInt32LE(offset+14),packed=b.readUInt32LE(offset+18),size=b.readUInt32LE(offset+22),
      nameLength=b.readUInt16LE(offset+26),extra=b.readUInt16LE(offset+28),name=b.subarray(offset+30,offset+30+nameLength).toString('utf8'),
      start=offset+30+nameLength+extra,data=b.subarray(start,start+packed);
    assert([0,8].includes(method));const out=method===8?zlib.inflateRawSync(data):data;
    assert.equal(out.length,size);assert.equal(crc(out),checksum);assert(!files.has(name));files.set(name,out);offset=start+packed;
  }
  assert.equal(b.readUInt32LE(offset),0x02014b50,'ZIP central directory is present');return files;
}
(async()=>{
  // Current selection without original-file categories is a genuine .md Blob.
  let e=createEnvironment(),o=fixture(e,'job-selected-output-md-12345',{uploadedFiles:false,generatedFiles:false});
  await e.submit(o);let j=await e.drain();assert.equal(j.status,'download_pending',JSON.stringify(j));
  let runtime=offscreen(e),reply=await runtime.command('CAE_MANUAL_PREPARE',o.requestId);
  assert.equal(reply.ok,true);assert(reply.result.filename.endsWith('.md'));
  let content=await(await fetch(reply.result.url)).text();assert(content.startsWith('---\n'));
  assert(content.includes('CHOSEN QUESTION')&&content.includes('CHOSEN ANSWER'));
  assert(!content.includes('PRIVATE UNSELECTED')&&!content.includes('upload.bin')&&!content.includes('_selection_snapshot'));
  assert.equal(e.calls.filter(c=>c.type==='CAE_ATTACHMENT_START').length,0);
  await runtime.command('CAE_MANUAL_RELEASE',o.requestId);

  // Real ZIP preserves binary bytes; its only members are selected MD, originals and report.
  e=createEnvironment();o=fixture(e,'job-selected-output-zip-12345');await e.submit(o);j=await e.drain();assert.equal(j.status,'download_pending');
  runtime=offscreen(e);reply=await runtime.command('CAE_MANUAL_PREPARE',o.requestId);
  assert.equal(reply.ok,true);assert(reply.result.filename.endsWith('.zip'));
  const url=reply.result.url;assert.equal((await runtime.command('CAE_MANUAL_PREPARE',o.requestId)).result.url,url);
  let files=unpack(new Uint8Array(await(await fetch(url)).arrayBuffer()),runtime.world.ChatArchiveZip.crc32);
  assert.equal(files.size,4);assert(![...files.keys()].some(p=>p.includes('snapshot')||p.startsWith('ChatGPT/')));
  assert.deepEqual(files.get('attachments/Uploaded/upload.bin'),Buffer.from([0,128,255,17]));
  assert.equal(files.get('attachments/Generated/generated.txt').toString(),'plain text');
  const mdPath=[...files.keys()].find(p=>p.endsWith('.md'));assert(mdPath);content=files.get(mdPath).toString();
  assert(content.includes('](<attachments/Uploaded/upload.bin>)'));
  assert(content.includes('](<attachments/Generated/generated.txt>)'));
  assert(!content.includes('PRIVATE UNSELECTED'));
  let report=JSON.parse(files.get('export-report.json').toString());
  assert.equal(report.partial,false);assert.equal(report.counts.saved,2);assert.equal(report.files.length,2);
  assert.deepEqual(report.selection.messageIds,['q1','a1']);
  for(const data of files.values())assert(!data.toString().includes('PRIVATE UNSELECTED'),'checkpoint content must not leak into exported files');
  await runtime.command('CAE_MANUAL_RELEASE',o.requestId);await assert.rejects(fetch(url));

  // End-to-end image-only assistant reply: normalize the actual tool output,
  // transfer exact image bytes, infer extension from bytes when MIME is generic,
  // and deliver ZIP (not a misleading plain MD).
  e=createEnvironment();const imageId='file_00000000000000000000000000000003';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kJ3sAAAAASUVORK5CYII=','base64');
  const imageChat=e.box.ChatArchiveNormalize.normalizeChat({id:e.chat(1).id,title:'Image conversation',current_node:'image1',mapping:{
    q1:{id:'q1',parent:null,children:['image1'],message:{author:{role:'user'},content:{content_type:'text',parts:['Generate a drawing']}}},
    image1:{id:'image1',parent:'q1',children:[],message:{author:{role:'tool'},metadata:{image_gen_title:'An illustration'},
      content:{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'sediment://'+imageId}]}}}
  }});
  e.normalizedChats.set(imageChat.id,imageChat);e.blobs.set(imageId,Uint8Array.from(png));e.downloadState='in_progress';
  o=e.opts('job-selected-image-output-12345',[e.chat(1)],'download','current');
  o.exportSelection={...E.DEFAULTS,completeConversation:false,conversationId:imageChat.id,branchNode:'image1',messageIds:['q1','image1']};
  await e.submit(o);j=await e.drain();assert.equal(j.status,'download_pending',JSON.stringify(j));
  runtime=offscreen(e);reply=await runtime.command('CAE_MANUAL_PREPARE',o.requestId);
  assert.equal(reply.ok,true);assert(reply.result.filename.endsWith('.zip'));
  files=unpack(new Uint8Array(await(await fetch(reply.result.url)).arrayBuffer()),runtime.world.ChatArchiveZip.crc32);
  assert.deepEqual(files.get('attachments/Generated/An illustration.png'),png);
  content=files.get([...files.keys()].find(p=>p.endsWith('.md'))).toString();
  assert(content.includes('attachments/Generated/An%20illustration.png'));
  report=JSON.parse(files.get('export-report.json'));assert.equal(report.counts.saved,1);
  assert.equal(report.files[0].localPath,'attachments/Generated/An illustration.png');
  assert.equal(e.calls.filter(c=>c.type==='CAE_ATTACHMENT_START').length,1);
  await runtime.command('CAE_MANUAL_RELEASE',o.requestId);

  // Unavailable originals retain an explicit report and never create misleading links.
  e=createEnvironment();o=fixture(e,'job-selected-output-unavailable-12345');e.blobs.clear();
  await e.submit(o);j=await e.drain();assert.equal(j.status,'download_pending');
  runtime=offscreen(e);reply=await runtime.command('CAE_MANUAL_PREPARE',o.requestId);assert.equal(reply.ok,true);
  files=unpack(new Uint8Array(await(await fetch(reply.result.url)).arrayBuffer()),runtime.world.ChatArchiveZip.crc32);
  assert.equal(files.size,2);assert(![...files.keys()].some(p=>p.startsWith('attachments/')));
  content=files.get([...files.keys()].find(p=>p.endsWith('.md'))).toString();assert(!content.includes('](<attachments/'));assert(content.includes('unavailable'));
  report=JSON.parse(files.get('export-report.json'));assert.equal(report.counts.unavailable,2);
  await runtime.command('CAE_MANUAL_RELEASE',o.requestId);

  // Stop after a captured snapshot gives a marked partial bundle without fetching originals.
  e=createEnvironment();o=fixture(e,'job-selected-output-partial-12345');await e.submit(o);
  e.onCall=async type=>{if(type==='CAE_GET_CHAT')await e.C.cancel(o.requestId);};
  j=await e.drain();assert.equal(j.status,'download_pending');
  runtime=offscreen(e);reply=await runtime.command('CAE_MANUAL_PREPARE',o.requestId);assert.equal(reply.ok,true);assert(reply.result.filename.endsWith('-partial.zip'));
  files=unpack(new Uint8Array(await(await fetch(reply.result.url)).arrayBuffer()),runtime.world.ChatArchiveZip.crc32);
  assert.equal(files.size,2);report=JSON.parse(files.get('export-report.json'));assert.equal(report.partial,true);assert.equal(report.counts.cancelled,2);
  assert.equal(e.calls.filter(c=>c.type==='CAE_ATTACHMENT_START').length,0);
  await runtime.command('CAE_MANUAL_RELEASE',o.requestId);
  console.log('PASS: selected .md delivery and actual ZIP members/CRC/bytes, unavailable reports, partial output, idempotent object URLs and internal-checkpoint exclusion');
})().catch(e=>{console.error(e);process.exitCode=1;});
