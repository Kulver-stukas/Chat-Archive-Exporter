'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
 const routed=[],probes=[];let acknowledged=0;
 const chrome={runtime:{id:'self',getURL:p=>'chrome-extension://self/'+p,onMessage:event(),onConnect:event(),onStartup:event(),onInstalled:event()},
 downloads:{onChanged:event()},alarms:{onAlarm:event()},tabs:{onActivated:event(),onUpdated:event(),query:async()=>[]},windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1}};
 Object.defineProperty(chrome.runtime,'lastError',{get(){acknowledged++;return {message:'receiver gone'};}});
 const C={startup:async()=>{},enable:async()=>({}),pause:async()=>({}),inspect:async()=>({}),resume:async()=>({}),
 accessReady:async id=>{routed.push(id);return {enabled:true};},probeAccess:async(id,e,opts)=>{probes.push({id,e,opts});},
 _state:()=>({workspaces:{}}),armTab:async()=>{},signal:async()=>{},tick:async()=>{},ALARM:'alarm'};
 const s={chrome,console,ChatArchiveManualJobs:{startup:async()=>{},resume:async()=>{},downloadChanged:async()=>{},ALARM:'manual'},ChatArchiveSync:C,ChatArchiveVaultDiagnostics:{report:async()=>({events:[]})},importScripts(){}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../worker.js','utf8'),s);
 const message=chrome.runtime.onMessage.listeners[0],connect=chrome.runtime.onConnect.listeners[0];
 const invoke=(msg,sender={id:'self',url:'chrome-extension://self/panel.html'})=>new Promise(resolve=>{assert.equal(message(msg,sender,resolve),true);});
 assert.equal((await invoke({type:'CAE_VAULT_READY',accountId:'account-one'})).ok,true);assert.deepEqual(routed,['account-one']);
 assert.equal(message({type:'CAE_VAULT_READY',accountId:'account-one'},{id:'self',tab:{id:1}},()=>{}),false);
 assert.equal(message({type:'CAE_VAULT_READY',accountId:'account-one'},{id:'other'},()=>{}),false);
 assert.equal((await invoke({type:'CAE_VAULT_DIAGNOSTICS',accountId:'account-one'},{id:'self',url:'chrome-extension://self/options.html?tab=8#tools',tab:{id:9},frameId:0})).result.events.length,0);
 assert.equal(message({type:'CAE_VAULT_DIAGNOSTICS'},{id:'self',url:'https://chatgpt.com/',tab:{id:1,url:'https://chatgpt.com/'},frameId:0},()=>{}),false);
 assert.equal(message({type:'CAE_VAULT_DIAGNOSTICS'},{id:'self',url:'chrome-extension://self/offscreen.html'},()=>{}),false);
 const port={name:'cae-panel-lifecycle',sender:{id:'self',url:'chrome-extension://self/panel.html'},onMessage:event(),onDisconnect:event()};
 connect(port);assert.equal(port.onMessage.listeners.length,1);
 port.onMessage.listeners[0]({type:'bind',accountId:'account-one',permission:'granted'});
 port.onDisconnect.listeners[0]();await Promise.resolve();
 assert(probes.some(x=>x.e==='panel_disconnect'&&x.id==='account-one'));assert.equal(acknowledged,1);
 const bad={...port,sender:{id:'self',url:'https://chatgpt.com/'},onMessage:event()};connect(bad);assert.equal(bad.onMessage.listeners.length,0);
 console.log('PASS: worker access message routes, content-script isolation, panel lifecycle events and checked lastError');
})().catch(e=>{console.error(e);process.exitCode=1;});
