'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const a='business-one',b='personal-two',pid='g-p-11111111111111111111111111111111';
let current=a;const requests=[];
const box={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/'},AbortSignal,URL,Date,Map,Set,console,setTimeout,clearTimeout,
 fetch:async (p,opts={})=>{
   requests.push({p,scope:opts.headers?.['ChatGPT-Account-Id']});
   if(p==='/api/auth/session')return Response.json({accessToken:'TOKEN',account:{id:current,name:current},user:{id:'user-one'}});
   if(p.startsWith('/backend-api/gizmos/snorlax/sidebar')){
     // Simulates user switching immediately after receiving a project listing page.
     current=b;
     return Response.json({items:[{gizmo:{gizmo:{id:pid,workspace_id:a,display:{name:'Project'}}}}],cursor:null});
   }
   if(p.startsWith('/backend-api/'))throw Error('No other workspace endpoint may be queried after a session switch: '+p);
   throw Error('Unexpected call');
 }};
vm.createContext(box);for(const f of ['lib/config-inventory.js','lib/api.js'])vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),box);
(async()=>{
 await assert.rejects(box.window.ChatArchiveApi.listAll(),/Workspace changed|workspace/i);
 assert.equal(requests.filter(x=>x.p.startsWith('/backend-api/')).length,1,'no backend calls after user account switch');
 assert(requests.filter(x=>x.p.startsWith('/backend-api/')).every(x=>x.scope===a));
 assert(!requests.some(x=>/accounts\/check|memories|plugins\/list/i.test(x.p)));
 console.log('PASS: active account switch during conversation enumeration fails closed before querying next account.');
})().catch(e=>{console.error(e);process.exitCode=1;});
