'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const event=()=>({f:[],addListener(fn){this.f.push(fn)},fire(...args){this.f.forEach(fn=>fn(...args))}});
let manual=null,library=[],background={workspaces:{}},icons=[],badges=[],colors=[],titles=[],opens=[],remote=0,widgetMessages=[];
const chrome={runtime:{id:'ext',onMessage:event(),getURL:p=>'chrome-extension://ext/'+p},storage:{onChanged:event(),local:{get:async()=>({'cae.background.v1':background})},session:{set:async x=>opens.push('intent')}},
 tabs:{get:async id=>({id,windowId:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444'}),onUpdated:event(),onRemoved:event(),
  sendMessage:async (id,m)=>{widgetMessages.push(m.type);return {shown:m.type==='CAE_UI_WIDGET_SHOW'}},query:async()=>[],create:async()=>{}},
 scripting:{executeScript:async()=>{}},windows:{update:async()=>{}},
 action:{setIcon:async x=>icons.push(x.path[16]),setTitle:async x=>titles.push(x.title),setBadgeText:async x=>badges.push(x.text),
  setBadgeBackgroundColor:async x=>colors.push(x.color),setBadgeTextColor:async()=>{}},sidePanel:{open:async()=>opens.push('open')}};
const ctx={chrome,globalThis:null,Map,Set,Date,console,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
 ChatArchiveManualJobs:{inspect:async()=>manual},ChatArchiveLibraryStore:{list:async()=>library,validId:()=>true},
 ChatArchiveSync:{inspect:async()=>({enabled:false,status:'idle'}),_state:()=>({workspaces:{}})},
 ChatArchiveLibraryJobs:{inspect:async()=>null},ChatArchiveTabBootstrap:{ensure:async()=>{}},
 ChatArchiveVault:{restoreWorkspaceDirectory:async()=>null},
 ChatArchivePaths:{createLayout:()=>({prefix:'ChatGPT/Workspace'})},
 ChatArchiveSyncSpool:{readMirror:async(account,prefix)=>({schema:'cae.background-mirror.v1',account,prefix,verified_at:'2026-11-18T17:00:00Z',chats:{'aaaaaaaa-1111-2222-3333-444444444444':{conversation_id:'aaaaaaaa-1111-2222-3333-444444444444',title:'Stored in Vault',path:prefix+'/stored.md'}},known:[]})},
 ChatArchiveSyncRPC:{connect:()=>({call:async()=>{remote++;return {observed:true,accountId:'workspace',display:'Workspace'}},close(){}})}};
ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['state.js','chat-list-cache.js','worker-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui',f),'utf8'),ctx);
const wait=()=>new Promise(r=>setTimeout(r,250));
const send=(m,sender)=>new Promise(resolve=>{const ret=chrome.runtime.onMessage.f[0](m,sender,resolve);if(ret!==true)resolve(null);});
(async()=>{
 await wait();assert(icons.at(-1).includes('base'));assert.equal(badges.at(-1),'IDLE');assert.equal(colors.at(-1),'#227e49');assert.equal(remote,0);
 background={workspaces:{w:{enabled:true,status:'idle'}}};chrome.storage.onChanged.fire({'cae.background.v1':{}},'local');await wait();assert.equal(badges.at(-1),'IDLE');assert.equal(remote,0);
 library=[{job:{status:'running'},enabled:true}];chrome.storage.onChanged.fire({'cae.library-status.v1':{}},'local');await wait();assert.equal(badges.at(-1),'REC');assert.equal(colors.at(-1),'#bd3030');
 library=[];manual={active:true,status:'permission_required'};chrome.storage.onChanged.fire({'cae.manual-status.v1':{}},'local');await wait();assert.equal(badges.at(-1),'WARN');
 manual={accountId:'workspace',active:true,status:'download_failed',message:'Browser download interrupted: USER_CANCELED. Staged bytes retained.'};
 chrome.storage.onChanged.fire({'cae.manual-status.v1':{}},'local');await wait();assert.equal(badges.at(-1),'IDLE','explicit Save cancellation must not set an error badge');
 manual={accountId:'workspace',destination:'download',active:false,status:'completed_not_saved',deliveryOutcome:'user_cancelled_save',message:'Browser Save was canceled by the user.'};
 chrome.storage.onChanged.fire({'cae.manual-status.v1':{}},'local');await wait();assert.equal(badges.at(-1),'IDLE');
 assert.equal(await send({type:'CAE_UI_WIDGET_BIND'},{id:'evil',tab:{id:11,url:'https://chatgpt.com/'},frameId:0}),null);
 assert.equal(await send({type:'CAE_UI_WIDGET_BIND'},{id:'ext',tab:{id:11,url:'https://example.com/'},frameId:0}),null);
 const sender={id:'ext',tab:{id:11,windowId:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444'},frameId:0};
 assert.equal((await send({type:'CAE_UI_WIDGET_STATUS'},sender)).result.verified,true,'missing binding is recovered on demand');assert.equal(remote,1);
 const initial=(await send({type:'CAE_UI_WIDGET_BIND'},sender)).result;
 assert(initial.verified);assert(initial.manualSummary.includes('Prepared, not saved'));assert(Array.isArray(initial.logs.manual));assert.equal(remote,1);
 for(let n=0;n<4;n++)await send({type:'CAE_UI_WIDGET_STATUS'},sender);assert.equal(remote,1,'cached state requests must not query provider');
 const nativeNow=Date.now;try{Date.now=()=>nativeNow()+6*60_000;
   const afterFiveMinutes=(await send({type:'CAE_UI_WIDGET_STATUS'},sender)).result;
   assert(afterFiveMinutes.verified);assert.equal(remote,2,'expired scope binding must be reverified without Popup');
 }finally{Date.now=nativeNow;}
 const stored=(await send({type:'CAE_UI_CHAT_CACHE',accountId:'workspace',display:'Workspace'},{id:'ext'})).result;
 assert.equal(stored.items[0].title,'Stored in Vault');assert.equal(stored.source,'Vault mirror');
 assert.equal(await send({type:'CAE_UI_CHAT_CACHE',accountId:'workspace',display:'Workspace'},sender),null,'page cannot access arbitrary workspace cache');
 await send({type:'CAE_UI_OPEN_PANEL',mode:'library'},sender);assert.deepEqual(opens,['intent','open']);
 await send({type:'CAE_UI_TOGGLE_WIDGET',tabId:11},{id:'ext'});assert(widgetMessages.includes('CAE_UI_WIDGET_TOGGLE'));
 chrome.tabs.onUpdated.fire(11,{url:'https://chatgpt.com/'});assert.equal((await send({type:'CAE_UI_WIDGET_STATUS'},sender)).result.verified,true,'after a binding reset, STATUS alone restores it');assert.equal(remote,3);
 console.log('PASS: UI worker rebinds after worker/cache loss, native REC/IDLE badges, canceled Save neutrality, scoped sanitized monitor status, widget toggle, no core writes');
})().catch(e=>{console.error(e);process.exitCode=1});
