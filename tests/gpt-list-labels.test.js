'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const a='workspace-verified';const id='aaaaaaaa-1111-2222-3333-444444444444';
const gid='g-abcdef1234567890',calls=[];
const response=(body)=>Response.json(body);
const sandbox={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/'},
 Date,URL,Map,Set,AbortSignal,setTimeout,clearTimeout,
 fetch:async(url,o={})=>{
   calls.push({url,headers:o.headers||{}});
   if(url==='/api/auth/session')return response({accessToken:'SECRET',account:{id:a,structure:'personal'},user:{id:'user-current'}});
   if(url.includes('/gizmos/snorlax/sidebar'))return response({items:[],cursor:null});
   if(url.includes('/backend-api/conversations?'))return response({items:url.includes('is_archived')?[]:
      [{id,title:'Начало уроков английского',gizmo_id:gid,update_time:1794250000,create_time:1794240000}],total:1});
   if(url==='/backend-api/gizmos/bootstrap')return response({gizmos:[{resource:{gizmo:{id:gid,
     display:{name:'#B2 - EnglFy English Tutor',description:'English tutor'},instructions:'PRIVATE-DO-NOT-COPY'}}}]});
   throw Error('Unexpected request '+url);
 }};
vm.createContext(sandbox);require('./provider-bootstrap').boot(sandbox);
for(const f of ['providers/chatgpt/config-inventory.js','providers/chatgpt/api.js'])vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),sandbox);
(async()=>{
 const r=await sandbox.window.ChatArchiveApi.listAll();
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].gptId,gid);
 assert.equal(r.items[0].gptName,'#B2 - EnglFy English Tutor');
 assert(!JSON.stringify(r).includes('PRIVATE-DO-NOT-COPY'));
 assert(calls.filter(x=>x.url.startsWith('/backend-api/')).every(x=>x.headers['ChatGPT-Account-Id']===a));
 assert(!calls.some(x=>/accounts\/check|memories|ps\/plugins\/list/.test(x.url)));
 console.log('PASS: manual conversation list resolves GPT display names using current-scope bootstrap; no hidden GPT configuration exported');
})().catch(e=>{console.error(e);process.exitCode=1;});
