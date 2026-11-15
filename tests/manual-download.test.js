'use strict';
const assert=require('node:assert/strict');const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 let e=createEnvironment();e.downloadState='in_progress';let o=e.opts('job-download-12345',[e.chat(1),e.chat(2)],'download');await e.submit(o);
 let j=await e.drain();assert.equal(j.status,'download_pending');assert.equal(e.downloads.length,1);
 assert((await e.S.entries(o.requestId)).length>=3,'staged files survive until download actually completes');
 const bodyCalls=e.calls.filter(x=>x.type==='CAE_GET_CHAT').length;
 e.reload();await e.C.startup();await e.C.tick();assert.equal(e.downloads.length,1,'restart must not duplicate delivery');
 assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,bodyCalls);
 e.downloads[0].state='complete';await e.C.downloadChanged({id:1,state:{current:'complete'}});
 j=await e.C.inspect();assert.equal(j.active,false);assert.equal((await e.S.entries(o.requestId)).length,0);
 // Crash after download API accepted it but before ID checkpoint. Recover by blob URL.
 e=createEnvironment();e.downloadState='in_progress';o=e.opts('job-ambiguous-12345',[e.chat(1)],'download','current');await e.submit(o);await e.drain();
 let raw=await e.S.get(o.requestId);raw.download_id=null;raw.status='download_starting';await e.S.put(raw);
 e.reload();await e.C.tick();assert.equal((await e.C.inspect()).status,'download_pending');assert.equal(e.downloads.length,1);
 // If history is gone, do not blindly reissue; ask for an explicit delivery retry.
 raw=await e.S.get(o.requestId);raw.download_id=null;raw.status='download_starting';await e.S.put(raw);e.downloads.length=0;e.reload();await e.C.tick();
 assert.equal((await e.C.inspect()).status,'delivery_uncertain');assert.equal(e.downloads.length,0);
 const n=e.calls.length;await e.C.retry(o.requestId);e.downloadState='complete';await e.drain();
 assert.equal(e.downloads.length,1);assert.equal(e.calls.length,n,'delivery retry uses staged bytes, no provider requests');
 // Stop after a subset: prepare an explicitly partial download without more provider reads.
 e=createEnvironment();o=e.opts('job-cancel-12345',Array.from({length:8},(_,i)=>e.chat(i+1)),'download');await e.submit(o);
 await e.C.tick();const before=e.calls.filter(x=>x.type==='CAE_GET_CHAT').length;assert.equal(before,4);
 await e.C.cancel(o.requestId);j=await e.drain();assert.equal(j.status,'cancelled');assert.equal(e.downloads.length,1);
 assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,before);assert(!e.calls.some(x=>x.type==='CAE_CONTEXT'));
 // Per-file failure remains visible but does not destroy successful chat content.
 e=createEnvironment();e.context={projects_complete:true,projects:[{gizmo:{id:e.pid,display:{name:'Project test'}},files:[{file_id:'missing-file',name:'missing.pdf',type:'application/pdf',size:100}],connectors:[]}],warnings:[]};
 o=e.opts('job-source404-12345',[e.chat(1)],'download');await e.submit(o);j=await e.drain();
 assert.equal(j.status,'completed_with_warnings');assert.equal(j.sources.failed,1);assert.equal(j.counts.saved,1);
 console.log('PASS: durable staged download, actual-completion acknowledgement, ambiguous delivery recovery, no duplicate downloads, partial Stop, source 404 reporting');
})().catch(e=>{console.error(e);process.exitCode=1;});
