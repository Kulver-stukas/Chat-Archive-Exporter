'use strict';
const assert=require('node:assert/strict');
const {createLibraryEnvironment,fid}=require('./library-job-fixtures');
(async()=>{
 // No automatic start before a committed manual baseline.
 let e=createLibraryEnvironment();await e.L.startup();await e.L.tick();assert.equal(e.libCalls.length,0);
 e.rootRows=[e.node(1)];e.detailMap[fid(1)]={use_case:'my_files',size:3};
 await e.start(true);
 e.scopeAccount='different-workspace';let r=await e.drainLib();
 assert.equal(r.job.status,'waiting_for_tab');assert.equal(r.baseline_at,null);assert.equal(r.enabled,false);
 assert(!e.libCalls.some(x=>x.type==='CAE_LIBRARY_PAGE'));
 // Explicit stop cancels the job across worker restarts.
 await e.L.stop(e.account);e.reload();e.advance(1000*60);await e.L.tick();r=await e.L.inspect(e.account);assert.equal(r.job.status,'cancelled');
 // Permission revocation pauses, without enabling a baseline or requesting permission.
 e=createLibraryEnvironment();e.rootRows=[e.node(1)];await e.start(true);e.root.granted=false;
 r=await e.drainLib();assert.equal(r.job.status,'permission_required');assert.equal(r.baseline_at,null);assert.equal(r.enabled,false);
 // Retry-After survives worker restart and explicit Resume cannot bypass it.
 e=createLibraryEnvironment();await e.start(true);
 e.pageError=Object.assign(Error('rate limit'),{code:'API_COOLDOWN',httpStatus:429,retryAfterMs:180000});
 r=await e.drainLib();assert.equal(r.job.status,'cooldown');
 const before=e.libCalls.length;await e.L.resume(e.account);await e.L.tick();assert.equal(e.libCalls.length,before);
 e.reload();await e.L.tick();assert.equal(e.libCalls.length,before);
 e.advance(180001);r=await e.drainLib();assert.equal(r.job.status,'complete');
 // Locally changed inventory must not be overwritten, even same length/mtime.
 const snapshot=e.prefix+'/_Library/_inventory.json';const loc=await e.box.ChatArchiveVault.lookupFile(e.root,snapshot);
 const prior=await e.read(snapshot);let changed=prior.replace('cae.library-vault.v1','cae.library-vault.v9');
 const tm=loc.handle.mtime;loc.handle.bytes=new TextEncoder().encode(changed);loc.handle.mtime=tm;
 await assert.rejects(e.start(false),/not a valid snapshot/);assert.equal(await e.read(snapshot),changed);
 console.log('PASS: no implicit seed, account switch fail-closed, durable stop, permission pause, rate-limit persistence, local inventory preservation');
})().catch(e=>{console.error(e);process.exitCode=1;});
