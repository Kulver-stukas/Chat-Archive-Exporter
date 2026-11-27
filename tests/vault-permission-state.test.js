'use strict';
const assert=require('node:assert/strict');
const V=require('../lib/vault.js');
(async()=>{
  assert.equal((await V.permissionState(null)).state,'no_handle');
  assert.equal((await V.permissionState({})).state,'unsupported');
  for(const state of ['granted','prompt','denied']){
    let requested=0;
    const h={queryPermission:async o=>{assert.equal(o.mode,'readwrite');return state;},
      requestPermission:async()=>{requested++;return 'granted';}};
    assert.equal((await V.permissionState(h)).state,state);
    assert.equal(await V.hasPermission(h,false),state==='granted');
    assert.equal(requested,0,'passive checks never prompt');
    assert.equal(await V.hasPermission(h,true),true);
    assert.equal(requested,state==='granted'?0:1,'only explicit ask requests access');
  }
  const broken={queryPermission:async()=>{throw Object.assign(Error('sensitive path'),{name:'NotFoundError'});}};
  assert.deepEqual(await V.permissionState(broken),{state:'error',errorName:'NotFoundError'});
  assert.equal(await V.hasPermission(broken,false),false);
  await assert.rejects(V.hasPermission(broken,true),/NotFoundError/);
  assert.equal((await V.permissionState({queryPermission:async()=>null})).state,'error');
  let asked=0;
  const reject={queryPermission:async()=> 'prompt',requestPermission:async()=>{asked++;throw Object.assign(Error('Activation required'),{name:'SecurityError'});}};
  await assert.rejects(V.hasPermission(reject,true),{name:'SecurityError'});assert.equal(asked,1);
  let count=0;const hung={queryPermission:()=>{count++;return new Promise(()=>{});},requestPermission:()=>{throw Error('Must never prompt passively');}};
  const results=await Promise.all([V.permissionState(hung),V.permissionState(hung)]);
  assert.deepEqual(results,[{state:'error',errorName:'TimeoutError'},{state:'error',errorName:'TimeoutError'}]);
  assert.deepEqual(await V.permissionState(hung),results[0]);assert.equal(count,1,'timed-out raw query must not be duplicated');
  console.log('PASS: bounded hung permission check; permission states, no passive requests, explicit action, denied/unsupported/error separated');
})().catch(e=>{console.error(e);process.exitCode=1;});
