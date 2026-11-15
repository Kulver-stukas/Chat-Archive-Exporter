'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}}),called=[];
 const chrome={runtime:{id:'self',getURL:p=>'chrome-extension://self/'+p,onMessage:event(),onConnect:event(),onStartup:event(),onInstalled:event()},
  downloads:{onChanged:event()},alarms:{onAlarm:event()},tabs:{onActivated:event(),onUpdated:event(),query:async()=>[{id:7}]},windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1}};
 const manual={ALARM:'manual'};for(const k of ['submit','quick','inspect','cancel','retry','resume','startup','downloadChanged','tick'])manual[k]=async arg=>{called.push([k,arg]);return {id:'job12345'};};
 const sync={ALARM:'auto',startup:async()=>{},_state:()=>({workspaces:{}}),armTab:async()=>{},probeAccess:async()=>{},tick:async()=>{}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../worker.js','utf8'),{chrome,console,importScripts(){},ChatArchiveManualJobs:manual,ChatArchiveSync:sync});
 const route=chrome.runtime.onMessage.listeners[0];const invoke=(msg,sender={id:'self',url:'chrome-extension://self/panel.html'})=>new Promise(resolve=>assert.equal(route(msg,sender,resolve),true));
 await invoke({type:'CAE_MANUAL_SUBMIT',options:{requestId:'job12345'}});assert(called.some(([k,a])=>k==='submit'&&a.requestId==='job12345'));
 for(const type of ['CAE_MANUAL_SUBMIT','CAE_MANUAL_CANCEL','CAE_MANUAL_RETRY','CAE_MANUAL_STATUS','CAE_MANUAL_WAKE']){
  assert.equal(route({type,options:{}},{id:'self',tab:{id:3}},()=>{}),false);
  assert.equal(route({type},{id:'other'},()=>{}),false);
 }
 await invoke({type:'CAE_MANUAL_QUICK',tabId:999,accountId:'forged'},{id:'self',tab:{id:3}});assert(called.some(([k,a])=>k==='quick'&&a===3));
 await invoke({type:'CAE_MANUAL_QUICK',tabId:999});assert(called.some(([k,a])=>k==='quick'&&a===7));
 assert.equal(route({type:'CAE_MANUAL_PREPARE',target:'cae-manual-output'},{id:'self'},()=>{}),false);
 chrome.alarms.onAlarm.listeners[0]({name:'manual'});chrome.downloads.onChanged.listeners[0]({id:4,state:{current:'complete'}});
 await Promise.resolve();assert(called.some(([k])=>k==='tick'));assert(called.some(([k,a])=>k==='downloadChanged'&&a.id===4));
 console.log('PASS: UI-only manual controls, content quick-save cannot spoof tab/workspace, alarm/download event routing');
})().catch(e=>{console.error(e);process.exitCode=1;});
