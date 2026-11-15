'use strict';
const assert=require('node:assert/strict');
require('../lib/normalize.js');
const C=require('../lib/config-inventory.js'),M=require('../lib/meta.js');
const A='business-workspace',B='neighbor-workspace';
const session={account:{id:A,structure:'workspace',name:'Team Name'},user:{id:'user-one',name:'Display User'}};
const identity=C.identity(session,{id:'user-one',name:'Display User',email:'must-not-store@example.net',secret:'hidden'},A);
assert.equal(identity.display_name,'Team Name (Display User)');assert(!JSON.stringify(identity).includes('@'));
assert.throws(()=>C.identity(session,{id:'user-two',name:'Someone'},A),/identity changed/);
assert.throws(()=>C.identity(session,{id:'user-one'},B),/does not match/);
const builtin={id:'default-id',name:'system',scope:'GLOBAL',installation_policy:'INSTALLED_BY_DEFAULT',installed_at:null};
const installed={id:'id-a',name:'github',scope:'GLOBAL',workspace_id:null,
  installed_at:'2026-11-11T10:00:00Z',status:'DISABLED',enabled:false,disabled_skill_names:['skill-b'],
  release:{version:'1.2.3',display_name:'GitHub',interface:{developer_name:'OpenAI'},
    app_manifest:{private_token:'NEVER'},skills:[{name:'skill-a',plugin_release_skill_id:'skill-id',description:'Public summary',
      interface:{display_name:'Skill A'}}]},authorization:{token:'NEVER'}};
const scoped={...installed,id:'id-b',name:'business-plugin',scope:'WORKSPACE',workspace_id:A};
const global=C.pluginPage({plugins:[builtin,installed],pagination:{next_page_token:null}},'GLOBAL',A);
const local=C.pluginPage({plugins:[scoped],pagination:{next_page_token:null}},'WORKSPACE',A);
assert.equal(global.items.length,1);assert.equal(global.items[0].status,'DISABLED','disabled user-installations remain in history');
assert.equal(local.items[0].workspace_id,A);
assert.throws(()=>C.pluginPage({plugins:[{...scoped,workspace_id:B}],pagination:{}},'WORKSPACE',A),/another workspace/);
const both=C.pluginsFromPages({GLOBAL:{status:'complete',complete:true,pages:1,items:global.items},
  WORKSPACE:{status:'complete',complete:true,pages:1,items:local.items}},A);
assert.equal(both.plugins.items.length,2);assert.equal(both.skills.items.length,2);
assert.equal(both.plugins.complete,true);
assert(!JSON.stringify(both).includes('NEVER'));
const gpts=C.gpts({gizmos:[{gizmo:{id:'g-1234567890',workspace_id:A,display:{name:'Tutor',description:'A tutor'},
 author:{display_name:'Author'},instructions:'PRIVATE - NEVER'}},
 {gizmo:{id:'g-abcdef1234',workspace_id:B,display:{name:'Neighbor'}}}]},A);
assert.equal(gpts.items.length,1);assert.equal(gpts.items[0].name,'Tutor');
assert(!JSON.stringify(gpts).includes('PRIVATE'));
const config={active_scope:{account_id:A},identity,custom_gpts:gpts,installed_plugins:both.plugins,
  bundled_skills:both.skills,projects:[],projects_complete:true,selection:'all_projects'};
const full=JSON.parse(M.renderWorkspaceConfiguration(config,'2026-11-14T12:00:00Z'));
assert.equal(full.plugins.items.length,2);assert.equal(full.skills.items.length,2);
assert.equal(full.active_scope.account_id,A);
assert(!JSON.stringify(full).includes('memories'));
const failed=JSON.parse(M.renderWorkspaceConfiguration({...config,installed_plugins:null,bundled_skills:null},'2026-11-15T12:00:00Z'));
const retained=JSON.parse(M.mergeWorkspaceConfiguration(full,failed,A));
assert.equal(retained.plugins.items.length,2);assert.equal(retained.plugins.retained_from_previous_complete_snapshot,true);
assert.equal(retained.skills.items.length,2);
assert.throws(()=>M.mergeWorkspaceConfiguration(full,failed,B),/current-scope/);
assert.throws(()=>M.mergeWorkspaceConfiguration({...full,active_scope:{account_id:B}},failed,A),/another workspace/);
console.log('PASS: account identity, user installations only, scoped Plugins/bundled Skills, opaque secrets excluded, GPT filtering, completeness retention and strict workspace merge');
