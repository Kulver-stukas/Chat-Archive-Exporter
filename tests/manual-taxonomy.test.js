'use strict';
const assert=require('node:assert/strict'),{createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment();await e.C.startup();
 const id='g-EngflyTutor123456',gpt={...e.chat(2,'A chat with Tutor'),projectId:'',project:'',gptId:id,gptName:'Tutor'};
 await e.submit(e.opts('job-gpt-12345',[gpt]));let j=await e.drain();
 assert.equal(j.status,'completed');
 let ledger=JSON.parse(await e.read('ChatGPT/Workspace test/.workspace.json'));
 const path=ledger.chats[gpt.id].path;
 assert(path.includes('/_GPTs/Tutor ['));
 const text=await e.read(path);
 assert(text.includes('container_type: "gpt"'));assert(text.includes('container_id: "'+id+'"'));
 let config=JSON.parse(await e.read('ChatGPT/Workspace test/_workspace_configuration.json'));
 assert.equal(config.custom_gpts.items.length,1);
 assert.equal(config.plugins.items,null);
 assert.equal(config.projects.status,'complete','selection does not restrict configuration');
 e.context={captured_at:'2026-11-12T02:00:00Z',projects_complete:true,personalization:null,
  projects:[{gizmo:{id:e.pid,display:{name:'Project test'},instructions:'User-owned configuration'},files:[],connectors:[]}],warnings:[]};
 const option=e.opts('job-empty-project-12345',[]);
 option.selectedProjectIds=[e.pid];
 await e.submit(option);j=await e.drain();
 assert.equal(j.status,'completed');
 const projectText=await e.read('ChatGPT/Workspace test/Project test/_project.md');
 assert(projectText.includes('User-owned configuration'));
 console.log('PASS: manual GPT archive path, explicit GPT YAML, honest root inventory, empty Project metadata without fake chat');
})().catch(e=>{console.error(e);process.exitCode=1;});
