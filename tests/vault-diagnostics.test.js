'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const store={};let writes=0;
 const chrome={storage:{local:{get:async k=>({[k]:store[k]}),set:async o=>{writes++;Object.assign(store,structuredClone(o));}}},
 runtime:{getManifest:()=>({version:'0.1.6.4'}),getContexts:async()=>[{contextType:'BACKGROUND'},{contextType:'OFFSCREEN_DOCUMENT',documentUrl:'secret'}]}};
 const s={chrome,console};s.globalThis=s;
 vm.runInNewContext(fs.readFileSync(__dirname+'/../lib/vault-diagnostics.js','utf8'),s);
 const d=s.ChatArchiveVaultDiagnostics;
 await d.append('account-secret','panel_open',{worker:'granted',panel:'granted',retained:true,token:'SHOULD-NOT-APPEAR',path:'D:/secret',body:'MESSAGE'});
 await d.append('account-secret','panel_open',{worker:'granted',panel:'granted',retained:true});
 assert.equal(writes,1,'equivalent passive event is coalesced');
 await d.append('account-secret','panel_open',{worker:'prompt',panel:'prompt',retained:true});assert.equal(writes,2,'state change not suppressed');
 const report=await d.report(),text=JSON.stringify(report);
 for(const secret of ['account-secret','SHOULD-NOT-APPEAR','D:/secret','MESSAGE','documentUrl'])assert(!text.includes(secret));
 assert.equal(report.events[0].workspace,'workspace_1');
 for(let i=0;i<270;i++)await d.append('account-secret','event_'+i,{worker:i%2?'granted':'denied',offscreen:'prompt'});
 assert.equal((await d.report()).events.length,240,'ring is bounded');
 assert.equal((await d.report()).events.at(-1).event,'event_269');
 const s2={chrome,console};s2.globalThis=s2;vm.runInNewContext(fs.readFileSync(__dirname+'/../lib/vault-diagnostics.js','utf8'),s2);
 assert.equal((await s2.ChatArchiveVaultDiagnostics.report()).events.length,240,'restart retains diagnostic history');
 console.log('PASS: allowlisted access diagnostics, state-change retention, dedupe, 240-entry bound, workspace aliases, restart');
})().catch(e=>{console.error(e);process.exitCode=1;});
