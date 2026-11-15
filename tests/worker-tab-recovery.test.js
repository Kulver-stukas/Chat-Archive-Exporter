'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const event=()=>({callbacks:[],addListener(fn){this.callbacks.push(fn);}});
const calls=[];
const C={startup:async()=>{},armTab:async id=>{calls.push('arm:'+id);},probeAccess:async()=>{},_state:()=>({workspaces:{}}),tick:async()=>{},ALARM:'alarm'};
const B={ensure:async id=>{calls.push('ensure:'+id);return {ok:true,injected:true};},eligibleOpenTabs:async()=>{calls.push('scan-on-update');return {restored:1};}};
const chrome={runtime:{id:'self',getURL:p=>'chrome-extension://self/'+p,onMessage:event(),onConnect:event(),onStartup:event(),onInstalled:event()},downloads:{onChanged:event()},alarms:{onAlarm:event()},tabs:{onActivated:event(),onUpdated:event(),query:async()=>[]},windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../worker.js'),'utf8'),{chrome,ChatArchiveManualJobs:{startup:async()=>{},resume:async()=>{},downloadChanged:async()=>{},ALARM:'manual'},ChatArchiveSync:C,ChatArchiveTabBootstrap:B,console,importScripts(){},setTimeout}, {filename:'worker.js'});
async function flush(){await new Promise(r=>setTimeout(r,25));}
(async()=>{
 chrome.runtime.onInstalled.callbacks[0]({reason:'update'});
 await flush();assert(calls.includes('scan-on-update'));
 calls.length=0;
 chrome.tabs.onActivated.callbacks[0]({tabId:7});await flush();
 assert.deepEqual(calls.slice(0,2),['ensure:7','arm:7'],'arm must follow bridge recovery');
 const message=chrome.runtime.onMessage.callbacks[0];
 const invoke=(sender)=>new Promise(resolve=>{const used=message({type:'CAE_ENSURE_TAB',tabId:8},sender,resolve);if(!used)resolve({blocked:true});});
 const fromContent=await invoke({id:'self',tab:{id:1}});
 assert.equal(fromContent.blocked,true,'content script must not control injection');
 const fromPanel=await invoke({id:'self',url:'chrome-extension://self/panel.html'});
 assert.equal(fromPanel.ok,true);assert.equal(fromPanel.result.injected,true);
 assert(calls.includes('ensure:8'));
 console.log('PASS: update re-inject scan, activate->ensure->arm ordering, panel-only recovery command');
})().catch(e=>{console.error(e);process.exitCode=1;});
