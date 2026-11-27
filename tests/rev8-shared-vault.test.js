'use strict';
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
async function take(V,dir,details={}){
 const lock=await V.acquireLock(true);assert(lock,'fixture Web Lock');
 try{const release=await V.acquireVaultGuard(dir,lock,details);return async()=>{try{await release();}finally{await lock();}};}
 catch(e){await lock();throw e;}
}
(async()=>{
 const a=createEnvironment(),b=createEnvironment(),A=a.box.ChatArchiveVault,B=b.box.ChatArchiveVault;
 const first=await take(A,a.root);
 await assert.rejects(take(B,a.root),{code:'VAULT_BUSY'});
 const d=(await A.parentDirectory(a.root,A.CLAIM_DIR+'/placeholder')).dir;
 assert.equal(d.children.size,1,'contender must remove only its own claim');
 await first();
 const second=await take(B,a.root);await second();assert.equal(d.children.size,0);
 const result=await Promise.allSettled([take(A,a.root),take(B,a.root)]);
 assert(result.filter(x=>x.status==='fulfilled').length<=1,'at most one writer');
 for(const x of result)if(x.status==='fulfilled')await x.value();
 assert.equal(d.children.size,0);
 await d.getFileHandle('writer-stale.lock',{create:true});
 await assert.rejects(take(A,a.root),{code:'VAULT_BUSY'});assert(d.children.has('writer-stale.lock'),'never steal a legacy claim');
 await d.removeEntry('writer-stale.lock');
 await A.verifySameDirectory(a.root,a.root);
 await assert.rejects(A.verifySameDirectory(a.root,b.root),/exactly the original/);
 console.log('PASS: independent writer claims, concurrent contention, fail-closed legacy claim, same-folder identity');
})().catch(e=>{console.error(e);process.exitCode=1;});
