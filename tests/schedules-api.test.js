'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..'),account='verified-workspace',another='sibling';let active=account;
const requests=[];
const pages={
 scheduled:[{items:[{id:'Automation_1',title:'Daily',prompt:'Do the task',schedule:'BEGIN:VEVENT\nRRULE:FREQ=DAILY\nEND:VEVENT'}],cursor:'next'},
   {items:[{id:'Automation_2',title:'Weekly',prompt:'Do the task on Friday',schedule:'BEGIN:VEVENT\nRRULE:FREQ=WEEKLY;BYDAY=FR\nEND:VEVENT'}],cursor:null}],
 paused:[{items:[{id:'Automation_3',title:'Paused',prompt:'Pause',is_enabled:false}],cursor:null}],
 finished:[{items:[],cursor:null}]};
const sandbox={window:{},location:{origin:'https://chatgpt.com',pathname:'/'},document:{cookie:''},
 Date,Map,Set,URL,AbortSignal,setTimeout,clearTimeout,
 fetch:async(url,opts={})=>{
   requests.push({url,headers:opts.headers||{}});
   if(url==='/api/auth/session')return Response.json({accessToken:'SESSION-SECRET',account:{id:active,structure:'personal'},user:{id:'user-current',name:'Example'}});
   if(url==='/backend-api/me')return Response.json({id:'user-current',name:'Example'});
   if(url==='/backend-api/gizmos/bootstrap')return Response.json({gizmos:[]});
   if(url.includes('/gizmos/snorlax/sidebar'))return Response.json({items:[],cursor:null});
   if(url==='/backend-api/user_system_messages')return Response.json({about_model_message:'Only user-defined instructions'});
   if(url==='/backend-api/ps/plugins/installed?scope=GLOBAL')return Response.json({plugins:[],pagination:{next_page_token:null}});
   if(url.startsWith('/backend-api/automations?')){
     const parsed=new URL(url,'https://chatgpt.com');const bucket=parsed.searchParams.get('filter');
     const pg=parsed.searchParams.has('cursor')?1:0;return Response.json(pages[bucket][pg]);
   }
   throw Error('Unexpected API request '+url);
 }};
vm.createContext(sandbox);require('./provider-bootstrap').boot(sandbox);
for(const f of ['providers/chatgpt/config-inventory.js','providers/chatgpt/api.js'])vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),sandbox);
(async()=>{
 const api=sandbox.window.ChatArchiveApi;
 const config=await api.getWorkspaceSnapshot(account,()=>{}, {includeConfiguration:true});
 assert.equal(config.schedules.status,'complete');
 assert.equal(config.schedules.items.length,3);
 assert.equal(config.schedules.items.find(x=>x.id==='Automation_2').prompt,'Do the task on Friday');
 const webCalls=requests.filter(x=>x.url.startsWith('/backend-api/'));
 assert(webCalls.every(x=>x.headers['ChatGPT-Account-Id']===account));
 assert(!requests.some(x=>/memories|suggested_automations|accounts\/check|other-workspace/.test(x.url)));
 assert(!JSON.stringify(config).includes('SESSION-SECRET'));
 const n=webCalls.length;active=another;
 await assert.rejects(api.backgroundPage({kind:'config_schedules',bucket:'scheduled'},account),/Workspace changed|does not match/);
 assert.equal(requests.filter(x=>x.url.startsWith('/backend-api/')).length,n);
 console.log('PASS: paginated Schedules from active account only, full on-demand configuration, no Memory/sibling/suggested calls; fail closed on scope change');
})().catch(e=>{console.error(e);process.exitCode=1;});
