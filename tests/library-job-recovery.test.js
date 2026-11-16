'use strict';
const assert=require('node:assert/strict');
const {createLibraryEnvironment,fid}=require('./library-job-fixtures');
(async()=>{
 const e=createLibraryEnvironment();
 e.rootRows=[e.node(1,'report.txt')];e.detailMap[fid(1)]={use_case:'caas',size:3};
 e.blobs.set(fid(1),new TextEncoder().encode('abc'));e.assetMime[fid(1)]='text/plain';
 await e.start(false);await e.drainLib();
 await e.L.submitArchive({accountId:e.account,tabId:1,ids:['file:'+fid(1)]});
 // Model a process interruption after close() but before the source-index commit.
 const original=e.box.ChatArchiveVault.openStore;
 let fail=true;
 e.box.ChatArchiveVault.openStore=async dir=>{const v=await original(dir);const complete=v.completeSource.bind(v);
   v.completeSource=async(...args)=>{if(fail){fail=false;throw Error('Injected index interruption');}return complete(...args);};return v;};
 let state=await e.drainLib();assert.equal(state.job.status,'retry_wait');
 const calls=e.libCalls.filter(x=>x.type==='CAE_ASSET_START').length;
 e.reload();await e.L.resume(e.account);state=await e.drainLib();
 assert.equal(state.job.status,'complete');assert.equal(state.report.results.length,1);
 assert.equal(state.report.results[0].status,'saved');assert.equal(state.report.results[0].recovered,true);
 assert.equal(e.libCalls.filter(x=>x.type==='CAE_ASSET_START').length,calls,'Receipt recovery must not download again');
 assert.equal(await e.read(state.report.results[0].local_path),'abc');
 assert.equal(state.report.received_bytes,3,'Bytes charged once before the interrupted index commit');
 // Wrong-size body must not create an accepted original.
 const t=createLibraryEnvironment();t.rootRows=[t.node(2,'wrong.txt')];t.detailMap[fid(2)]={use_case:'caas',size:3};
 t.blobs.set(fid(2),new TextEncoder().encode('abcdef'));t.assetMime[fid(2)]='text/plain';
 await t.start(false);await t.drainLib();await t.L.submitArchive({accountId:t.account,tabId:1,ids:['file:'+fid(2)]});
 const failed=await t.drainLib();assert.equal(failed.report.results[0].error_code,'SIZE_MISMATCH');
 assert.equal(Object.values((await t.box.ChatArchiveVault.readIndex(t.root)).sources).length,0);
 console.log('PASS: interrupted original commit recovered by checksum without re-download; byte budget preserved; wrong-size stream rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
