'use strict';
const assert=require('node:assert/strict');const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 // Cancel while a provider request is in flight: preserve its completed capture,
 // but issue no request for any later chat. Cancellation survives a worker reload.
 let e=createEnvironment(),o=e.opts('job-race-cancel-12345',Array.from({length:8},(_,i)=>e.chat(i+1)),'vault');await e.submit(o);
 let n=0;e.onCall=async(type)=>{if(type==='CAE_GET_CHAT'&&++n===1)await e.C.cancel(o.requestId);};
 await e.C.tick();e.reload();let j=await e.drain();assert.equal(j.status,'cancelled');assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,1);
 // A previous ambiguous delivery may already exist. Stop must NEVER create a replacement.
 e=createEnvironment();e.downloadState='in_progress';o=e.opts('job-cancel-uncertain-12345',[e.chat(1)],'download');await e.submit(o);await e.drain();
 let raw=await e.S.get(o.requestId);raw.download_id=null;raw.status='download_starting';await e.S.put(raw);e.downloads.length=0;e.reload();await e.C.tick();
 assert.equal((await e.C.inspect()).status,'delivery_uncertain');await e.C.cancel(o.requestId);await e.C.tick();
 assert.equal((await e.C.inspect()).status,'cancelled');assert.equal(e.downloads.length,0);
 // Passive tab activation must not reset server deadlines or a deliberate error wait.
 e=createEnvironment();o=e.opts('job-passive-wait-12345',[e.chat(1)],'download');await e.submit(o);
 raw=await e.S.get(o.requestId);raw.status='retry_wait';raw.next_at=Date.now()+3600000;await e.S.put(raw);
 await e.C.resume();assert.equal((await e.S.get(o.requestId)).next_at,raw.next_at);
 raw.status='download_failed';await e.S.put(raw);await e.C.resume();assert.equal((await e.S.get(o.requestId)).status,'download_failed');
 // No job may silently retarget the globally selected Vault after acceptance.
 e=createEnvironment();o=e.opts('job-bound-root-12345',[e.chat(1)]);await e.submit(o);const {Dir}=require('./manual-fixtures');
 const replacement=new Dir('Other Vault');e.box.ChatArchiveVault.restoreDirectory=async()=>replacement;
 j=await e.drain();assert.equal(j.status,'completed');assert.equal(replacement.children.size,0);assert(e.root.children.size>0);
 raw=await e.S.get(o.requestId);assert(!raw.context&&!raw.sourceJobs,'completed history excludes project content');assert.equal(raw.items.length,0);assert.equal(j.totalChats,1);
 console.log('PASS: in-flight Stop, durable cancellation, no download on ambiguous Stop, passive backoff preservation, frozen Vault binding, bounded history');
})().catch(e=>{console.error(e);process.exitCode=1;});
