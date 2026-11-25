'use strict';
// Real IDB records and Blobs; only provider/browser transports are mocked.
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
const N=require('../lib/normalize'),E=require('../lib/export-selection');
function snapshot(e){
  const mapping={root:{id:'root',parent:null,children:[],message:null}};let parent='root';
  function add(id,role,text,attachments=[],type='text'){
    mapping[parent].children.push(id);
    mapping[id]={id,parent,children:[],message:{id:'message-'+id,author:{role},create_time:1760000000,
      content:type==='thoughts'?{content_type:type,thoughts:[{content:text}]}:{content_type:'text',parts:[text]},metadata:{attachments}}};parent=id;
  }
  add('q1','user','SELECTED QUESTION',[{id:'file_upload',name:'input.txt',size:3}]);
  add('t1','assistant','SELECTED THINKING',[],'thoughts');
  add('a1','assistant','SELECTED ANSWER [Result](sandbox:/mnt/data/result.txt)',[{id:'file_generated',name:'result.dat',size:5}]);
  add('q2','user','SECRET UNSELECTED QUESTION',[{id:'file_hidden',name:'secret-upload.txt'}]);
  add('a2','assistant','SECRET UNSELECTED ANSWER [Hidden](sandbox:/mnt/data/secret.txt)');
  add('q3','user','REUSED UPLOAD',[{id:'file_upload',name:'input.txt',size:3}]);
  const chat=N.normalizeChat({id:e.chat(1).id,title:'Current selection',mapping,current_node:parent});
  e.normalizedChats.set(chat.id,chat);
  e.blobs.set('file_upload',Uint8Array.from([0,128,255]));
  e.blobs.set('file_generated',Uint8Array.from([9,10,13,0,255]));
  e.blobs.set('/mnt/data/result.txt',new TextEncoder().encode('original sandbox bytes'));
  return chat;
}
function options(e,id,chat,changes={}){
  const options=e.opts(id,[e.chat(1)],'download','current');
  options.exportSelection={...E.DEFAULTS,completeConversation:false,conversationId:chat.id,branchNode:chat.branchNode,
    messageIds:['q1','t1','a1'],...changes};return options;
}
const starts=e=>e.calls.filter(c=>c.type==='CAE_ATTACHMENT_START');
const mdEntry=async(e,id)=>(await e.S.entries(id)).find(r=>r.entryId.startsWith('chat:'));
(async()=>{
  // Intent is copied at acceptance and independent of later global preference patches.
  let e=createEnvironment();e.downloadState='in_progress';let chat=snapshot(e),o=options(e,'job-selection-main-12345',chat);
  await e.submit(o);o.exportSelection.messageIds.push('q2','a2');o.exportSelection.questions=false;
  await e.box.ChatArchiveExportPreferences.patch({questions:false,answers:false,thinking:false,uploadedFiles:false,generatedFiles:false});
  let j=await e.drain();assert.equal(j.status,'download_pending',JSON.stringify(j));
  let stored=await e.S.get(o.requestId);
  assert.deepEqual(Array.from(stored.exportSelection.messageIds),['q1','t1','a1']);
  assert.equal(stored.exportSelection.questions,true);
  assert.equal(e.calls.filter(c=>c.type==='CAE_GET_CHAT').length,1);
  assert(!e.calls.some(c=>['CAE_LIST','CAE_CONTEXT','CAE_LIBRARY_PAGE','CAE_LIBRARY_INVENTORY'].includes(c.type)));
  assert.equal(starts(e).length,3);assert(starts(e).every(c=>['q1','a1'].includes(c.attachment.messageId)));
  assert(!starts(e).some(c=>c.attachment.fileId==='file_hidden'||c.attachment.sandboxPath==='/mnt/data/secret.txt'));
  const entries=await e.S.entries(o.requestId),md=await (await mdEntry(e,o.requestId)).blob.text();
  assert(entries.some(r=>r.entryId==='selection-snapshot'&&r.internal===true));
  assert(md.includes('SELECTED QUESTION')&&md.includes('SELECTED THINKING')&&md.includes('SELECTED ANSWER'));
  assert(!md.includes('SECRET UNSELECTED')&&!md.includes('secret-upload')&&!md.includes('secret.txt')&&!md.includes('REUSED UPLOAD'));
  assert.equal(stored.attachmentReport.counts.saved,3);
  assert.equal(stored.attachmentReport.received_bytes,3+5+new TextEncoder().encode('original sandbox bytes').length);
  for(const entry of entries.filter(x=>x.entryId.startsWith('attachment:'))){
    assert.equal(entry.sha256,e.box.ChatArchiveHash.hex(new Uint8Array(await entry.blob.arrayBuffer())));
    assert(entry.attachmentResult.localPath.startsWith('attachments/'));
  }

  // Binary-only export, including a repeated reference, downloads one original once.
  e=createEnvironment();e.downloadState='in_progress';chat=snapshot(e);
  o=options(e,'job-selection-file-only-12345',chat,{questions:false,answers:false,thinking:false,generatedFiles:false,messageIds:['q1','q3']});
  await e.submit(o);j=await e.drain();assert.equal(j.status,'download_pending');
  assert.equal(starts(e).length,1);
  const binaryOnly=await (await mdEntry(e,o.requestId)).blob.text();
  assert(!binaryOnly.includes('SELECTED QUESTION')&&!binaryOnly.includes('REUSED UPLOAD'));
  assert(binaryOnly.includes('input.txt'));

  // Worker suspension after bytes were committed but before the per-file index.
  e=createEnvironment();e.downloadState='in_progress';chat=snapshot(e);o=options(e,'job-selection-recover-12345',chat);
  await e.submit(o);
  const stage=e.S.stage;let interrupted=false;
  e.S.stage=async(...args)=>{const result=await stage(...args);if(args[1]==='attachment:0'&&!interrupted){interrupted=true;throw Error('Simulated worker interruption after durable file stage');}return result;};
  await e.C.tick();assert.equal((await e.C.inspect()).status,'retry_wait');
  assert.equal(starts(e).length,1);assert(await e.S.entry(o.requestId,'attachment:0'));
  const altered=structuredClone(chat);altered.messages[0].content=altered.messages[0].textContent='MUTATED PROVIDER CONTENT';
  e.normalizedChats.set(chat.id,altered);e.reload();e.advance(70000);
  j=await e.drain();assert.equal(j.status,'download_pending');
  assert.equal(starts(e).filter(x=>x.attachment.fileId==='file_upload').length,1,'recover staged file without another network transfer');
  assert.equal(e.calls.filter(c=>c.type==='CAE_GET_CHAT').length,1,'selected content comes from checkpoint');
  const recovered=await (await mdEntry(e,o.requestId)).blob.text();assert(recovered.includes('SELECTED QUESTION'));assert(!recovered.includes('MUTATED PROVIDER CONTENT'));
  stored=await e.S.get(o.requestId);assert.equal(stored.attachmentReport.counts.saved,3);
  assert.equal(stored.attachmentReport.received_bytes,3+5+new TextEncoder().encode('original sandbox bytes').length,'received bytes are not counted twice');

  // A changed preview branch fails before attachment requests or output delivery.
  e=createEnvironment();chat=snapshot(e);o=options(e,'job-selection-stale-12345',chat);o.exportSelection.branchNode='old-branch';
  await e.submit(o);j=await e.drain();assert.equal(j.status,'failed');assert.equal(starts(e).length,0);assert.equal(e.downloads.length,0);
  assert.equal((await e.S.entries(o.requestId)).length,0);

  // Stop before any snapshot must not start a provider call or create a download.
  e=createEnvironment();chat=snapshot(e);o=options(e,'job-selection-stop-before-12345',chat);await e.submit(o);
  await e.C.cancel(o.requestId);e.reload();j=await e.drain();assert.equal(j.status,'cancelled');assert.equal(e.calls.length,0);assert.equal(e.downloads.length,0);

  // Stop while GET_CHAT is in flight may retain that snapshot, but reads no originals.
  e=createEnvironment();e.downloadState='in_progress';chat=snapshot(e);o=options(e,'job-selection-stop-snapshot-12345',chat);await e.submit(o);
  e.onCall=async type=>{if(type==='CAE_GET_CHAT')await e.C.cancel(o.requestId);};
  j=await e.drain();assert.equal(j.status,'download_pending');assert.equal(starts(e).length,0);
  stored=await e.S.get(o.requestId);assert.equal(stored.selection_partial,true);
  const report=JSON.parse(await(await e.S.entry(o.requestId,'selection-report')).blob.text());
  assert.equal(report.partial,true);assert.equal(report.files.length,3);assert(report.files.every(f=>f.status==='cancelled'));
  assert(!(await(await mdEntry(e,o.requestId)).blob.text()).includes('](<attachments/'));
  e.downloads[0].state='complete';await e.C.tick();j=await e.C.inspect();assert.equal(j.status,'cancelled');
  assert.equal((await e.S.entries(o.requestId)).length,0);

  // Known oversized and unresolved originals are reported without fetching them.
  e=createEnvironment();e.downloadState='in_progress';chat=snapshot(e);
  chat.messages[0].attachments[0].sizeBytes=26*1024*1024;
  chat.messages[0].attachments.push({key:'unresolved:q1:extra',origin:'uploaded',fileId:null,sandboxPath:null,name:'unavailable.bin',messageId:'q1'});
  e.normalizedChats.set(chat.id,chat);o=options(e,'job-selection-limits-12345',chat,{messageIds:['q1'],generatedFiles:false});
  await e.submit(o);j=await e.drain();assert.equal(j.status,'download_pending');assert.equal(starts(e).length,0);
  stored=await e.S.get(o.requestId);assert.equal(stored.attachmentReport.counts.skipped,1);assert.equal(stored.attachmentReport.counts.unavailable,1);
  assert.equal(stored.attachment_budget_used,0);

  // A corrupted committed original is never redownloaded or packaged as saved.
  e=createEnvironment();e.downloadState='in_progress';chat=snapshot(e);o=options(e,'job-selection-checksum-12345',chat);
  await e.submit(o);const originalStage=e.S.stage;let stopped=false;
  e.S.stage=async(...args)=>{const r=await originalStage(...args);if(args[1]==='attachment:0'&&!stopped){stopped=true;throw Error('Interrupt after stage');}return r;};
  await e.C.tick();stored=await e.S.get(o.requestId);let rec=await e.S.entry(o.requestId,'attachment:0');
  await originalStage(stored,'attachment:0',rec.path,new Blob(['corrupt']),{sha256:rec.sha256,attachmentResult:rec.attachmentResult,store:true});
  e.reload();e.advance(70000);j=await e.drain();assert.equal(j.status,'failed');assert.equal(e.downloads.length,0);assert.equal(starts(e).length,1);
  // Missing/expired sandbox authorization is a per-file unavailable outcome,
  // not an account authorization wait that blocks the entire export.
  e=createEnvironment();chat=snapshot(e);o=options(e,'job-selection-expired-12345',chat);await e.submit(o);
  e.onCall=async type=>{if(type==='CAE_ATTACHMENT_START')throw Object.assign(Error('Original sandbox has expired.'),{code:'ATTACHMENT_UNAVAILABLE',httpStatus:403});};
  j=await e.drain();assert.equal(j.status,'completed_with_warnings',JSON.stringify(j));
  assert.equal(j.sources.unavailable,3);assert.equal(e.downloads.length,1);
  assert.equal((await e.S.entries(o.requestId)).length,0);

  // Corrupted internal snapshots cannot alter selected text during recovery.
  e=createEnvironment();e.downloadState='in_progress';chat=snapshot(e);
  o=options(e,'job-selection-snapshot-checksum-12345',chat,{uploadedFiles:false,generatedFiles:false});await e.submit(o);
  const snapshotStage=e.S.stage;let stoppedSnapshot=false;
  e.S.stage=async(...args)=>{const r=await snapshotStage(...args);if(args[1]==='selection-snapshot'&&!stoppedSnapshot){stoppedSnapshot=true;throw Error('Interrupt after snapshot');}return r;};
  await e.C.tick();stored=await e.S.get(o.requestId);rec=await e.S.entry(o.requestId,'selection-snapshot');
  const changed=JSON.parse(await rec.blob.text());changed.messages[0].textContent='CORRUPTED SELECTED TEXT';
  await snapshotStage(stored,'selection-snapshot',rec.path,new Blob([JSON.stringify(changed)]),{sha256:rec.sha256,internal:true,store:false});
  e.reload();e.advance(70000);j=await e.drain();assert.equal(j.status,'failed',JSON.stringify(j));
  assert.equal(e.downloads.length,0);assert.equal(starts(e).length,0);assert.equal((await e.S.entries(o.requestId)).length,0);
  console.log('PASS: immutable selection, scoped originals, worker checkpoint recovery, byte accounting, Stop, limits, stale branches and corrupted-file rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
