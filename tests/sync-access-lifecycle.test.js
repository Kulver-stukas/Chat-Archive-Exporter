'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const source=n=>fs.readFileSync(__dirname+'/../lib/'+n+'.js','utf8');
 const key='cae.background.v1', cut='2026-11-09T20:00:00Z';
 let time=Date.now(),restores=[],reconciles=[],checks=[],released=[],diskWrites=0,apiCalls=0;
 const config=id=>({account_id:id,enabled:true,status:'idle',prefix:'ChatGPT/Workspace '+id,started_at:cut,new_since:cut,scope:'active',enrollment:'tracked',queue:[{id:'hint:abc',kind:'hint',attempts:2}],blocked_until:0,tracked_chats:1});
 const store={[key]:{schema:key,workspaces:{one:config('one'),two:config('two')},cooldown_until:0}};
 const dirs=new Map([['one',{queryPermission:async()=> 'granted'}],['two',{queryPermission:async()=> 'prompt'}]]);
 const holders=new Map(),policy=require('../lib/sync-policy.js'),V=require('../lib/vault.js');
 const chrome={runtime:{getContexts:async()=>[]},storage:{local:{get:async k=>({[k]:structuredClone(store[k])}),set:async o=>Object.assign(store,structuredClone(o))}},
 alarms:{get:async()=>({}),create:async()=>{},clear:async()=>{}},tabs:{query:async()=>[],sendMessage:async()=>({})}};
 function instance(){
  const w={chrome,console,ChatArchiveSyncPolicy:policy,
   ChatArchiveSyncSpool:{readMirror:async()=>null,stats:async()=>({pending:0,conflicts:0,bytes:0}),pending:async()=>[],seed:async()=>null},Date:class extends Date{static now(){return time;}},setTimeout:()=>1,clearTimeout(){},
   ChatArchiveVault:{permissionState:V.permissionState,restoreWorkspaceDirectory:async id=>{restores.push(id);return dirs.get(id)||null;},
     hasPermission:async dir=>(await V.permissionState(dir)).state==='granted',acquireLock:async()=>()=>{},acquireVaultGuard:async()=>async()=>{},writeFile:async()=>{diskWrites++;}},
   ChatArchiveVaultContext:{reconcile:async ids=>{reconciles.push([...ids]);for(const id of holders.keys())if(!ids.includes(id))holders.delete(id);for(const id of ids)holders.set(id,dirs.get(id));},
     check:async(id,opt)=>{checks.push({id,...opt});holders.set(id,dirs.get(id));return {permission:'granted',retained:!!dirs.get(id),holderInstance:'instance-one'};},
     release:async id=>{released.push(id);holders.delete(id);}},
   ChatArchiveSyncRPC:{connect:()=>{apiCalls++;throw Error('Unexpected network');}}
  };w.globalThis=w;vm.runInContext(source('sync'),require('./provider-bootstrap').boot(w));return w.ChatArchiveSync;
 }
 let c=instance();await c.startup();
 assert.deepEqual(reconciles[0],['one','two'],'rehydrate all enabled workspaces');
 assert.equal((await c.inspect('two')).status,'permission_required');assert.equal(apiCalls,0);
 assert.equal((await c.inspect('two')).access.offscreen,'granted','context mismatch is observable');
 assert((await c.inspect('two')).message.includes('Offscreen has a grant'));
 let cfg=c._state().workspaces.two;
 const jobs=JSON.stringify(cfg.queue);dirs.get('two').queryPermission=async()=> 'denied';time+=60001;
 c._state().workspaces.one.blocked_until=time+600000;
 await c.tick();
 await c.probeAccess('two','diagnostic');
 // Probe is non-mutating with respect to queue/scheduling, explicit ready applies status.
 await c.accessReady('two');assert.equal(cfg.status,'permission_denied');assert.equal(JSON.stringify(cfg.queue),jobs);
 dirs.get('two').queryPermission=async()=> 'granted';await c.accessReady('two');
 assert.equal(cfg.status,'queued');assert.equal(cfg.new_since,cut);assert.equal(cfg.queue[0].attempts,2);
 assert(checks.some(x=>x.id==='two'&&x.refresh),'regrant explicitly refreshes resident handle');
 cfg.status='cooldown';cfg.blocked_until=time+60000;c._state().cooldown_until=cfg.blocked_until;
 await c.accessReady('two');assert.equal(cfg.status,'cooldown');assert.equal(cfg.blocked_until,time+60000);
 await c.resume('two');assert.equal(cfg.status,'cooldown','Resume cannot override network backoff');
 dirs.delete('two');await c.accessReady('two');assert.equal(cfg.status,'vault_missing');assert.equal(JSON.stringify(cfg.queue),jobs);
 dirs.set('two',{queryPermission:async()=>{throw Object.assign(Error('hidden'),{name:'NotReadableError'});}});
 await c.accessReady('two');assert.equal(cfg.status,'vault_error');assert.equal(cfg.access.worker,'error');
 await c.pause('two');assert.deepEqual(reconciles.at(-1),['one']);
 await c.pause('one');assert.deepEqual(reconciles.at(-1),[],'all paused releases the context');
 const before=checks.length;c=instance();await c.startup();assert.deepEqual(reconciles.at(-1),[]);assert.equal(checks.length,before,'default off adds no access checks');
 console.log('PASS: startup all-workspace retention, state distinctions, context mismatch, preserved queue/cutoff/cooldown, pause and disabled restart');
})().catch(e=>{console.error(e);process.exitCode=1;});
