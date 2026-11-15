'use strict';
const assert=require('node:assert/strict');
const C=require('../lib/config-inventory.js'),M=require('../lib/meta.js');
const account='workspace-current',foreign='workspace-foreign';
const sample={items:[{
 id:'Automation_daily',title:'Daily research digest',prompt:'Full prompt '+('reliable information. '.repeat(150)),
 schedule:'BEGIN:VEVENT\nDTSTART;TZID=Etc/GMT-3:20261115T143800\nRRULE:FREQ=DAILY\nEND:VEVENT',
 is_enabled:true,updated_at:'2026-11-15T10:00:00Z',last_run_time:null,
 default_timezone:'Etc/GMT-3',timing_mode:'flexible_schedule',executor:'cloud',
 conversation_id:'aaaaaaaa-0000-1111-2222-333333333333',
 notifications_enabled:true,email_enabled:false,schedule_components:{frequency:'daily',by_hour:6,by_minute:38},
 webhook_triggers:[{type:'github',name:'New issue',secret:'DO-NOT-STORE'}],
 internal_api_key:'DO-NOT-STORE',memory:{contents:'DO-NOT-STORE'}
}],cursor:null};
const scheduled=C.automationPage(sample,'scheduled',account);
assert.equal(scheduled.cursor,null);
assert.equal(scheduled.items.length,1);
const task=scheduled.items[0];
assert.equal(task.prompt,sample.items[0].prompt);
assert.equal(task.schedule,sample.items[0].schedule);
assert.equal(task.timezone,'Etc/GMT-3');
assert.equal(task.notifications_enabled,true);
assert.equal(task.email_enabled,false);
assert.equal(task.is_enabled,true);
assert.equal(task.updated_at,'2026-11-15T10:00:00Z');
assert(!Object.hasOwn(task,'last_run_time'),'last-run observations are not schedule settings');
assert(!JSON.stringify(task).includes('DO-NOT-STORE'));
assert.throws(()=>C.automationPage({items:[{id:'wrong',workspace_id:foreign}]},'paused',account),/another workspace/);
assert.throws(()=>C.automationPage({items:[],cursor:3},'scheduled',account),/cursor/);
assert.throws(()=>C.automationPage({items:[{id:'oversize',prompt:'x'.repeat(270000)}]},'scheduled',account),/limit/);
const empty={items:[],cursor:null};
const finished=C.automationPage(empty,'finished',account);
const paused=C.automationPage({items:[{id:'Automation_paused',title:'Paused reminder',prompt:'Notify me',
 is_enabled:false,schedule:'BEGIN:VEVENT\nRRULE:FREQ=WEEKLY;BYDAY=FR\nEND:VEVENT'}],cursor:null},'paused',account);
const all=C.automationsFromPages({scheduled:{...scheduled,complete:true,status:'complete',pages:1},
 paused:{...paused,complete:true,status:'complete',pages:1},finished:{...finished,complete:true,status:'complete',pages:1}});
assert.equal(all.status,'complete');assert.equal(all.items.length,2);
let current=JSON.parse(M.renderWorkspaceConfiguration({active_scope:{account_id:account},
 projects:[],projects_complete:true,schedules:all},'2026-11-15T00:00:00Z'));
assert.equal(current.schedules.items.length,2);
assert.equal(current.schedules.status,'complete');
assert(!JSON.stringify(current).includes('DO-NOT-STORE'));
let partial=JSON.parse(M.renderWorkspaceConfiguration({active_scope:{account_id:account},
 projects:[],projects_complete:true,schedules:{status:'partial',complete:false,items:[]}},'2026-11-15T01:00:00Z'));
let merged=JSON.parse(M.mergeWorkspaceConfiguration(current,partial,account));
assert.equal(merged.schedules.items.length,2,'failed or partial list must not erase full old list');
assert.equal(merged.schedules.retained_from_previous_complete_snapshot,true);
assert.equal(M.sameConfiguration(current,merged),false,'retention flag is a meaningful qualifier');
const noChange=JSON.parse(JSON.stringify(current));noChange.captured_at='2026-11-16T00:00:00Z';
assert.equal(M.sameConfiguration(current,noChange),true,'time alone is not a configuration change');
const removed=JSON.parse(JSON.stringify(current));removed.schedules.items=[];
assert.equal(M.sameConfiguration(current,removed),false,'verified removal must be written');
assert.throws(()=>M.mergeWorkspaceConfiguration({...current,active_scope:{account_id:foreign}},partial,account),/another workspace/);
console.log('PASS: scheduled/paused/finished normalization, complete source prompts and RRULE, current-account ownership, no secrets, retention, meaningful-change comparison');
