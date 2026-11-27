'use strict';
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
const {randomUUID}=require('node:crypto');
(async()=>{
 const a=createEnvironment(),b=createEnvironment(),A=a.box.ChatArchiveVault,B=b.box.ChatArchiveVault;
 const root=a.root;await A.writeFile(root,A.INDEX_PATH,'archive-index-sentinel');
 await assert.rejects(A.acquireVaultGuard(root),{code:'VAULT_GUARD_UNAVAILABLE'});
 const lock=await A.acquireLock(true);
 const release=await A.acquireVaultGuard(root,lock,{operation:'manual_export',workspaceId:a.account,jobId:'test-job'});
 const own=(await A.inspectWriterClaims(root))[0];
 assert.equal(own.owner,'own');assert.equal(own.operation,'manual_export');
 const meta=JSON.parse(own.raw);assert.equal(meta.workspace_id,a.account);assert.equal(meta.job_id,'test-job');assert.equal(meta.installation_id,a.storage[A.INSTALL_KEY]);
 assert.equal((await B.inspectWriterClaims(root))[0].owner,'foreign');
 assert.equal(await A.acquireLock(true),null);
 await assert.rejects(A.acquireVaultGuard(root,lock),{code:'VAULT_GUARD_UNAVAILABLE'});
 await assert.rejects(A.clearWriterClaims(root,[own],true),{code:'VAULT_BUSY'});
 const bl=await B.acquireLock(true);
 await assert.rejects(B.acquireVaultGuard(root,bl),{code:'VAULT_BUSY'});await bl();
 // Simulate termination of the owner before its finally block (browser releases Web Lock).
 await lock();a.reload();const A2=a.box.ChatArchiveVault;
 assert.equal((await A2.inspectWriterClaims(root))[0].owner,'own');
 // Also simulate termination between file creation and writing JSON.
 const dir=(await A2.parentDirectory(root,A2.CLAIM_DIR+'/placeholder')).dir;
 const empty='writer-'+meta.installation_id+'-'+randomUUID()+'.lock';await dir.getFileHandle(empty,{create:true});
 const next=await A2.acquireLock(true),nextRelease=await A2.acquireVaultGuard(root,next,{operation:'background_update',workspaceId:a.account});
 assert.equal(dir.children.size,1);assert(!dir.children.has(own.name));assert(!dir.children.has(empty));
 assert.equal((await A2.inspectWriterClaims(root))[0].operation,'background_update');
 await nextRelease();await next();assert.equal(dir.children.size,0);
 // A foreign claim, regardless of age, and a legacy empty claim remain blocked.
 const foreignLock=await B.acquireLock(true),foreignRelease=await B.acquireVaultGuard(root,foreignLock,{operation:'preferences'});
 const foreign=(await A2.inspectWriterClaims(root))[0];await foreignLock();
 await dir.getFileHandle('writer-legacy.lock',{create:true});
 a.advance(365*86400000);const stale=await A2.inspectWriterClaims(root);assert.deepEqual(Array.from(stale,x=>x.owner).sort(),['foreign','legacy']);
 const check=await A2.acquireLock(true);await assert.rejects(A2.acquireVaultGuard(root,check),{code:'VAULT_BUSY'});await check();
 assert.equal(dir.children.size,2);
 const summary=A2.writerClaimSummary(stale,a.account);assert(!JSON.stringify(summary).includes(meta.installation_id));assert(!JSON.stringify(summary).includes(a.account));
 await assert.rejects(A2.clearWriterClaims(root,stale,false),/confirm/);assert.equal(dir.children.size,2);
 await dir.getFileHandle('writer-newly-appeared.lock',{create:true});
 await assert.rejects(A2.clearWriterClaims(root,stale,true),{code:'VAULT_BUSY'});assert.equal(dir.children.size,3);
 await dir.removeEntry('writer-newly-appeared.lock');
 const old=await A2.inspectWriterClaims(root),fh=await dir.getFileHandle('writer-legacy.lock'),w=await fh.createWritable();await w.write('changed');await w.close();
 await assert.rejects(A2.clearWriterClaims(root,old,true),{code:'VAULT_BUSY'});assert.equal(dir.children.size,2);
 const reviewed=await A2.inspectWriterClaims(root);assert.equal(await A2.clearWriterClaims(root,reviewed,true),2);assert.equal(dir.children.size,0);
 const final=await A2.acquireLock(true),end=await A2.acquireVaultGuard(root,final);await end();await final();assert.equal(await a.read(A.INDEX_PATH),'archive-index-sentinel');
 console.log('PASS: stable owner ID, local-lock proof, interrupted/empty own claim recovery, foreign/legacy preservation, redacted diagnostics and reviewed cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
