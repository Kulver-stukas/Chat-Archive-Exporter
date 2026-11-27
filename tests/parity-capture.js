/* Deterministic functional snapshot. Only synthetic data. Run with the path to
 * a complete extension source tree; do not regenerate the baseline to accept
 * changes during a parity refactor. ZIP comparison uses names + decompressed
 * bytes, not variable container timestamps or compression metadata. */
'use strict';
process.env.TZ='UTC';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const base=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const {createEnvironment}=require(path.join(base,'tests/manual-fixtures.js'));
const {createLibraryEnvironment}=require(path.join(base,'tests/library-job-fixtures.js'));
function rawChat(e){
  const id=e.chat(1).id,upload='file_00000000000000000000000000000001',image='file_00000000000000000000000000000002';
  const raw={id,title:'Parity example',create_time:1793577600,update_time:1793577700,current_node:'a1',gizmo_id:e.pid,mapping:{}};
  function node(id,parent,role,content,metadata={}){
    raw.mapping[id]={id,parent,children:[],message:{id,author:{role},content,metadata,create_time:1793577600}};
    if(parent)raw.mapping[parent].children.push(id);
  }
  node('q1',null,'user',{content_type:'multimodal_text',parts:['Question: \\(x+1\\)',{content_type:'image_asset_pointer',asset_pointer:'sediment://'+upload}]},{attachments:[{id:upload,name:'Reference.png',mime_type:'image/png'}]});
  node('t1','q1','assistant',{content_type:'thoughts',thoughts:[{summary:'Visible summary',content:'Example'}]});
  node('i1','t1','tool',{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'sediment://'+image}]},{image_gen_title:'Generated illustration'});
  node('a1','i1','assistant',{content_type:'text',parts:['Answer and [reference](https://example.org/example).']},{model_slug:'fixture-model'});
  return {raw,upload,image};
}
function unpack(bytes,crc){
  const b=Buffer.from(bytes),files={};let offset=0;
  while(offset+4<=b.length&&b.readUInt32LE(offset)===0x04034b50){
    const method=b.readUInt16LE(offset+8),checksum=b.readUInt32LE(offset+14),packed=b.readUInt32LE(offset+18),size=b.readUInt32LE(offset+22),n=b.readUInt16LE(offset+26),extra=b.readUInt16LE(offset+28),name=b.subarray(offset+30,offset+30+n).toString('utf8'),start=offset+30+n+extra,data=b.subarray(start,start+packed);
    const out=method===8?zlib.inflateRawSync(data):data;assert.equal(out.length,size);assert.equal(crc(out),checksum);assert(!Object.hasOwn(files,name));files[name]=out.toString('base64');offset=start+packed;
  }
  assert.equal(b.readUInt32LE(offset),0x02014b50);return files;
}
async function output(e,id){
  let listener;const world={console,Blob,URL,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Response,CompressionStream,Date,setTimeout,ChatArchiveManualStore:e.S,ChatArchivePaths:e.box.ChatArchivePaths,chrome:{runtime:{id:'self',onMessage:{addListener:f=>listener=f}}}};
  vm.createContext(world);for(const f of ['hash','zip','manual-output'])vm.runInContext(fs.readFileSync(path.join(base,'lib',f+'.js'),'utf8'),world);
  const command=(type)=>new Promise(resolve=>assert.equal(listener({target:'cae-manual-output',type,jobId:id},{id:'self'},resolve),true));
  const reply=await command('CAE_MANUAL_PREPARE');assert(reply.ok,reply.error);
  const bytes=new Uint8Array(await(await fetch(reply.result.url)).arrayBuffer());await command('CAE_MANUAL_RELEASE');
  return {filename:reply.result.filename,files:unpack(bytes,world.ChatArchiveZip.crc32)};
}
async function snapshotFiles(dir,prefix='',out={}){for(const [name,item]of [...dir.children.entries()].sort(([a],[b])=>a.localeCompare(b))){const key=prefix+name;if(item.children)await snapshotFiles(item,key+'/',out);else out[key]=Buffer.from(await(await item.getFile()).arrayBuffer()).toString('base64');}return out;}
(async()=>{
  const e=createEnvironment(),{raw,upload,image}=rawChat(e),N=e.box.ChatArchiveNormalize,E=e.box.ChatArchiveExportSelection;
  const chat=N.normalizeChat(raw,{project:'Project test'}),info={workspace:'Workspace test',exportedAt:'2026-11-12T02:00:00Z',timeZone:'UTC'};
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kJ3sAAAAASUVORK5CYII=','base64'));
  e.normalizedChats.set(chat.id,chat);e.blobs.set(upload,png);e.blobs.set(image,png);e.downloadState='in_progress';
  const selection={...E.DEFAULTS,completeConversation:false,conversationId:chat.id,branchNode:'a1',messageIds:['q1','t1','i1','a1']};
  const o=e.opts('parity-selected-export-00001',[e.chat(1)],'download','current');o.exportSelection=selection;
  await e.submit(o);assert.equal((await e.drain()).status,'download_pending');const zip=await output(e,o.requestId);
  const v=createEnvironment();v.normalizedChats.set(chat.id,chat);const vo=v.opts('parity-vault-export-00001',[v.chat(1)],'vault','current');await v.submit(vo);assert.equal((await v.drain()).status,'completed');
  const vault=await snapshotFiles(v.root);assert(Object.keys(vault).some(p=>p.endsWith('.workspace.json')),'workspace index included');
  const lib=createLibraryEnvironment(),I=lib.box.ChatArchiveLibraryInventory;
  const nodes=[I.fromNode(lib.node(1,'Reference.png',{mime_type:'image/png'})),I.fromNode(lib.node(2,'Notes.md'))];
  const images=[I.fromImage(lib.image(1))],details=new Map([[lib.node(1).file_id,I.fromDetail({use_case:'my_files'})]]);
  const catalog=I.linkCatalog(I.buildCatalog(nodes,images,details),[lib.ref(2),lib.ref(3)]);
  const snapshot={normalized:chat,fullMarkdown:N.renderMarkdown(chat,info),selectedMarkdown:N.renderMarkdown(chat,{...info,exportSelection:{...selection,uploadedFiles:false,generatedFiles:false}}),zip,vault,catalog};
  process.stdout.write(JSON.stringify(snapshot,null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
