'use strict';
const assert=require('node:assert/strict');const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 // Missing Vault permission and wrong workspace are recoverable, never a fallback destination.
 let e=createEnvironment();let o=e.opts('job-permission-12345',[e.chat(1)],'vault','current');await e.submit(o);e.root.granted=false;
 let j=await e.drain();assert.equal(j.status,'permission_required');assert.equal(e.calls.length,0);
 e.reload();e.root.granted=true;e.scopeAccount='other-workspace';await e.C.resume();j=await e.drain();
 assert.equal(j.status,'waiting_for_tab');assert(!e.calls.some(x=>x.type==='CAE_GET_CHAT'));
 e.scopeAccount=e.account;await e.C.resume();j=await e.drain();assert.equal(j.status,'completed');
 assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,1);assert(e.calls.some(x=>x.type==='CAE_CONTEXT'),'Vault initialization includes a configuration snapshot');
 // 429 pauses the whole manual job; an unrelated user wake does not reset it.
 e=createEnvironment();o=e.opts('job-cooldown-12345',[e.chat(1),e.chat(2)]);await e.submit(o);
 e.failNext(Object.assign(Error('Rate limit'),{code:'API_COOLDOWN',httpStatus:429,retryAfterMs:44000}));
 j=await e.drain();assert.equal(j.status,'cooldown');assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,1);
 const count=e.calls.length;await e.C.resume();await e.C.tick();assert.equal(e.calls.length,count);
 e.advance(70000);j=await e.drain();assert.equal(j.active,false);assert.equal(j.counts.saved,2);
 // Interrupted file/index commit: a durable staged exact payload permits safe adoption.
 e=createEnvironment();o=e.opts('job-orphan-12345',[e.chat(1)],'vault','current');await e.submit(o);
 const open=e.box.ChatArchiveVault.openStore;let fail=true;
 e.box.ChatArchiveVault.openStore=async dir=>{const v=await open(dir),write=v.writeText;v.writeText=async(path,text,opts)=>{
   if(fail&&opts.kind==='chats'){fail=false;await e.box.ChatArchiveVault.writeFile(dir,path,text);throw Error('Simulated worker termination before index commit');}
   return write(path,text,opts);
 };return v;};
 await e.C.tick();assert.equal((await e.C.inspect()).status,'retry_wait');
 assert.equal((await e.S.entries(o.requestId)).length,1);
 e.reload();e.advance(70000);j=await e.drain();assert.equal(j.active,false);assert.equal(j.counts.skipped,1);
 assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,1,'recovery reuses staged bytes, not server');
 const idx=JSON.parse(await e.read('ChatGPT/Workspace test/.workspace.json'));assert.equal(Object.keys(idx.chats).length,1);
 // A newer on-disk revision must not be replaced by an older delayed manual payload.
 e=createEnvironment();o=e.opts('job-newer-12345',[e.chat(1)],'vault','current');await e.submit(o);
 const realOpen=e.box.ChatArchiveVault.openStore;e.box.ChatArchiveVault.openStore=async dir=>{
   const v=await realOpen(dir);v.writeText=async()=>{throw Error('Transient write failure');};return v;
 };
 await e.C.tick();const staged=(await e.S.entries(o.requestId))[0];assert(staged);
 e.reload();const v=await e.box.ChatArchiveVault.openStore(e.root);await v.useWorkspace('ChatGPT/Workspace test',e.account);
 const newer=(await staged.blob.text()).replace('updated: "2026-11-02T12:00:00Z"','updated: "2026-11-11T12:00:00Z"')+'\nNEWER';
 await v.writeText(staged.path,newer,{kind:'chats',key:e.account+'|'+e.chat(1).id,remoteChat:{...e.chat(1),updated:'2026-11-11T12:00:00Z'}});
 e.advance(70000);j=await e.drain();assert.equal(j.counts.skipped,1);assert((await e.read(staged.path)).endsWith('NEWER'));
 console.log('PASS: manual permission/workspace waits, shared cooldown, staged orphan recovery, no detail refetch and no stale downgrade');
})().catch(e=>{console.error(e);process.exitCode=1;});
