'use strict';
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment();await e.C.startup();await e.C.tick();assert.equal(e.calls.length,0);
 const items=[e.chat(1),e.chat(2),e.chat(3),e.chat(4),e.chat(5)];
 const bytes=Uint8Array.from([0,255,195,40,0,10,13,250]);e.blobs.set('file-binary',bytes);
 e.context={captured_at:'2026-11-12T02:00:00Z',projects_complete:true,personalization:null,warnings:[],projects:[{
   gizmo:{id:e.pid,display:{name:'Project test'},instructions:'Keep exact original bytes.'},
   files:[{id:'attach-one',file_id:'file-binary',name:'original.zip',type:'application/zip',size:8,created_at:'2026-11-01T00:00:00Z',metadata:{knowledge_store_info:{source_kind:'uploaded_file'}}}],connectors:[]}]};
 const opts=e.opts('job-first-12345',items);await e.submit(opts);
 const again=await e.C.submit(opts);assert.equal(again.id,opts.requestId);assert.equal((await e.S.list()).length,1);
 assert.equal(e.calls.length,0,'acceptance must not fetch bodies');
 // Destroy the controller/UI immediately after acceptance. IDB survives.
 e.reload();await e.C.startup();let done=await e.drain();
 assert.equal(done.active,false);assert.equal(done.status,'completed');assert.equal(done.counts.saved,5);assert.equal(done.sources.saved,1);
 assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,5);
 const p='ChatGPT/Workspace test/Project test/Sources/original.zip';
 const f=await (await e.box.ChatArchiveVault.lookupFile(e.root,p)).handle.getFile();assert.deepEqual(new Uint8Array(await f.arrayBuffer()),bytes);
 const ledger=JSON.parse(await e.read('ChatGPT/Workspace test/.workspace.json'));assert.equal(Object.keys(ledger.chats).length,5);
 assert.equal((await e.S.entries(opts.requestId)).length,0,'completed payload cleared');
 const first=await e.S.get(opts.requestId);
 assert.deepEqual(Array.from(first.audit.selected_ids),items.map(x=>x.id));
 assert.equal(first.audit.accepted_count,5);assert.equal(first.audit.outcome_counts.saved,5);
 assert.equal(first.audit.outcomes.length,5);
 assert(first.audit.outcomes.every(x=>x.result==='saved'&&x.actual_path&&x.planned_path));
 assert(!first.audit.inflight);
 assert(!e.calls.some(x=>JSON.stringify(x).includes('memories')));
 // Second run skips existing chats and Sources without their content requests.
 e.calls.length=0;await e.submit(e.opts('job-repeat-12345',items));done=await e.drain();
 assert.equal(done.counts.saved,0);assert.equal(done.counts.skipped,5);assert.equal(done.sources.skipped,1);
 assert(!e.calls.some(x=>['CAE_GET_CHAT','CAE_SOURCE_START'].includes(x.type)));
 const repeat=await e.S.get('job-repeat-12345');
 assert.equal(repeat.audit.outcome_counts.verified_current,5);
 assert(repeat.audit.outcomes.every(x=>x.reason==='Archived version matches workspace index.'&&x.actual_path));
 // Locally edited chat is preserved; newer remote version does not bypass hash guard.
 const path=ledger.chats[items[0].id].path;const loc=await e.box.ChatArchiveVault.lookupFile(e.root,path);
 const w=await loc.handle.createWritable();await w.write((await e.read(path))+'\nLOCAL EDIT');await w.close();
 e.calls.length=0;await e.submit(e.opts('job-conflict-12345',[{...items[0],updated:'2026-11-12T01:00:00Z'}]));done=await e.drain();
 assert.equal(done.counts.conflict,1);assert((await e.read(path)).endsWith('LOCAL EDIT'));assert(!e.calls.some(x=>x.type==='CAE_GET_CHAT'));
 const conflict=await e.S.get('job-conflict-12345');
 assert.equal(conflict.audit.outcome_counts.conflict,1);assert.equal(conflict.audit.outcomes[0].actual_path,path);
 await assert.rejects(()=>e.submit({...e.opts('job-mismatch-12345',items),selectionCount:6}),/does not match the UI selection/);
 console.log('PASS: durable manual Vault jobs across controller replacement, selective project Sources, binary bytes, idempotent acceptance, repeat skips and local edit preservation');
})().catch(e=>{console.error(e);process.exitCode=1;});
