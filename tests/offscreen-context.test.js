'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..'),source=p=>fs.readFileSync(path.join(base,p),'utf8');
(async()=>{
  let open=false,created=0,closed=0,checks=0;
  const chrome={runtime:{id:'self',getURL:p=>'chrome-extension://self/'+p,
    getContexts:async()=>open?[{documentUrl:'chrome-extension://self/offscreen.html'}]:[],
    sendMessage:async msg=>{checks++;assert.equal(msg.target,'cae-vault-context');return {ok:true,result:{available:true,permission:'granted'}};}},
    offscreen:{createDocument:async o=>{created++;assert.deepEqual(Array.from(o.reasons),['BLOBS']);open=true;},closeDocument:async()=>{closed++;open=false;}}};
  const world={chrome,console};world.globalThis=world;vm.runInNewContext(source('lib/vault-context.js'),world);
  const helper=world.ChatArchiveVaultContext;
  await Promise.all([helper.ensure(),helper.ensure(),helper.ensure()]);assert.equal(created,1);
  assert.equal((await helper.check('account-one')).available,true);assert.equal(checks,1);
  await helper.close();assert.equal(closed,1);assert.equal(await helper.exists(),false);
  // Exercise real offscreen message handler and real permissionState helper.
  let handler,restores=0,reads=0;
  const dirs=new Map(),r1={name:'Private vault',queryPermission:async()=> 'granted',requestPermission:()=>{throw Error('Must not ask');}},r2={...r1};
  dirs.set('account-one',r1);dirs.set('account-two',r2);
  const V=require('../lib/vault.js');
  const w={chrome:{runtime:{id:'self',onMessage:{addListener:fn=>{handler=fn;}}}},ChatArchiveVault:{
    permissionState:V.permissionState,INDEX_PATH:V.INDEX_PATH,
    restoreWorkspaceDirectory:async id=>{restores++;return dirs.get(id)||null;},
    lookupFile:async h=>{assert([r1,r2].includes(h));return {handle:{getFile:async()=>{reads++;return new Blob(['index fixture']);}}};}
  },Blob,console};
  vm.runInNewContext(source('offscreen.js'),w);
  const call=msg=>new Promise(resolve=>assert.equal(handler({target:'cae-vault-context',...msg},{id:'self'},resolve),true));
  const ck=(id,refresh=false)=>call({type:'CAE_VAULT_CONTEXT_CHECK',accountId:id,refresh});
  assert.equal((await ck('account-one')).result.retained,true);
  assert.equal(restores,1);assert.equal(reads,1);
  dirs.delete('account-one'); // reference only in resident Map, not in a local invocation
  let response=(await ck('account-one')).result;
  assert.equal(response.permission,'granted');assert.equal(restores,1);assert.equal(reads,1,'no repeated Blob reads on quiet checks');
  r1.queryPermission=async()=> 'denied';
  assert.equal((await ck('account-one')).result.permission,'denied','pinning cannot override revocation');
  r1.queryPermission=async()=> 'prompt';assert.equal((await ck('account-one')).result.permission,'prompt');
  r1.queryPermission=async()=> 'granted';assert.equal((await ck('account-one')).result.permission,'granted');assert.equal(reads,2);
  dirs.set('account-one',r1);
  assert.equal((await ck('account-one',true)).result.retained,true);assert.equal(restores,2,'regrant refresh deserializes new handle');
  let rec=await call({type:'CAE_VAULT_CONTEXT_RECONCILE',accountIds:['account-one','account-two']});
  assert.equal(rec.result.retainedCount,2);
  rec=await call({type:'CAE_VAULT_CONTEXT_RECONCILE',accountIds:['account-two']});assert.equal(rec.result.retainedCount,1);
  dirs.delete('account-one');assert.equal((await ck('account-one')).result.permission,'no_handle','pruned workspace not retained');
  assert.equal((await ck('account-two')).result.permission,'granted','other workspace is unaffected');
  await call({type:'CAE_VAULT_CONTEXT_RELEASE',accountId:'account-two'});dirs.delete('account-two');
  assert.equal((await ck('account-two')).result.permission,'no_handle');
  assert.equal((await ck('invalid!')).ok,false);
  assert.equal(handler({target:'cae-vault-context',type:'CAE_VAULT_CONTEXT_CHECK',accountId:'account-one'},{id:'other'},()=>{}),false);
  assert.equal(handler({target:'cae-vault-context',type:'CAE_VAULT_CONTEXT_CHECK',accountId:'account-one'},{id:'self',tab:{id:1}},()=>{}),false);
  dirs.set('account-one',r1);r1.queryPermission=async()=>{throw Object.assign(Error('secret'),{name:'SecurityError'});};
  response=(await ck('account-one')).result;assert.equal(response.permission,'error');assert.equal(response.errorName,'SecurityError');
  assert(!JSON.stringify(response).includes('Private vault'));
  console.log('PASS: resident handles, reuse/rebind, all-workspace reconciliation, pause release, bounded Blob probes, revocation and sender isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
