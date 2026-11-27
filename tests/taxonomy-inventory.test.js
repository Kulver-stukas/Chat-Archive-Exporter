'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
require('../lib/normalize.js');
const P=require('../lib/paths.js'),M=require('../lib/meta.js');
const pid='g-p-11111111111111111111111111111111',gid='g-EngflyTutor123456',account='workspace-test';
const cid='aaaaaaaa-1111-2222-3333-444444444444';
assert(P.isProject(pid));assert(!P.isProject(gid));assert(P.isGPT(gid));assert(!P.isGPT(pid));
const layout=P.createLayout('Business',[{id:pid,name:'Project'}]);
assert(layout.chatPath({id:cid,title:'Chat',gptId:gid,gptName:'Tutor'}).includes('/_GPTs/Tutor ['));
assert(layout.chatPath({id:cid,title:'Chat',projectId:pid,project:'Project'}).includes('/Project/'));
const requests=[];
const testContext={window:{},location:{origin:'https://chatgpt.com',pathname:'/c/'+cid},document:{cookie:''},
  Date,URL,AbortSignal,setTimeout,clearTimeout,console,Map,Set,
  fetch:async request=>{
    requests.push(request);
    let data;
    if(request==='/api/auth/session')data={account:{id:account},accessToken:'secret'};
    else if(request.includes('gizmos/snorlax/sidebar')) data={items:[
      {gizmo:{gizmo:{id:pid,display:{name:'Project'}},files:[]}},
      {gizmo:{gizmo:{id:gid,display:{name:'Tutor'}},files:[]}}
    ],cursor:null};
    else if(request.includes('/gizmos/'+pid+'/conversations'))data={items:[],cursor:null};
    else if(request.includes('/backend-api/conversations'))data={items:request.includes('is_archived=true')?[]:[
      {id:cid,title:'GPT chat',gizmo_id:gid,gpt_name:'Tutor',create_time:1780000000,update_time:1780000100},
      {id:'bbbbbbbb-1111-2222-3333-444444444444',title:'ordinary',create_time:1780000000}
    ],total:2};
    else if(request.includes('/connector_scopes'))data={items:[],cursor:null};
    else throw Error('Unexpected endpoint '+request);
    return Response.json(data);
  }
};
vm.createContext(testContext);require('./provider-bootstrap').boot(testContext);vm.runInContext(fs.readFileSync(path.join(base,'lib/api.js'),'utf8'),testContext);
(async()=>{
 const api=testContext.window.ChatArchiveApi;
 const result=await api.listAll();
 assert.equal(result.projects.length,1,'GPT sidebar wrapper must not be treated as a Project');
 assert.equal(result.projects[0].id,pid);
 const chat=result.items.find(x=>x.id===cid);
 assert.equal(chat.projectId,'');assert.equal(chat.gptId,gid);
 assert.equal(chat.gptName,'Tutor');
 assert(!requests.some(p=>p.includes('/gizmos/'+gid+'/conversations')),
   'GPT chats never use the Project-only conversation endpoint');
 const bg=await api.backgroundPage({kind:'projects'},account);
 assert.equal(bg.items.length,1,'background inventory drops non-Project gizmos');
 const conf=JSON.parse(M.renderWorkspaceConfiguration({projects:[],projects_complete:false,
   gpts:[{id:gid,name:'Tutor'}]},'2026-11-12T20:00:00Z'));
 assert.equal(conf.custom_gpts.items[0].id,gid);
 assert.equal(conf.custom_gpts.complete,false);
 assert.equal(conf.plugins.items,null);assert.equal(conf.skills.items,null);
 assert(!JSON.stringify(conf).includes('secret'));
 assert(!JSON.stringify(conf).includes('memories'));
 console.log('PASS: strict project-vs-GPT taxonomy, no invalid project request, distinct GPT folder, honest plugins/skills inventory');
})().catch(e=>{console.error(e);process.exitCode=1;});
