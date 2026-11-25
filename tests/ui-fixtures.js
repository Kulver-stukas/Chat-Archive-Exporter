/* Entirely synthetic browser UI fixtures; no real accounts, network or filesystem. */
(()=>{
 const event=()=>({listeners:[],addListener(f){this.listeners.push(f)},removeListener(f){this.listeners=this.listeners.filter(x=>x!==f)},fire(...a){this.listeners.forEach(f=>f(...a))}});
 const pid='g-p-'+'1'.repeat(32),empty='g-p-'+'2'.repeat(32),cid='aaaaaaaa-1111-2222-3333-444444444444';
 window.__ui={calls:[],rpc:[],opens:[],closes:[],errors:[],starts:0,archives:[],grants:0,binds:0,reject:false,permission:'granted',manual:null,
  scope:{accountId:'test-workspace',observed:true,display:'Test workspace',currentId:cid},
  sync:{enabled:false,status:'disabled',queue:0},
  items:[{id:cid,title:'Architecture review',projectId:pid,project:'Engineering',updated:'2026-11-15T10:00:00Z'},
   {id:'bbbbbbbb-1111-2222-3333-444444444444',title:'Release checklist',projectId:pid,project:'Engineering',archived:true},
   {id:'cccccccc-1111-2222-3333-444444444444',title:'Independent conversation',projectId:''}],
  projects:[{id:pid,name:'Engineering'},{id:empty,name:'Empty project'}],local:{},session:{},lib:null};
 const t=window.__ui,dir={name:'Test Vault'};
 const catalog={schema:'cae.library-inventory.v3',captured_at:'2026-11-17T09:00:00Z',active_scope:{account_id:'test-workspace'},status:'complete',classification_status:'complete',warnings:[],
  summary:{total:4,library_files:4,images_gallery:1,folders:1,classified:3,project_source_excluded:1,selectable:2},items:[
   {id:'file:file_0001',file_id:'file_0001',name:'Project instructions.md',origin:'unknown',origin_status:'not_requested_project_source',media_class:'file',format_class:'text',contexts:['library','project_source'],placements:[{type:'project_source',project_name:'Engineering'}],library_locations:[],managed_by_project_sources:true,archive_eligibility:{selectable:false}},
   {id:'file:file_0002',file_id:'file_0002',name:'Generated illustration.png',origin:'generated',origin_status:'inferred',media_class:'image',format_class:'image',contexts:['library','generated_image_gallery'],placements:[],library_locations:[],archive_eligibility:{selectable:true}},
   {id:'file:file_0003',file_id:'file_0003',name:'report.md',origin:'generated',origin_status:'inferred',media_class:'file',format_class:'text',contexts:['library'],placements:[],library_locations:[],archive_eligibility:{selectable:true}},
   {id:'file:file_0004',file_id:'file_0004',name:'archived-notes.md',origin:'uploaded',origin_status:'inferred',media_class:'file',format_class:'text',contexts:['library'],placements:[],library_locations:[],archive_eligibility:{selectable:true},archive:{status:'saved'}}]};
 function finishLib(){t.lib={account_id:t.scope.accountId,enabled:false,baseline_at:'2026-11-17T08:00:00Z',catalog_revision:1,catalog:structuredClone(catalog),job:{id:'library-job',status:'complete',active:false,detail:'Inventory saved to Vault.'}};}
 finishLib();
 window.finishUIManual=()=>{if(t.manual){t.manual.active=false;t.manual.status='completed';t.manual.message='Export complete.';chrome.storage.onChanged.fire({'cae.manual-status.v1':{newValue:t.manual}},'local');}};
 window.finishUILibrary=()=>{finishLib();chrome.storage.onChanged.fire({'cae.library-status.v1':{newValue:{account_id:t.scope.accountId}}},'local');};
 function area(name){return {get:(keys,cb)=>{const all=t[name];let r={};if(keys==null)r={...all};else if(typeof keys==='string')r={[keys]:all[keys]};else if(Array.isArray(keys))keys.forEach(k=>r[k]=all[k]);else r={...keys,...all};if(cb)queueMicrotask(()=>cb(r));return Promise.resolve(r);},set:async value=>{const changes={};for(const [k,v]of Object.entries(value)){changes[k]={oldValue:t[name][k],newValue:v};t[name][k]=v;}chrome.storage.onChanged.fire(changes,name);},remove:async()=>{}};}
 const tab=()=>({id:11,windowId:1,url:'https://chatgpt.com/c/'+t.scope.currentId,title:'Architecture review - ChatGPT',active:true});
 window.chrome={runtime:{id:'mock-extension',getURL:p=>'https://cae.test/'+p,getManifest:()=>({version:'0.1.7'}),onMessage:event(),lastError:null,
  connect:()=>({postMessage(){},onDisconnect:event(),disconnect(){}}),sendMessage:async m=>{
   t.calls.push(structuredClone(m));
   if(m.type==='CAE_EXPORT_PREFS_GET'||m.type==='CAE_EXPORT_PREFS_PATCH'){
    const key='cae.export.preferences.v1',defaults={questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:true};
    const value={...defaults,...t.local[key],...(m.type==='CAE_EXPORT_PREFS_PATCH'?m.patch:{}),_revision:(t.local[key]?._revision||0)+(m.type==='CAE_EXPORT_PREFS_PATCH'?1:0)};
    if(m.type==='CAE_EXPORT_PREFS_PATCH')await chrome.storage.local.set({[key]:value});
    return {ok:true,result:structuredClone(value)};
   }
   if(m.type==='CAE_MANUAL_STATUS')return {ok:true,result:structuredClone(t.manual)};
   if(m.type==='CAE_MANUAL_SUBMIT'){
    if(t.reject)return {ok:false,error:'Fixture: job rejected before acceptance'};
    const o=m.options;t.manual={id:'manual-job',accountId:o.accountId,workspace:t.scope.display,mode:o.mode,destination:o.destination,status:'queued',active:true,phase:'chats',message:'Export accepted.',totalChats:o.items.length,chatsDone:0,counts:{saved:0,skipped:0,failed:0},logs:[]};return {ok:true,result:structuredClone(t.manual)};
   }
   if(m.type==='CAE_MANUAL_CANCEL'){t.manual.active=false;t.manual.status='cancelled';return {ok:true,result:structuredClone(t.manual)};}
   if(m.type==='CAE_SYNC_STATUS')return {ok:true,result:structuredClone(t.sync)};
   if(m.type==='CAE_SYNC_ENABLE'){t.sync={...m.options,enabled:true,status:'idle',startedAt:'2026-11-17T10:00:00Z',trackedChats:3};return {ok:true,result:structuredClone(t.sync)};}
   if(m.type==='CAE_SYNC_PAUSE'){t.sync.enabled=false;t.sync.status='paused';return {ok:true,result:structuredClone(t.sync)};}
   if(m.type==='CAE_LIBRARY_JOB_STATUS'){let r=structuredClone(t.lib);if(r&&m.withCatalog===false)delete r.catalog;return {ok:true,result:r};}
   if(m.type==='CAE_LIBRARY_JOB_START'){t.starts++;t.lib.job={id:'scan',status:'running',active:true,detail:'Scanning files'};return {ok:true,result:structuredClone(t.lib)};}
   if(m.type==='CAE_LIBRARY_JOB_ARCHIVE'){if(t.reject)return {ok:false,error:'Fixture: archive rejected'};t.archives.push(m.options);t.lib.job={id:'archive',status:'running',active:true,detail:'Archiving originals'};return {ok:true,result:structuredClone(t.lib)};}
   if(m.type==='CAE_LIBRARY_JOB_STOP'){t.lib.job={status:'cancelled',active:false,detail:'Stopped'};t.lib.enabled=false;return {ok:true,result:structuredClone(t.lib)};}
   if(m.type==='CAE_LIBRARY_JOB_MONITOR'){t.lib.enabled=m.enabled;return {ok:true,result:structuredClone(t.lib)};}
   if(m.type==='CAE_VAULT_DIAGNOSTICS')return {ok:true,result:{schema:'fixture',events:[]}};
   if(m.type==='CAE_UI_WIDGET_BIND')t.binds++;
   if(m.type==='CAE_UI_WIDGET_BIND'||m.type==='CAE_UI_WIDGET_STATUS')return {ok:true,result:{verified:true,canExport:true,
    workspace:t.scope.display,label:'Idle - monitoring enabled',icon:'idle',busy:false,monitoring:true,
    monitoringSummary:'Monitoring enabled; waiting for changes',vault:'AI_Vault - Connected',
    manualSummary:'Complete - Manual Vault export completed. Chats: 0 saved, 0 skipped, 0 failed.',
    librarySummary:'Complete: List check complete; no new eligible files; no old descriptors requested.',
    syncSummary:'Idle · 90 archived chats · 3 queued · 0 buffered · 0 conflicts',
    syncVault:'AI_Vault',syncSince:'2026-11-10T17:26:48Z',syncMessage:'Conversation metadata page checked.',
    logs:{manual:['[5:14:23 PM] info: Manual export accepted.','[5:14:41 PM] info: Manual Vault export completed.'],
    inventory:['[3:22:00 PM] info: Library inventory complete.'],
    monitoring:['[3:35:33 PM] info: Chat skipped: Sample chat','[3:35:56 PM] info: Chat skipped: Another chat','[3:36:01 PM] info: Conversation metadata page checked.']}}};
   return {ok:true,result:{ok:true}};
  }},
  storage:{local:area('local'),session:area('session'),onChanged:event()},
  tabs:{query:async()=>[tab()],get:async()=>tab(),create:async x=>{t.opens.push(x);return x;},onActivated:event(),onUpdated:event(),connect:()=>{
   const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage:m=>{
    t.rpc.push({...m});let result=m.type==='CAE_STATUS'?{...t.scope}:{scope:{...t.scope},items:t.items,projects:t.projects,warnings:[]};
    queueMicrotask(()=>port.onMessage.fire({id:m.id,result}));
   }};return port;
  }},
  windows:{getCurrent:async()=>({id:1}),onFocusChanged:event(),WINDOW_ID_NONE:-1},
  sidePanel:{open:async x=>t.opens.push(x),close:async x=>t.closes.push(x)}};
 window.ChatArchiveVault={restoreDirectory:async()=>dir,restoreWorkspaceDirectory:async()=>dir,rememberWorkspaceDirectory:async()=>{},rememberDirectory:async()=>{},permissionState:async()=>({state:t.permission}),hasPermission:async(d,ask)=>{if(ask){t.grants++;t.permission='granted';}return t.permission==='granted';}};
 window.ChatArchiveManualStore={bind:async()=>{},directory:async()=>dir};window.ChatArchiveLibraryStore={bind:async()=>{},directory:async()=>dir};
 window.close=()=>t.closes.push({popup:true});
})();
