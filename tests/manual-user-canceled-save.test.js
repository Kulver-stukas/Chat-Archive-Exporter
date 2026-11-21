'use strict';
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
(async()=>{
  // Multi-chat ZIP: a canceled Save dialog is terminal, not a retriable failure.
  let e=createEnvironment();e.downloadState='in_progress';
  let opts=e.opts('job-save-cancel-zip-12345',[e.chat(1),e.chat(2)],'download');
  await e.submit(opts);let job=await e.drain();
  assert.equal(job.status,'download_pending');
  assert((await e.S.entries(opts.requestId)).length>0,'staging exists while browser has not completed');
  e.downloads[0].state='interrupted';e.downloads[0].error='USER_CANCELED';
  await e.C.downloadChanged({id:1,state:{current:'interrupted'}});
  job=await e.C.inspect();
  assert.equal(job.status,'completed_not_saved');assert.equal(job.active,false);
  assert.equal(job.deliveryOutcome,'user_cancelled_save');
  assert.equal(job.stagedBytes,0);assert.equal((await e.S.entries(opts.requestId)).length,0);
  assert.equal(job.counts.saved,2,'the number of prepared chats is retained in historical results');
  assert(!job.logs.some(x=>x.level==='warning'&&/Save was canceled/.test(x.message)));
  assert.equal(await e.C.hasActive(),false);
  await assert.rejects(e.C.retry(opts.requestId),/No pending manual job/);
  // A canceled ZIP must not block a new manual job in this extension profile.
  const second=e.opts('job-after-cancel-12345',[e.chat(3)],'vault');
  await e.submit(second);job=await e.drain();assert.equal(job.status,'completed');
  assert(e.downloads.length===1,'no browser download is retried by the next Vault job');

  // Current-chat Markdown: cancellation follows the same policy.
  e=createEnvironment();e.downloadState='in_progress';
  opts=e.opts('job-save-cancel-md-12345',[e.chat(1)],'download','current');
  await e.submit(opts);await e.drain();e.downloads[0].state='interrupted';e.downloads[0].error='USER_CANCELED';
  await e.C.downloadChanged({id:1,state:{current:'interrupted'}});
  job=await e.C.inspect();assert.equal(job.status,'completed_not_saved');
  assert.equal((await e.S.entries(opts.requestId)).length,0);

  // Chrome can reject downloads.download directly when the user dismisses Save As.
  e=createEnvironment();opts=e.opts('job-api-cancel-12345',[e.chat(1)],'download','current');
  e.box.chrome.downloads.download=async()=>{throw Error('User canceled');};
  await e.submit(opts);job=await e.drain();
  assert.equal(job.status,'completed_not_saved');
  assert.equal((await e.S.entries(opts.requestId)).length,0);

  // External failures must remain recoverable and preserve staging.
  e=createEnvironment();e.downloadState='in_progress';opts=e.opts('job-network-failed-12345',[e.chat(1)],'download','current');
  await e.submit(opts);await e.drain();e.downloads[0].state='interrupted';e.downloads[0].error='NETWORK_FAILED';
  await e.C.downloadChanged({id:1,state:{current:'interrupted'}});
  job=await e.C.inspect();assert.equal(job.status,'download_failed');assert(job.active);
  assert((await e.S.entries(opts.requestId)).length>0);

  // A rev.4 USER_CANCELED pending job is cleaned up on the next worker startup.
  e=createEnvironment();e.downloadState='in_progress';opts=e.opts('job-old-cancel-12345',[e.chat(1)],'download','current');
  await e.submit(opts);await e.drain();
  const raw=await e.S.get(opts.requestId);raw.status='download_failed';
  raw.message='Browser download interrupted: USER_CANCELED. Staged bytes retained; use Retry delivery.';
  await e.S.put(raw);e.reload();await e.C.startup();job=await e.C.inspect();
  assert.equal(job.status,'completed_not_saved');assert.equal(job.active,false);
  assert.equal((await e.S.entries(opts.requestId)).length,0);

  // User's explicit Stop is still distinct from dismissing Chrome Save As.
  e=createEnvironment();e.downloadState='in_progress';opts=e.opts('job-stop-is-not-save-cancel-12345',[e.chat(1)],'download','current');
  await e.submit(opts);await e.drain();await e.C.cancel(opts.requestId);
  job=await e.drain();assert.equal(job.status,'cancelled');
  console.log('PASS: canceled browser Save dialog is terminal without a saved file; staging purged; ZIP and Markdown; legacy migration; external failures and Vault preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
