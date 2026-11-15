'use strict';
const assert=require('node:assert/strict'),{createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment();
 const other='g-p-22222222222222222222222222222222';
 const extraneous={id:'file_000000000000000000000000001',name:'Unselected source.bin',
   type:'application/octet-stream',size:12,created_at:'2026-11-01T00:00:00Z',
   location:'fs',metadata:{knowledge_store_info:{source_kind:'uploaded_file'}}};
 e.context={captured_at:'2026-11-15T12:00:00Z',active_scope:{account_id:e.account},projects_complete:true,
  projects:[{gizmo:{id:e.pid,display:{name:'Project test'}},files:[],connectors:[]},
    {gizmo:{id:other,display:{name:'Another project'}},files:[extraneous],connectors:[]}],
  identity:{account_id:e.account,complete:true,scope_type:'personal',user_name:'Example'},
  schedules:{complete:true,status:'complete',items:[{id:'Automation_daily',title:'Daily',prompt:'Full prompt',
   schedule:'BEGIN:VEVENT\nRRULE:FREQ=DAILY\nEND:VEVENT'}],buckets:[]},
  personalization:{about_model_message:'My personalization'},warnings:[]};
 const opts=e.opts('initial-subset-123456',[e.chat(1)],'vault','all');
 opts.fullWorkspace=false;await e.submit(opts);const done=await e.drain(35);
 assert.equal(done.status,'completed');
 const contextCall=e.calls.find(x=>x.type==='CAE_CONTEXT');assert(contextCall);
 assert.equal(contextCall.projectIds,null,'first selective export still snapshots all projects');
 assert.equal(contextCall.includePersonalization,true);
 assert.equal(contextCall.includeConfiguration,true);
 assert(!e.calls.some(x=>x.type==='CAE_SOURCE_START'&&x.fileId===extraneous.id),
  'full metadata inventory does not authorize downloading unselected binary Sources');
 const config=JSON.parse(await e.read('ChatGPT/Workspace test/_workspace_configuration.json'));
 assert.equal(config.projects.status,'complete');
 assert.equal(config.projects.items.length,2);
 assert.equal(config.schedules.items.length,1);
 assert.equal(config.schedules.items[0].prompt,'Full prompt');
 assert((await e.read('ChatGPT/Workspace test/_personalization.md')).includes('My personalization'));
 assert((await e.read('ChatGPT/Workspace test/Another project/_sources.md')).includes('Unselected source.bin'));
 assert(!JSON.stringify(config).includes('memories'));
 console.log('PASS: first selective Vault export includes complete current configuration/Schedules while retaining selection-scoped binary Sources and unchanged paths');
})().catch(e=>{console.error(e);process.exitCode=1;});
