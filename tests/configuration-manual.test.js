'use strict';
const assert=require('node:assert/strict'),{createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment();
 const o=e.opts('config-snapshot-123456',[],'vault','configuration');o.fullWorkspace=true;
 e.context={captured_at:'2026-11-14T12:00:00Z',projects:[],projects_complete:true,
  active_scope:{account_id:e.account},personalization:{about_model_message:'Settings'},
  identity:{account_id:e.account,scope_type:'personal',user_name:'Test',workspace_name:null,complete:true},
  custom_gpts:{status:'partial',complete:false,items:[{id:'g-testgpt123456',name:'GPT sample',source:'current_scope_bootstrap'}]},
  installed_plugins:{status:'complete',complete:true,scopes:[{scope:'GLOBAL',complete:true}],
   items:[{id:'p1',name:'Plugin example',scope:'GLOBAL',skills:[{name:'s1',id:'sk1'}]}]},
  bundled_skills:{status:'complete',complete:true,kind:'bundled_in_explicitly_installed_plugins',
   items:[{name:'s1',parent_plugin_id:'p1'}]},warnings:[]};
 await e.submit(o);const j=await e.drain();
 assert.equal(j.status,'completed');
 assert(!e.calls.some(x=>x.type==='CAE_GET_CHAT'||x.type==='CAE_SOURCE_START'),'metadata-only snapshot must not fetch content');
 const dir='ChatGPT/Workspace test/_workspace_configuration.json';
 const config=JSON.parse(await e.read(dir));
 assert.equal(config.plugins.items.length,1);assert.equal(config.skills.items.length,1);
 assert.equal(config.active_scope.account_id,e.account);
 assert((await e.read('ChatGPT/Workspace test/_personalization.md')).includes('Settings'));
 console.log('PASS: durable manual configuration-only export to the existing Vault with zero chat/Source downloads');
})().catch(e=>{console.error(e);process.exitCode=1;});
