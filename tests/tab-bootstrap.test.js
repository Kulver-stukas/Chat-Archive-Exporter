'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const old='https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444';
let installs=0,reloads=0,probes=0;
const active=new Set();
const urls=new Map([[1,{url:old,status:'complete'}],[2,{url:'https://example.com/',status:'complete'}],[3,{url:old,status:'complete',discarded:true}],[4,{url:old,status:'loading'}],[5,{url:'https://chat.openai.com/c/x',status:'complete'}]]);
const chrome={
 runtime:{getManifest:()=>({version:'0.1.6.4'})},
 tabs:{
   get:async id=>urls.get(id)||null,
   query:async()=>[...urls.entries()].map(([id,t])=>({id,...t})),
   sendMessage:async(tabId,m)=>{assert.equal(m.type,'CAE_BRIDGE_PING');probes++;if(!active.has(tabId))throw Error('Could not establish connection. Receiving end does not exist.');return {ok:true,version:'0.1.6.4'};},
   reload:async()=>{reloads++}
 },
 scripting:{executeScript:async x=>{
   installs++;
   assert.deepEqual(Array.from(x.files),[...require('./provider-bootstrap').files,'lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','providers/chatgpt/normalize.js','providers/chatgpt/config-inventory.js','providers/chatgpt/original-policy.js','lib/source-transfer.js','providers/chatgpt/library-inventory.js','providers/chatgpt/http.js','providers/chatgpt/api.js','content.js','sync-watch.js']);
   assert.equal(x.world,'ISOLATED');assert.equal(x.target.frameIds[0],0);
   active.add(x.target.tabId);
 }}
};
const sandbox={chrome,setTimeout,clearTimeout};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/tab-bootstrap.js'),'utf8'),require('./provider-bootstrap').boot(sandbox));
const T=sandbox.ChatArchiveTabBootstrap;
(async()=>{
 let a=await T.ensure(1);assert(a.ok&&a.injected);assert.equal(installs,1);
 a=await T.ensure(1);assert(a.ok&&a.already);assert.equal(installs,1,'do not inject into an already live page');
 assert.equal((await T.ensure(2)).reason,'ineligible_tab');
 assert.equal((await T.ensure(3)).reason,'ineligible_tab');
 assert.equal((await T.ensure(4)).reason,'page_loading');
 // Two simultaneous connection attempts must not run two injections.
 const result=await Promise.all([T.ensure(5),T.ensure(5)]);
 assert(result.every(x=>x.ok));assert.equal(installs,2);
 active.delete(1);
 const summary=await T.eligibleOpenTabs();
 assert.equal(summary.restored,1,'a formerly working open tab gets repaired on update');
 assert.equal(installs,3);assert.equal(reloads,0,'never reload a user tab with an unsent draft');
 assert(probes>=3);
 console.log('PASS: verified version ping, missing/stale receiver injection, host allowlist, skip loading/discarded, concurrency dedupe, update enumeration, no tab reload');
})().catch(e=>{console.error(e);process.exitCode=1;});
