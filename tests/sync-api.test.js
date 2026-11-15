'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../lib/api.js'),'utf8');
const pid='g-p-11111111111111111111111111111111',account='account-one';
function make(responder){
  let clock=Date.parse('2026-11-09T20:00:00Z');const calls=[];
  const D=class extends Date {static now(){return clock;}};
  const box={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/c/aaaaaaaa-1111-2222-3333-444444444444'},URL,AbortSignal,Date:D,
    setTimeout:(cb,ms)=>{clock+=ms;queueMicrotask(cb);},
    fetch:async(p,o)=>{calls.push({path:p,opts:o});if(p==='/api/auth/session')return Response.json({account:{id:account},accessToken:'private-token'});return responder(p,o);}};
  vm.runInNewContext(source,box);return {api:box.window.ChatArchiveApi,calls};
}
(async()=>{
 const p={gizmo:{id:pid,workspace_id:account,instructions:'user instructions',display:{name:'Test'},memory_scope:'DO_NOT_EXPORT'},files:[]};
 let env=make(()=>Response.json({items:[{gizmo:p}],cursor:'next-cursor'}));
 let r=await env.api.backgroundPage({kind:'projects'},account);
 assert.equal(r.items.length,1);assert.equal(r.cursor,'next-cursor');assert(!JSON.stringify(r).includes('DO_NOT_EXPORT'));
 assert.equal(env.calls.filter(x=>x.path.includes('backend-api')).length,1,'one metadata page per task');
 assert.equal(env.calls.at(-1).opts.headers.Authorization,'Bearer private-token');
 assert(!JSON.stringify(r).includes('private-token'));
 await assert.rejects(env.api.backgroundPage({kind:'projects'},'other-account'),e=>e.code==='WORKSPACE_CHANGED');
 assert.equal(env.calls.filter(x=>x.path.includes('backend-api')).length,1,'mismatch must stop before backend');
 const list=Array.from({length:100},(_,i)=>({id:'id-'+i,create_time:111,update_time:999}));
 env=make(()=>Response.json({items:list,total:120}));r=await env.api.backgroundPage({kind:'chats',offset:0},account);
 assert.equal(r.nextOffset,100);assert.equal(r.items[0].created,111);assert.equal(r.items[0].updated,999);
 await assert.rejects(env.api.backgroundPage({kind:'chats',offset:12},account),/offset/);
 await assert.rejects(env.api.backgroundPage({kind:'project_chats',projectId:'../../memories'},account),/project ID/);
 await assert.rejects(env.api.backgroundPage({kind:'memory'},account),/Unknown/);
 env=make(()=>Response.json({items:[{scope_id:'scope-one',connector_files:[{info:{id:'file_a',size:12},location:'sediment'}]}],cursor:null}));
 r=await env.api.backgroundPage({kind:'connectors',projectId:pid},account);assert.equal(r.items[0].connector_files[0].info.id,'file_a');
 env=make(()=>Response.json({items:[],cursor:null,project_connectors_enabled:false}));
 await assert.rejects(env.api.backgroundPage({kind:'connectors',projectId:pid},account),/not authoritative/);
 env=make(()=>Response.json({about_model_message:'instructions',personality_traits:{tone:'direct'},memories:'EXCLUDE'}));
 r=await env.api.backgroundPage({kind:'personalization'},account);assert.equal(r.about_model_message,'instructions');assert(!('memories'in r));
 env=make(()=>new Response('',{status:429,headers:{'retry-after':'180'}}));
 await assert.rejects(env.api.backgroundPage({kind:'chats'},account),e=>e.code==='API_COOLDOWN'&&e.retryAfterMs===180000);
 const before=env.calls.length;
 await assert.rejects(env.api.backgroundPage({kind:'chats'},account),e=>e.code==='API_COOLDOWN');
 assert.equal(env.calls.length,before,'cooldown must prevent both session and backend retries');
 env=make(()=>Response.json({gizmo:{id:pid}}));
 await assert.rejects(env.api.backgroundPage({kind:'project',projectId:pid},account),/Incomplete/);
 console.log('PASS: background API allowlist, workspace gate, one-page inventories, explicit created dates, auth isolation, no Memory, cooldown without retries, partial-schema refusal');
})().catch(e=>{console.error(e);process.exitCode=1;});
