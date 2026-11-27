const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../lib/normalize.js');
const sort = require('../lib/sort.js');
const meta = require('../lib/meta.js');

const a = {id:'a',title:'Alpha',updated:1794138880};
const b = {id:'b',title:'Beta',updated:'2026-11-07T11:00:00Z'};
const c = {id:'c',title:'Charlie',created:'2026-10-03T00:00:00Z'};
const d = {id:'d',title:'Delta'};
const e = {id:'e',title:'Echo',updated:'bad-date',created:1794138000};
assert.equal(sort.timestamp(1794138880),1794138880000);
assert.equal(sort.timestamp('1794138880000'),1794138880000);
assert.equal(sort.timestamp('bad-date'),null);
assert.equal(sort.chatDate(e),1794138000000);
assert.deepEqual([b,c,d,a,e].sort(sort.compareChats).map(x=>x.id),['a','e','b','c','d']);
const groups = [
  ['old',{name:'Old Project',entries:[c]}],
  ['new',{name:'New Project',entries:[d,a]}],
  ['none',{name:'Without project',entries:[b]}]
];
assert.deepEqual(groups.sort(sort.compareGroups).map(x=>x[0]),['new','none','old']);

const source = {
  id:'f1', file_id:'file_1',name:'Saved.txt',type:'text/plain',size:8902,
  created_at:'2026-11-08T13:56:41Z',location:'sediment',
  metadata:{project_save:{save_id:'save1',project_id:'p1',conversation_id:'c1',conversation_title:'A chat',message_id:'m1',creator_id:'hidden-user-id'}}
};
const context={captured_at:'2026-11-08T14:00:00Z',projects:[
  {gizmo:{id:'g-p-11111111111111111111111111111111',workspace_id:'business-scope',instructions:'Keep exact text, including ``` triple ticks',
    display:{name:'Principia Cognitia',description:'A project',theme:'#FF4400',emoji:'book'},
    created_at:'2026-10-02',updated_at:'2026-11-08'},
    files:[source,{file_id:'file2',name:'Space.txt',created_at:'2026-11-08',metadata:{knowledge_store_info:{source_kind:'library_file'}},size:null,last_modified:null}],
    connectors:[{scope_id:'scope1',connector_type:'google_drive',scope_type:'google_drive_file',display_name:'Drive File.txt',
      canonical_handle:'driveid',original_url:'https://drive.google.com/file/d/driveid',created_at:'2026-11-08',
      last_synced_at:'2026-11-08T11:58:50Z',connector_files:[{info:{id:'sediment-file',name:'Drive File.txt',size:230333,type:'text/plain'},location:'sediment'}]}]}
],personalization:{about_model_message:'Respond without rhetoric.\nKeep backticks ``` intact.',personality_traits:{verbosity:2},enabled:true}};
const entries=meta.entries(context,'Business');
assert.equal(entries.length,5);
assert(entries.some(x=>x.path.endsWith('/_archive_report.md')));
const project=entries.find(x=>x.path.endsWith('/_project.md'));
const sources=entries.find(x=>x.path.endsWith('/_sources.md'));
const prefs=entries.find(x=>x.path.endsWith('/_personalization.md'));
const configuration=entries.find(x=>x.path.endsWith('/_workspace_configuration.json'));
assert(configuration);
const config=JSON.parse(configuration.content);
assert.equal(config.plugins.complete,false);assert.equal(config.skills.items,null);
assert(project.content.includes('Keep exact text, including ``` triple ticks'));
assert(sources.content.includes('saved_response'));
assert(sources.content.includes('scope1'));
assert(sources.content.includes('## Source overview'));
assert(sources.content.includes('Saved.txt | saved_response'));
assert(sources.content.includes('sediment-file'));
assert(sources.content.includes('"message_id": "m1"'));
assert(sources.content.includes('"size_bytes": null'));
assert(!sources.content.includes('hidden-user-id'));
assert(!sources.content.includes('download_url'));
assert(prefs.content.includes('Respond without rhetoric'));
assert(!prefs.content.toLowerCase().includes('saved memories'));
const noPrefs=meta.entries({ ...context, personalization: null },'Business');
assert.equal(noPrefs.length,4);

// API transport mock: one sidebar, one connector scopes, one personalization call.
const apiCode=fs.readFileSync(path.join(__dirname,'../providers/chatgpt/api.js'),'utf8');
const requested=[];
const apiSession={ accessToken:'private-test-token', account:{id:'business-scope',name:'Business'} };
const mockFetch=async (url,options={}) => {
  requested.push({url, auth:options.headers?.Authorization || ''});
  let j;
  if (url==='/api/auth/session') j=apiSession;
  else if (url.startsWith('/backend-api/gizmos/snorlax/sidebar')) {
    j={items:[{gizmo:{gizmo:context.projects[0].gizmo, files:context.projects[0].files}}],cursor:null};
  } else if (url.includes('/connector_scopes')) j={items:context.projects[0].connectors,cursor:null};
  else if(url==='/backend-api/user_system_messages') j=context.personalization;
  else throw Error('Unrecognized mocked URL '+url);
  return {ok:true,status:200,headers:{get:x=>x==='content-type'?'application/json':null},json:async()=>j};
};
const sandbox={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/c/11111111-1111-1111-1111-111111111111'},
  fetch:mockFetch, Date, Set,Map,console,AbortSignal,URL,setTimeout,clearTimeout};
vm.runInContext(apiCode,require('./provider-bootstrap').boot(sandbox),{filename:'providers/chatgpt/api.js'});
assert.equal(requested.length,0,'API does not run until invoked');
(async()=>{
  const result=await sandbox.window.ChatArchiveApi.getWorkspaceSnapshot('business-scope');
  assert.equal(result.projects.length,1);
  assert.equal(result.projects[0].files.length,2);
  assert.equal(result.projects[0].connectors.length,1);
  assert.equal(result.personalization.about_model_message,context.personalization.about_model_message);
  assert.deepEqual(requested.filter(x=>x.url!=='/api/auth/session').map(x=>x.url.split('?')[0]),[
    '/backend-api/gizmos/snorlax/sidebar',
    '/backend-api/projects/g-p-11111111111111111111111111111111/connector_scopes',
    '/backend-api/user_system_messages'
  ]);
  assert(requested.filter(x=>x.url==='/api/auth/session').length>=2,
    'Current scope must be rechecked before metadata requests.');
  assert(requested.every(x=>!x.url.includes('memories')));
  assert(requested.every(x=>!x.url.includes('estuary')));
  assert(requested.every(x=>!x.url.includes('download')));
  assert(requested.filter(x=>x.url!=='/api/auth/session').every(x=>x.auth==='Bearer private-test-token'));
  console.log('PASS: updated/created sorting, project groups, source categories, personalization, read-only lazy metadata snapshot');
})().catch(e=>{console.error(e);process.exitCode=1;});
