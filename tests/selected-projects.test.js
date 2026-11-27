const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../lib/api.js'),'utf8');
const calls=[];
const sandbox={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/c/11111111-1111-1111-1111-111111111111'},
 Date,Set,Map,console,URL,AbortSignal,setTimeout,clearTimeout,
 fetch:async(path,options={})=>{
  calls.push({path,options});let j;
  if(path==='/api/auth/session')j={accessToken:'TOKEN',account:{id:'workspace'}};
  else if(path.includes('/sidebar'))j={items:[{gizmo:{gizmo:{id:'g-p-11111111111111111111111111111111',display:{name:'One'}},files:[]}},{gizmo:{gizmo:{id:'g-p-22222222222222222222222222222222',display:{name:'Two'}},files:[]}}],cursor:null};
  else if(path.includes('/connector_scopes'))j={items:[],cursor:null};
  else if(path==='/backend-api/gizmos/g-p-33333333333333333333333333333333')j={gizmo:{id:'g-p-33333333333333333333333333333333',display:{name:'Hidden in sidebar'}},files:[]};
  else if(path.includes('/files/download/'))j={download_url:'https://chatgpt.com/backend-api/estuary/content?id=file_x&sig=PRIVATE'};
  else throw Error('Unexpected request: '+path);
  return{ok:true,status:200,json:async()=>j,headers:{get:()=> 'application/json'}};
 }};
vm.runInContext(code,require('./provider-bootstrap').boot(sandbox));
(async()=>{
 const ctx=await sandbox.window.ChatArchiveApi.getWorkspaceSnapshot('workspace',()=>{}, {projectIds:['g-p-22222222222222222222222222222222'],includePersonalization:false});
 assert.equal(ctx.projects.length,1);assert.equal(ctx.projects[0].gizmo.id,'g-p-22222222222222222222222222222222');
 assert(!calls.some(x=>x.path.includes('/g-p-11111111111111111111111111111111/connector_scopes')));
 assert(!calls.some(x=>x.path.includes('user_system_messages')||x.path.includes('memories')));
 assert.equal(ctx.personalization_requested,false);
 const second=await sandbox.window.ChatArchiveApi.getWorkspaceSnapshot('workspace',()=>{}, {projectIds:['g-p-33333333333333333333333333333333'],includePersonalization:false});
 assert.equal(second.projects[0].gizmo.id,'g-p-33333333333333333333333333333333');
 const loc=await sandbox.window.ChatArchiveApi.sourceLocation('file_x','g-p-22222222222222222222222222222222','workspace');
 assert.equal(loc.headers.Authorization,'Bearer TOKEN');
 assert(!JSON.stringify(ctx).includes('TOKEN'));
 assert(!JSON.stringify(ctx).includes('PRIVATE'));
 await assert.rejects(sandbox.window.ChatArchiveApi.sourceLocation('file_x','g-p-22222222222222222222222222222222','other-workspace'),/Workspace changed/);
 console.log('PASS: selected-project context without Select All, detail fallback, no unrelated connector/personalization/Memory calls, source auth stays in content script');
})().catch(e=>{console.error(e);process.exitCode=1;});
