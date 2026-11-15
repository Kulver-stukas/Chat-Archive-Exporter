'use strict';
// Real staged Blobs + real ZIP output; extension messaging and IDB are simulated.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment();e.downloadState='in_progress';
 const bytes=Uint8Array.from([0,255,195,40,13,10,128,1]);e.blobs.set('file-raw',bytes);
 e.context={projects_complete:true,warnings:[],projects:[{gizmo:{id:e.pid,display:{name:'Project test'}},files:[
  {file_id:'file-raw',name:'raw.pdf',size:bytes.length,type:'application/pdf'}],connectors:[]}]};
 const o=e.opts('job-offscreen-12345',[e.chat(1)],'download');await e.submit(o);await e.drain();
 let listener;const world={console,Blob,URL,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Response,CompressionStream,Date,setTimeout,
  ChatArchiveManualStore:e.S,ChatArchivePaths:e.box.ChatArchivePaths,
  chrome:{runtime:{id:'self',onMessage:{addListener:f=>listener=f}}}};
 vm.createContext(world);
 for(const f of ['zip','manual-output'])vm.runInContext(fs.readFileSync(__dirname+'/../lib/'+f+'.js','utf8'),world);
 const command=(type,id=o.requestId)=>new Promise(resolve=>assert.equal(listener({target:'cae-manual-output',type,jobId:id},{id:'self'},resolve),true));
 let r=await command('CAE_MANUAL_PREPARE');assert.equal(r.ok,true);assert(r.result.filename.endsWith('.zip'));
 const url=r.result.url;assert.equal((await command('CAE_MANUAL_PREPARE')).result.url,url,'prepare idempotent');
 const zip=new Uint8Array(await (await fetch(url)).arrayBuffer());
 fs.writeFileSync('/tmp/cae-manual-offscreen.zip',zip);
 // ZIP CRC/UTF-8 and source bytes are additionally checked by Python in packaging.
 assert.equal(new DataView(zip.buffer).getUint32(0,true),0x04034b50);
 assert.equal(listener({target:'cae-manual-output',type:'CAE_MANUAL_PREPARE',jobId:o.requestId},{id:'self',tab:{id:1}},()=>{}),false);
 assert.equal(listener({target:'cae-manual-output',type:'CAE_MANUAL_PREPARE',jobId:o.requestId},{id:'other'},()=>{}),false);
 await command('CAE_MANUAL_RELEASE');await assert.rejects(fetch(url),'released object URL revoked');
 // Cancellation report replaces the same path, not a duplicate ZIP member.
 const j=await e.S.get(o.requestId);j.cancel_requested=true;
 await e.S.stage(j,'partial-report','ChatGPT/Workspace test/_archive_report.md',new Blob(['PARTIAL EXPORT']),{store:false});
 r=await command('CAE_MANUAL_PREPARE');assert(r.result.filename.includes('-partial.zip'));
 fs.writeFileSync('/tmp/cae-manual-partial.zip',new Uint8Array(await(await fetch(r.result.url)).arrayBuffer()));
 await command('CAE_MANUAL_RELEASE');
 // New job already staged as a single .md. No accidental ZIP wrapping.
 j.id='job-single-output-12345';j.mode='current';j.staged_bytes=0;j.cancel_requested=false;j.items=[e.chat(1)];await e.S.put(j);
 await e.S.stage(j,'chat:'+e.chat(1).id,'ChatGPT/Workspace test/chat.md',new Blob(['## Prompt:\nExact $x$\n']),{store:false});
 r=await command('CAE_MANUAL_PREPARE',j.id);assert.equal(r.result.filename,'chat.md');assert.equal(await(await fetch(r.result.url)).text(),'## Prompt:\nExact $x$\n');
 await command('CAE_MANUAL_RELEASE',j.id);
 console.log('PASS: offscreen actual ZIP and Markdown Blob assembly, idempotent URL, partial report replacement, release, sender isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
