'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..'),A='business-one',B='other-workspace',project='g-p-11111111111111111111111111111111';
const calls=[];
let active=A;
const records={
 '/backend-api/me':{id:'user1',name:'Example User',email:'secret@example.org',unused:'HIDDEN'},
 '/backend-api/gizmos/bootstrap':{gizmos:[{resource:{gizmo:{id:'g-abcdef1234',workspace_id:A,display:{name:'Tutor'},instructions:'PRIVATE'}}}]},
 '/backend-api/ps/plugins/installed?scope=GLOBAL':{plugins:[
  {id:'id1',name:'browser',scope:'GLOBAL',installed_at:'2026-11-01T00:00:00Z',status:'ENABLED',release:{display_name:'Browser',version:'1',skills:[{name:'control-browser',plugin_release_skill_id:'sk1'}]}},
  {id:'default',name:'system',scope:'GLOBAL',installation_policy:'INSTALLED_BY_DEFAULT',release:{display_name:'System'}}],pagination:{next_page_token:null}},
 '/backend-api/ps/plugins/installed?scope=WORKSPACE':{plugins:[],pagination:{next_page_token:null}},
 '/backend-api/user_system_messages':{about_model_message:'User-defined instructions',memories:'SENSITIVE-DO-NOT-COPY'},
};
const sandbox={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/'},
  Date,URL,AbortSignal,setTimeout,clearTimeout,Map,Set,
  fetch:async (url,opts={})=>{
    calls.push({url,headers:opts.headers||{}});
    if(url==='/api/auth/session')return Response.json({accessToken:'TOKEN',account:{id:active,structure:'workspace',name:'Team'},user:{id:'user1'}});
    if(url.startsWith('/backend-api/gizmos/snorlax/sidebar'))return Response.json({items:[{gizmo:{gizmo:{id:project,workspace_id:A,display:{name:'Project'},instructions:'Project instructions'},files:[]}}],cursor:null});
    if(url.includes('/connector_scopes'))return Response.json({items:[],cursor:null});
    if(!(url in records))throw Error('Unexpected endpoint '+url);
    return Response.json(records[url]);
  }
};
vm.createContext(sandbox);
for(const f of ['lib/config-inventory.js','lib/api.js'])vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),sandbox);
(async()=>{
 const api=sandbox.window.ChatArchiveApi;
 const r=await api.getWorkspaceSnapshot(A,()=>{},{includeConfiguration:true});
 assert.equal(r.identity.account_id,A);assert.equal(r.identity.workspace_name,'Team');
 assert.equal(r.custom_gpts.items.length,1);
 assert.equal(r.installed_plugins.items.length,1);
 assert.equal(r.bundled_skills.items.length,1);
 assert.equal(r.personalization.about_model_message,'User-defined instructions');
 assert(!JSON.stringify(r).includes('SENSITIVE-DO-NOT-COPY'));
 assert(!JSON.stringify(r).includes('PRIVATE'));assert(!JSON.stringify(r).includes('TOKEN'));
 assert(!JSON.stringify(r).includes('secret@example.org'));
 assert(calls.every(x=>!x.url.includes('accounts/check')&&!x.url.includes('/memories')&&!x.url.includes('plugins/list')));
 assert(calls.filter(x=>x.url.startsWith('/backend-api/')).every(x=>x.headers['ChatGPT-Account-Id']===A));
 const count=calls.length;active=B;
 await assert.rejects(api.backgroundPage({kind:'config_plugins',scope:'GLOBAL'},A),/Workspace changed|does not match/);
 assert.equal(calls.filter(x=>x.url.startsWith('/backend-api/')).length,
   calls.slice(0,count).filter(x=>x.url.startsWith('/backend-api/')).length,
   'no authenticated inventory call after workspace switch');
 console.log('PASS: manual current-workspace snapshot, connected plugin subset, GPT descriptions only, no Memory/tokens/sibling-account API, fail closed after account switch');
})().catch(e=>{console.error(e);process.exitCode=1;});
