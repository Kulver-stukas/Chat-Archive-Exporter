'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment(),V=e.box.ChatArchiveVault;
 const account=e.account,prefix='ChatGPT/Recovery test';
 const bytes=new TextEncoder().encode('original-binary-\u0000-data');
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 const job={key:'project:file_00000000000000000000000000000221',projectId:e.pid,
   fileId:'file_00000000000000000000000000000221',name:'recover.bin',
   path:prefix+'/Evidence/Sources/recover.bin',expectedBytes:bytes.length};
 let v=await V.openStore(e.root);await v.useWorkspace(prefix,account);
 let d=await v.decideSource(job,account);
 const target=await v.beginSource(d,job);
 await target.stream.write(bytes);
 await v.stageSourceCommit(job,d,sha,bytes.length);
 await target.stream.close();
 assert.equal(v.getSourceIndex(account+'|'+job.key).pending,true);
 // Simulate MV3 termination after the bytes were fully closed but BEFORE
 // completeSource committed its final indexed record.
 v=await V.openStore(e.root);await v.useWorkspace(prefix,account);
 d=await v.decideSource(job,account);
 assert.equal(d.action,'skip');assert.equal(d.status,'skipped');
 assert.match(d.reason,/recovered/i);
 const indexed=v.getSourceIndex(account+'|'+job.key);
 assert.equal(indexed.pending,false);
 assert.equal(indexed.sha256,sha);
 assert.equal(indexed.bytes,bytes.length);
 const local=await V.lookupFile(e.root,indexed.path);
 assert.deepEqual(new Uint8Array(await (await local.handle.getFile()).arrayBuffer()),bytes);
 // A stale raw record with an unverified orphan is NOT silently adopted.
 const job2={...job,key:'project:file_00000000000000000000000000000222',
   fileId:'file_00000000000000000000000000000222',path:prefix+'/Evidence/Sources/orphan.bin',name:'orphan.bin'};
 d=await v.decideSource(job2,account);
 const orphan=await v.beginSource(d,job2);
 await orphan.stream.write(bytes);
 await v.stageSourceCommit(job2,d,sha,bytes.length);
 await orphan.stream.close();
 const orphanFile=await V.lookupFile(e.root,d.path);
 orphanFile.handle.bytes=new TextEncoder().encode('modified-data');
 v=await V.openStore(e.root);await v.useWorkspace(prefix,account);
 const conflict=await v.decideSource(job2,account);
 assert.equal(conflict.action,'skip');assert.equal(conflict.status,'conflict');
 assert.equal(v.getSourceIndex(account+'|'+job2.key).pending,true,'incomplete index record retained for manual review');
 assert.equal((await (await orphanFile.handle.getFile()).text()),'modified-data');
 // A newly started Source whose stream aborts before commit is not indexed.
 const job3={...job2,key:'project:file_00000000000000000000000000000223',
  fileId:'file_00000000000000000000000000000223',path:prefix+'/Evidence/Sources/cancel.bin'};
 d=await v.decideSource(job3,account);
 const cancelled=await v.beginSource(d,job3);
 await cancelled.stream.write(bytes);await v.abortSource(cancelled);
 assert.equal(v.getSourceIndex(account+'|'+job3.key),null);
 assert.equal(await V.lookupFile(e.root,d.path),null);
 // Account/path isolation is enforced at the persistent Vault writer boundary.
 await assert.rejects(v.decideSource({...job,path:'ChatGPT/Other/Sources/no.bin'},account),/workspace/i);
 await assert.rejects(v.decideSource(job,'another-workspace'),/workspace/i);
 console.log('PASS: crash between file and index commit recovered by SHA; orphan conflict preserved; abort cleanup; cross-workspace rejects');
})().catch(e=>{console.error(e);process.exitCode=1;});
