/* Opt-in background controller. Durable jobs contain IDs/metadata only.
 * Disk access is serialized with manual export through a cross-context Web Lock.
 * An alarm is a recovery trigger, not a permanently running loop. */
(function(root){
  'use strict';
  const P=ChatArchiveSyncPolicy,V=ChatArchiveVault,S=ChatArchiveSyncSpool,I=P.INTERVALS;
  const STORAGE='cae.background.v1', ALARM='cae-background-v1';
  const isChatUrl=s=>/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(s||'');
  const has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let data=null,loading=null,saving=Promise.resolve(),running=false,wakeTimer=null,wakeAfterRun=false;
  const armed=new Map(),arming=new Map(),recovering=new Map();
  async function load(){
    if(data)return data;
    if(!loading)loading=chrome.storage.local.get(STORAGE).then(x=>{
      const d=x[STORAGE];
      if(d&&d.schema!=='cae.background.v1')throw new Error('Unsupported background settings; no synchronization was started.');
      data=d||{schema:'cae.background.v1',workspaces:{},cooldown_until:0};
      data.workspaces ||= {};return data;
    }).finally(()=>{loading=null;});
    return loading;
  }
  function persist(){
    const snapshot=JSON.parse(JSON.stringify(data));
    if(JSON.stringify(snapshot).length>4*1024*1024)throw new Error('Background state safety limit exceeded. Pause sync and inspect the Vault.');
    saving=saving.catch(()=>{}).then(()=>chrome.storage.local.set({[STORAGE]:snapshot}));return saving;
  }
  function note(c,message,level='info'){
    c.logs ||= [];c.logs.push({at:new Date().toISOString(),level,message:String(message).slice(0,700)});c.logs=c.logs.slice(-100);
    c.message=String(message).slice(0,700);
  }
  const configPath=c=>c.prefix+'/.sync.json';
  function diskConfig(c){return {schema:'cae.background-config.v1',account_id:c.account_id,
    enabled:c.enabled,scope:c.scope,enrollment:c.enrollment,sources:c.sources,started_at:c.started_at,new_since:c.new_since,
    vault_name:c.vault_name,prefix:c.prefix,updated_at:new Date().toISOString(),
    status:c.status,message:c.message||'',tracked_chats:c.tracked_chats||0,queued_jobs:c.queue?.length||0,totals:c.totals||{}};}
  async function saveConfig(c,dir){await V.writeFile(dir,configPath(c),JSON.stringify(diskConfig(c),null,2)+'\n');}
  async function alarms(){
    await load();
    if(Object.values(data.workspaces).some(c=>c.enabled)){
      if(!(await chrome.alarms.get(ALARM)))await chrome.alarms.create(ALARM,{periodInMinutes:I.alarmMinutes});
    }else{await chrome.alarms.clear(ALARM);clearTimeout(wakeTimer);wakeTimer=null;}
  }
  function wake(delay=5000){
    if(wakeTimer)return;
    wakeTimer=setTimeout(()=>{
      wakeTimer=null;
      if(running){wakeAfterRun=true;return;}
      tick().catch(console.warn);
    },delay);
  }
  function validAccount(id){return typeof id==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(id);}
  const accessChecks=new Map();
  const accessWaitStates=new Set(['permission_required','permission_denied','vault_missing','vault_error','vault_unsupported']);
  const safeError=e=>String(e?.name||'Error').replace(/[^a-zA-Z0-9_]/g,'').slice(0,60)||'Error';
  async function inspectAccess(c,event,options={}) {
    // Serialize probes with explicit rebinds. No handle is sent through runtime
    // messaging; each context restores its own same-origin IndexedDB reference.
    const previous=accessChecks.get(c.account_id)||Promise.resolve();
    const operation=previous.catch(()=>{}).then(async()=>{
      if(!c.enabled)return {dir:null,worker:{state:'no_handle'},inactive:true};
      let dir=null,worker;
      try {dir=await V.restoreWorkspaceDirectory(c.account_id);worker=await V.permissionState(dir);}
      catch(e){worker={state:'error',errorName:safeError(e)};}
      let offscreen={permission:'unsupported',retained:false};
      if(root.ChatArchiveVaultContext?.check){
        try {offscreen=await root.ChatArchiveVaultContext.check(c.account_id,{refresh:!!options.refresh});}
        catch(e){offscreen={permission:'error',retained:false,contextError:safeError(e)};}
      }
      c.access={checkedAt:new Date().toISOString(),worker:worker.state,offscreen:offscreen.permission,
        retained:!!offscreen.retained,holderInstance:offscreen.holderInstance||null,
        errorName:worker.errorName||offscreen.errorName||null,indexError:offscreen.indexError||null,
        contextError:offscreen.contextError||null};
      if(root.ChatArchiveVaultDiagnostics){
        const D=root.ChatArchiveVaultDiagnostics;
        await D.append(c.account_id,event,{worker:worker.state,offscreen:offscreen.permission,
          panel:options.panelState,userActivation:options.userActivation,retained:!!offscreen.retained,
          retainedCount:offscreen.retainedCount,holderInstance:offscreen.holderInstance,
          errorName:c.access.errorName,indexError:c.access.indexError,contextError:c.access.contextError,
          contexts:await D.contexts()}).catch(()=>{});
      }
      // Pausing can race with an IndexedDB/IPC wait. Do not leave paused bindings
      // pinned merely because an earlier probe finished after the Pause command.
      if(!c.enabled)await root.ChatArchiveVaultContext?.release?.(c.account_id).catch(()=>{});
      return {dir,worker,offscreen,inactive:!c.enabled};
    });
    accessChecks.set(c.account_id,operation);
    try {return await operation;} finally {if(accessChecks.get(c.account_id)===operation)accessChecks.delete(c.account_id);}
  }
  function blockForAccess(c,access) {
    const state=access.worker.state;
    const table={
      prompt:['permission_required','Vault write permission is not active. With a verified local mirror, chat updates can be captured into IndexedDB until access returns.'],
      denied:['permission_denied','Vault write access is denied. No automatic permission requests; queued jobs are retained.'],
      no_handle:['vault_missing','The saved workspace Vault handle is missing. Select the existing Vault again; indexes have not been deleted.'],
      unsupported:['vault_unsupported','File System Access permission checks are unavailable in this context.'],
      error:['vault_error','Vault permission check failed ('+(access.worker.errorName||'Error')+'). This is not reported as a revoked permission.']
    };
    const [status,message]=table[state]||['vault_error','Vault file operation failed although the permission check returned granted.'];
    c.status=status;c.message=message;
    if(access.offscreen?.permission==='granted'&&state!=='granted')
      c.message+=' Offscreen has a grant but the writer does not; no writes were attempted.';
    c.blocked_until=Date.now()+60000;
  }
  async function probeAccess(account,event='diagnostic',options={}) {
    await load();const c=data.workspaces[account];
    if(!c?.enabled)return {enabled:false};
    const a=await inspectAccess(c,event,options);
    return {enabled:c.enabled,...c.access,available:a.worker.state==='granted'};
  }
  async function accessReady(account) {
    await load();const c=data.workspaces[account];if(!c?.enabled)return P.publicState(c);
    const a=await inspectAccess(c,'panel_access_ready',{refresh:true,panelState:'granted'});
    if(a.inactive)return P.publicState(c);
    if(a.worker.state!=='granted'){blockForAccess(c,a);await persist();return P.publicState(c);}
    // A permission repair must not cancel an HTTP cooldown/auth failure or reset
    // the eligibility cutoff. Only access-related waiting is cleared here.
    if(accessWaitStates.has(c.status)){
      c.blocked_until=0;c.status='queued';c.message='Vault access available; retained jobs may resume.';
      await persist();wake(500);
    }
    return P.publicState(c);
  }
  async function confirmedScope(tabId,expected){
    const t=await chrome.tabs.get(tabId);
    if(!isChatUrl(t.url)||t.discarded)throw new Error('A live ChatGPT tab for this workspace is required.');
    const rpc=ChatArchiveSyncRPC.connect(tabId);
    try{const s=await rpc.call('CAE_STATUS',{force:true});
      if(!s.observed||!s.accountId||s.accountId!==expected){const e=Error('Active ChatGPT workspace does not match this Vault.');e.code='WORKSPACE_CHANGED';throw e;}
      return s;
    }finally{rpc.close();}
  }
  // A metadata-only first export (for example an empty Project) is a valid
  // explicit Vault seed. A random folder or an unindexed JSON is not.
  async function verifiedConfigurationSeed(vault,dir,prefix,account){
    const path=prefix+'/_workspace_configuration.json';
    const record=vault.index.metadata[account+'|'+path];
    if(!record||record.path!==path||!/^[0-9a-f]{64}$/i.test(record.sha256||''))return false;
    const found=await V.lookupFile(dir,path);if(!found)return false;
    const file=await found.handle.getFile();
    if(file.size!==record.bytes||(await V.digestStream(file))!==record.sha256)return false;
    let obj;try{obj=JSON.parse(await file.text());}catch{return false;}
    return obj?.schema==='cae.workspace-configuration.v1'&&obj.active_scope?.account_id===account;
  }
  async function enable(options){
    await load();
    const account=options.accountId;
    if(!validAccount(account))throw new Error('Confirm the workspace before enabling background updates.');
    if(!['active','workspace'].includes(options.scope)||!['tracked','tracked_and_new'].includes(options.enrollment))
      throw new Error('Invalid background policy.');
    const dir=await V.restoreWorkspaceDirectory(account)||await V.restoreDirectory();
    if(!dir||!(await V.hasPermission(dir,false)))throw new Error('Choose a Vault and grant write access before enabling sync.');
    const display=String(options.display||'');
    await confirmedScope(options.tabId,account);
    const unlock=await V.acquireLock();
    try{
      const prefix=await V.resolveWorkspacePrefix(dir,ChatArchivePaths.createLayout(display).prefix,account);
      // .workspace.json is authoritative. useWorkspace can migrate v0.1.5,
      // but an arbitrary empty directory still cannot pass the prerequisite.
      const vault=await V.openStore(dir),ledger=await vault.useWorkspace(prefix,account);
      let verified=false;
      for(const rec of Object.values(ledger.chats)){
        if(!rec?.path?.startsWith(prefix+'/'))continue;
        const f=await V.lookupFile(dir,rec.path);
        if(f&&await V.matchesChatFile(f.handle,rec)){verified=true;break;}
      }
      if(!verified)verified=await verifiedConfigurationSeed(vault,dir,prefix,account);
      if(!verified)throw new Error('No verified archive seed found. First export at least one chat or the current workspace configuration to this Vault, or reconnect the existing Vault.');
      const knownForMirror=await vault.knownProjects(prefix,account);
      const disk=await V.readJson(dir,prefix+'/.sync.json');
      if(disk&&(disk.schema!=='cae.background-config.v1'||disk.account_id!==account))
        throw new Error('Existing background settings belong to another workspace or use an unknown schema.');
      const old=data.workspaces[account];
      const binding=await V.restoreWorkspaceDirectory(account);
      const same=!!binding&&typeof dir.isSameEntry==='function'&&await dir.isSameEntry(binding);
      if(old?.enabled&&!same)throw new Error('Pause background sync before assigning a different Vault.');
      // Never replace the verified mirror before confirming that the requested
      // Vault is permitted for this workspace.
      await S.seed(account,prefix,ledger,knownForMirror,vault.index);
      const now=new Date().toISOString();
      const cfg={
        account_id:account,display,prefix,vault_name:dir.name||'Vault',enabled:true,
        scope:options.scope,enrollment:options.enrollment,sources:Boolean(options.sources),
        started_at:disk?.started_at||now,
        new_since:options.enrollment==='tracked_and_new'?(disk?.new_since||now):(disk?.new_since||null),
        status:'idle',message:'Background updates enabled.',tab_id:options.tabId,
        queue:[],catalog:[],next_chat_scan:0,next_project_scan:0,next_config_scan:0,blocked_until:0,
        pending:{},hint_checked:{},missing:{},source_outcomes:{},logs:old&&same?old.logs||[]:[],
        totals:old&&same?old.totals||{}:{},tracked_chats:Object.keys(ledger.chats).length,
        buffer:await S.stats(account)
      };
      // Restarted/paused queues can be safely reconstructed from on-disk
      // indexes. Never use a timestamp from the filesystem as a remote marker.
      if(old&&same){cfg.missing=old.missing||{};cfg.source_outcomes=old.source_outcomes||{};}
      await V.rememberWorkspaceDirectory(account,dir);
      await saveConfig(cfg,dir);
      data.workspaces[account]=cfg;note(cfg,'Enabled for '+prefix+'; enrollment '+cfg.enrollment+'.');await persist();
      const access=await inspectAccess(cfg,'enable',{refresh:true});
      if(access.worker.state!=='granted')blockForAccess(cfg,access);
      else if(access.offscreen?.permission!=='granted'||access.offscreen?.indexError)
        note(cfg,'Vault handle retention could not be confirmed in offscreen; inspect access diagnostics.','warning');
      await persist();
    }finally{unlock();}
    await alarms();await armTab(options.tabId);wake();
    return P.publicState(data.workspaces[account]);
  }
  async function pause(account){
    await load();const c=data.workspaces[account];if(!c)return P.publicState(null);
    c.enabled=false;c.status='disabled';c.message='Paused by the user.';await persist();
    for(const [id,b]of armed)if(b.account===account){chrome.tabs.sendMessage(id,{type:'CAE_SYNC_WATCH',enabled:false}).catch(()=>{});armed.delete(id);}
    await alarms();
    if(root.ChatArchiveVaultContext?.reconcile)
      await root.ChatArchiveVaultContext.reconcile(Object.values(data.workspaces).filter(x=>x.enabled).map(x=>x.account_id)).catch(()=>{});
    c.access={...c.access,checkedAt:new Date().toISOString(),retained:false,offscreen:'unknown'};
    if(root.ChatArchiveVaultDiagnostics)
      await root.ChatArchiveVaultDiagnostics.append(account,'paused',{retained:false,contexts:await root.ChatArchiveVaultDiagnostics.contexts()}).catch(()=>{});
    await persist();
    // Ongoing transfers observe c.enabled and abort before committing. Do not
    // block the Pause button on waiting for a filesystem lock.
    (async()=>{const release=await V.acquireLock();try{
      const dir=await V.restoreWorkspaceDirectory(account);if(dir&&await V.hasPermission(dir,false))await saveConfig(c,dir);
    }finally{release();}})().catch(()=>{});
    return P.publicState(c);
  }
  async function inspect(account){
    await load();return P.publicState(data.workspaces[account]);
  }
  function hasEnabledWorkspaces(){return !!data && Object.values(data.workspaces).some(c=>c.enabled);}
  async function resume(account){
    await load();const c=data.workspaces[account];if(!c?.enabled)return P.publicState(c);
    const a=await inspectAccess(c,'resume',{refresh:true});
    if(a.inactive)return P.publicState(c);
    if(a.worker.state!=='granted'){
      blockForAccess(c,a);await persist();throw new Error(c.message);
    }
    if(accessWaitStates.has(c.status)){
      c.blocked_until=0;c.status='queued';c.message='Vault access restored; resuming queued work.';
    }
    await persist();wake(500);return P.publicState(c);
  }
  async function armTab(tabId){
    await load();if(!Object.values(data.workspaces).some(c=>c.enabled))return false;
    if(arming.has(tabId))return arming.get(tabId);
    const operation=(async()=>{
      let tab;try{tab=await chrome.tabs.get(tabId);}catch{return false;}
      if(!tab.active||!isChatUrl(tab.url)||tab.discarded)return false;
      try{const w=await chrome.windows.get(tab.windowId);if(!w.focused)return false;}catch{}
      if(data.cooldown_until>Date.now())return false;
      const existing=armed.get(tabId);
      if(existing&&Date.now()-existing.verifiedAt<10000)return true;
      const rpc=ChatArchiveSyncRPC.connect(tabId);
      try{
        const scope=await rpc.call('CAE_STATUS',{force:true});
        const c=data.workspaces[scope.accountId];
        if(!c?.enabled||!scope.observed){armed.delete(tabId);await chrome.tabs.sendMessage(tabId,{type:'CAE_SYNC_WATCH',enabled:false}).catch(()=>{});return false;}
        armed.set(tabId,{account:scope.accountId,verifiedAt:Date.now()});c.tab_id=tabId;
        // A newly active tab may recover a prior lost-tab state. It never clears
        // a server cooldown or changes the configured workspace/Vault binding.
        if(['waiting_for_tab','workspace_changed'].includes(c.status))c.blocked_until=0;
        await persist();await chrome.tabs.sendMessage(tabId,{type:'CAE_SYNC_WATCH',enabled:true}).catch(()=>{});
        if(c.queue?.some(t=>!t.notBefore||t.notBefore<=Date.now()))wake(500);
        return true;
      }catch{return false;}finally{rpc.close();}
    })().finally(()=>arming.delete(tabId));arming.set(tabId,operation);return operation;
  }
  // A Manifest V3 service worker can be discarded at any time. The armed map
  // is deliberately ephemeral, so restore a previously verified tab binding
  // from durable, workspace-scoped state when the next watch event wakes us.
  // One authenticated scope check per cold binding; never infer the account
  // solely from the page's message payload or a tab ID.
  async function recoverBinding(tabId){
    const bound=armed.get(tabId);if(bound)return bound;
    if(recovering.has(tabId))return recovering.get(tabId);
    const operation=(async()=>{
      await load();
      const now=Date.now();
      const matches=Object.values(data.workspaces).filter(c=>c.enabled &&
        (c.tab_id===tabId || Object.values(c.pending||{}).some(x=>x.tabId===tabId&&x.expires>now)));
      if(matches.length!==1)return null;
      const c=matches[0];
      // Tab reuse, a different workspace, or a discarded tab must never
      // inherit the previous tab's authorization or Vault binding.
      try{await confirmedScope(tabId,c.account_id);}catch{return null;}
      const result={account:c.account_id,verifiedAt:Date.now()};
      armed.set(tabId,result);
      return result;
    })().finally(()=>recovering.delete(tabId));
    recovering.set(tabId,operation);return operation;
  }
  async function signal(tabId,msg){
    await load();const binding=armed.get(tabId)||await recoverBinding(tabId);
    if(!binding)return {accepted:false,reason:'unbound'};
    const c=data.workspaces[binding.account];if(!c?.enabled)return {accepted:false,reason:'disabled'};
    if(!/^[a-f0-9-]{36}$/i.test(msg.conversationId||''))return {accepted:false,reason:'invalid_id'};
    const id=msg.conversationId;
    c.pending ||= {};
    const prev=c.pending[id];
    const sampledAt=Number(msg.sampledAt)||Date.now();
    if(prev?.sampledAt&&sampledAt<prev.sampledAt)return {accepted:true,stale:true};
    c.pending[id]={tabId,projectId:ChatArchivePaths.canonical(msg.projectId||''),streaming:Boolean(msg.streaming),
      signature:String(msg.signature||'').slice(0,200),sampledAt,lastSignal:Date.now(),fallbackAttempts:0,
      lastFallback:0,expires:Date.now()+2*3600_000};
    // Retain only a bounded set of active / still-finishing chats.
    const keys=Object.keys(c.pending);if(keys.length>12)delete c.pending[keys[0]];
    if(!msg.streaming&&(prev?.signature!==msg.signature||prev?.streaming||!prev)){
      const earliest=Math.max(Date.now()+I.activeDebounceMs,(c.hint_checked?.[id]||0)+I.activeMinMs);
      P.enqueue(c,{id:'hint:'+id,kind:'hint',conversationId:id,projectId:c.pending[id].projectId,
        tabId,notBefore:earliest,followUp:!msg.initial});
      c.status='queued';c.message='Active conversation change detected; checking metadata.';
      wake(I.activeDebounceMs+100);
    }
    await persist();
    return {accepted:true,queued:c.queue.some(t=>t.id==='hint:'+id)};
  }
  function layoutFor(c,known){
    const list=[...(c.catalog||[]),...known];
    const base=ChatArchivePaths.createLayout(c.display,list,c.prefix);
    const dirs=new Map(known.map(p=>[p.id,p.path]));
    const projectPath=(id,name)=>dirs.get(ChatArchivePaths.canonical(id))||base.projectPath(id,name);
    return {...base,projectPath,chatPath(item){
      const parent=ChatArchivePaths.isGPT(item.gptId)?base.gptPath(item.gptId,item.gptName):projectPath(item.projectId,item.project);
      return `${parent}/${ChatArchivePaths.safe(item.title||'Untitled chat',100)} [${ChatArchivePaths.safe(item.id,80)}].md`;}};
  }
  function isNewProject(c,p,known){return P.eligible(c,known.some(x=>x.id===p.gizmo.id),p.gizmo.created_at);}
  function scheduleDue(c,ledger,known,writable=true){
    const now=Date.now();
    for(const [id,x]of Object.entries(c.pending||{})){
      if(x.expires<now){delete c.pending[id];continue;}
      // A same-tab route change or a frozen tab can prevent a completion hint.
      // Fall back to a bounded metadata check, never treating an update as proof
      // that an old untracked chat is eligible. Server streaming guards still apply.
      const delay=Math.min(15*60_000,2*60_000*2**Math.min(x.fallbackAttempts||0,4));
      if(x.streaming&&now-(x.lastSignal||0)>60000&&now-(x.lastFallback||x.lastSignal||0)>=delay){
        P.enqueue(c,{id:'pending:'+id,kind:'hint',conversationId:id,projectId:x.projectId,tabId:x.tabId,checkPending:true});
        x.lastFallback=now;x.fallbackAttempts=(x.fallbackAttempts||0)+1;
      }
    }
    // Configuration inventory is a rare, opt-in background metadata snapshot.
    // Nothing is requested without an explicit enabled sync binding and Vault
    // permission. Each stage is a durable single API request.
    if(writable&&now>=(c.next_config_scan||0)&&
       !c.queue.some(t=>t.kind?.startsWith('config_'))){
      c.config_run={started_at:new Date().toISOString(),identity:null,gpts:null,
        plugin_pages:{},plugin_items:{GLOBAL:[],WORKSPACE:[]},schedule_pages:{},
        schedule_items:{scheduled:[],paused:[],finished:[]},warnings:[]};
      P.enqueue(c,{id:'config:identity',kind:'config_identity',notBefore:0});
      c.next_config_scan=now+I.configMs;
    }
    if(now>=c.next_project_scan){
      if(!c.queue.some(x=>['projects','connectors'].includes(x.kind)))
        P.enqueue(c,{id:'projects:first',kind:'projects',cursor:'',page:0,seen:[],notBefore:0});
      c.next_project_scan=now+I.projectsMs;
    }
    if(c.scope==='workspace'&&now>=c.next_chat_scan){
      if(!c.queue.some(x=>x.kind==='chats'||x.kind==='project_chats')){
        const discovered=c.enrollment==='tracked_and_new'?(c.catalog||[]):[];
        const projects=new Map([...discovered,...known].map(p=>[p.id,p]));
        for(const r of Object.values(ledger.chats))if(ChatArchivePaths.isProject(r.project_id)&&!projects.has(r.project_id))
          projects.set(r.project_id,{id:r.project_id,name:''});
        // One list-page request per task. No conversation bodies are fetched
        // for historical untracked objects discovered during this enumeration.
        for(const p of projects.values())if(ChatArchivePaths.isProject(p.id))
          P.enqueue(c,{id:'project-chats:'+p.id+':0',kind:'project_chats',projectId:p.id,projectName:p.name,cursor:'0',page:0,seen:[]});
        P.enqueue(c,{id:'chats:main:0',kind:'chats',offset:0,archived:false});
        P.enqueue(c,{id:'chats:archived:0',kind:'chats',offset:0,archived:true});
      }
      c.next_chat_scan=now+I.chatsMs;
    }
  }
  function candidate(c,item,ledger,layout,dir,checkPending=false,forceDetail=false,offline=false){
    if(!item?.id||!P.eligible(c,has(ledger.chats,item.id),item.created))return;
    if(!has(ledger.chats,item.id)&&/^(new chat|untitled chat)$/i.test(String(item.title||'').trim()))
      return; // Wait for the server-generated or user-provided stable title.
    if(c.scope==='active'&&!has(c.pending,item.id))return;
    // No filesystem preflight is possible without the Vault. A verified mirror
    // can suppress unchanged body requests, but cannot verify a missing file.
    if(offline&&!forceDetail&&P.sameRevision(item,ledger.chats[item.id]))return;
    const old=ledger.chats[item.id],queued=c.queue.find(t=>t.id==='chat:'+item.id)?.item;
    if(item.gptId&&!item.gptName){
      const g=(c.catalog_gpts||[]).find(x=>x.id===item.gptId);
      if(g?.name)item={...item,gptName:g.name};
    }
    if(!item.projectId&&item.containerObserved!==true){
      const oldId=queued?.projectId||old?.project_id||'';
      if(ChatArchivePaths.isProject(oldId))item={...item,projectId:oldId,project:queued?.project||''};
      else if(!item.gptId&&ChatArchivePaths.isGPT(oldId))item={...item,gptId:oldId};
      if(!item.gptId&&ChatArchivePaths.isGPT(old?.gpt_id))item={...item,gptId:old.gpt_id,gptName:old.gpt_name||''};
    }
    if(queued&&P.timestamp(queued.updated)>P.timestamp(item.updated))item={...item,updated:queued.updated};
    // Queue preflight even for matching revisions, so missing local files can
    // be repaired. The preflight is local and must not fetch the chat body.
    P.enqueue(c,{id:'chat:'+item.id,kind:'chat',item,checkPending,forceDetail,notBefore:0});
  }
  function pageNext(c,task,cursor){
    if(!cursor)return;
    if(task.page>=299||(task.seen||[]).includes(cursor))throw new Error('Background pagination did not terminate; partial inventory was not used for removals.');
    P.enqueue(c,{...task,id:task.kind+':'+(task.projectId||'')+':'+cursor,cursor,page:(task.page||0)+1,seen:[...(task.seen||[]),cursor]});
  }
  async function projectResult(c,snapshot,vault,known,layout){
    const project=ChatArchiveMeta.normalizeProject(snapshot);
    if (project.workspace_id && project.workspace_id !== c.account_id) throw new Error('Project belongs to another workspace.');
    const plans=ChatArchiveSources.plan([project],layout);
    const outcomes=[];
    const present=new Set(plans.filter(x=>x.fileId).map(x=>`${c.account_id}|${x.key}`));
    const identities=new Set(plans.map(x=>x.sourceIdentity).filter(Boolean));
    for(const job of plans){
      if(!c.enabled)throw Object.assign(Error('Sync paused.'),{code:'CANCELLED'});
      const key=`${c.account_id}|${job.key}`,old=vault.index.sources[key];
      // Pending Source indexes are not completed archives. They need a
      // verified local recovery pass, not silent exclusion as already saved.
      const eligible=job.fileId&&(old?.pending || P.eligible(c,!!old,job.attachedAt));
      let result={project_id:project.id,file_id:job.fileId,name:job.name,status:'not_tracked',reason:'Excluded by background enrollment policy.'};
      if(old){result={...result,status:old.pending?'pending_recovery':old.deleted_at?'deleted':'skipped',local_path:old.path,sha256:old.sha256,downloaded_bytes:old.bytes};}
      if(c.sources&&eligible){
        const decision=await vault.decideSource(job,c.account_id);
        result={...result,status:decision.status||'queued',reason:decision.reason||null,local_path:decision.path||null};
        if(decision.action==='download')P.enqueue(c,{id:'source:'+job.key,kind:'source',job,notBefore:0});
      }
      outcomes.push(result);
    }
    ChatArchiveMeta.applyDownloads(project,{results:outcomes});
    const now=new Date().toISOString(),dir=layout.projectPath(project.id,project.name);
    for(const [name,text] of [['_project.md',ChatArchiveMeta.renderProject(project,now)],['_sources.md',ChatArchiveMeta.renderSources(project,now)]]){
      if(!c.enabled)throw Object.assign(Error('Sync paused.'),{code:'CANCELLED'});
      const path=dir+'/'+name;
      const result=await vault.writeText(path,text,{kind:'metadata',key:c.account_id+'|'+path});
      if(result.status==='conflict')note(c,`Metadata local edits preserved: ${name}`,'warning');
    }
    // Absence is actionable ONLY in a complete successful inventory of an
    // accessible project, with two observations separated by at least one hour.
    const connectorInventoryStable=(snapshot.connectors||[]).every(s=>!s.is_connector_syncable||s.last_sync_status==='completed');
    if(c.sources&&snapshot.connector_scopes_complete===true&&connectorInventoryStable){
      for(const [key,rec]of Object.entries(vault.index.sources)){
        if(!c.enabled)throw Object.assign(Error('Sync paused.'),{code:'CANCELLED'});
        if(!key.startsWith(c.account_id+'|')||rec.project_id!==project.id||rec.deleted_at)continue;
        if(present.has(key)||(rec.source_identity&&identities.has(rec.source_identity))){delete c.missing[key];continue;}
        // Legacy records lack stable connector identity: rotating file IDs could
        // otherwise look like removal. A same-name replacement is conservative.
        if(!rec.source_identity&&plans.some(x=>x.name===rec.name)){delete c.missing[key];continue;}
        const m=c.missing[key];
        if(!m)c.missing[key]={first:Date.now(),last:Date.now()};
        else if(Date.now()-m.first>=3600_000){
          const result=await vault.quarantineSource(key);delete c.missing[key];
          note(c,`Removed source ${rec.name}: ${result.status}.`,result.status==='conflict'?'warning':'info');
        }
      }
    }
  }
  async function process(c,task,ctx){
    const {rpc,vault,ledger,known,layout,dir,offline=false,mirror=null}=ctx;
    const page=async query=>{
      const result=await rpc.call('CAE_BG_PAGE',{query,expectedAccountId:c.account_id});
      if(!c.enabled)throw Object.assign(Error('Sync paused.'),{code:'CANCELLED'});
      return result;
    };
    switch(task.kind){
      case 'config_identity':{
        const result=await page({kind:'config_identity'});
        if(result.account_id!==c.account_id)throw Error('Configuration identity mismatch.');
        c.config_run ||= {started_at:new Date().toISOString(),plugin_pages:{},plugin_items:{GLOBAL:[],WORKSPACE:[]},warnings:[]};
        c.config_run.identity=result;
        P.enqueue(c,{id:'config:gpts',kind:'config_gpts',notBefore:0});
        return 'Current workspace identity verified.';
      }
      case 'config_gpts':{
        const run=c.config_run;
        if(!run?.identity)throw Error('Configuration inventory has no verified identity.');
        try{run.gpts=await page({kind:'config_gpts',knownGpts:c.catalog_gpts||[]});
          if(Array.isArray(run.gpts.items)){
            const names=new Map(run.gpts.items.filter(x=>x.id&&x.name).map(x=>[x.id,x.name]));
            c.catalog_gpts=[...new Map([...(c.catalog_gpts||[]),
              ...run.gpts.items].filter(x=>x.id).map(x=>[x.id,{id:x.id,
                name:names.get(x.id)||x.name||''}])).values()].slice(-500);
          }
        }
        catch(e){if(['API_COOLDOWN','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||[401,429,502,503,504].includes(e.httpStatus))throw e;
          run.gpts={status:'error',complete:false,items:null};run.warnings.push('GPT bootstrap inventory failed.');}
        P.enqueue(c,{id:'config:plugins:GLOBAL:first',kind:'config_plugins',scope:'GLOBAL',pageToken:'',page:0,seen:[],notBefore:0});
        return 'Current-scope GPT names checked.';
      }
      case 'config_plugins':{
        const run=c.config_run,scope=task.scope;
        if(!run?.identity||!['GLOBAL','WORKSPACE'].includes(scope))throw Error('Invalid configuration task scope.');
        const items=run.plugin_items[scope]||[];
        let res=null;
        try{res=await page({kind:'config_plugins',scope,pageToken:task.pageToken||''});}
        catch(e){if(['API_COOLDOWN','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||[401,429,502,503,504].includes(e.httpStatus))throw e;
          run.warnings.push('Installed '+scope+' Plugins inventory failed.');}
        if(res){
          items.push(...res.items);run.plugin_items[scope]=items;
          const token=res.next_page_token;
          if(token&&!(task.seen||[]).includes(token)&&(task.page||0)<29){
            P.enqueue(c,{id:'config:plugins:'+scope+':'+token,kind:'config_plugins',scope,pageToken:token,
              page:(task.page||0)+1,seen:[...(task.seen||[]),token],notBefore:0});
            return 'Installed '+scope+' Plugins page recorded.';
          }
          if(token)run.warnings.push('Installed '+scope+' Plugins inventory pagination incomplete.');
          run.plugin_pages[scope]={status:token?'partial':'complete',complete:!token,
            pages:(task.page||0)+1,items};
        }else run.plugin_pages[scope]={status:'error',complete:false,pages:task.page||0,items};
        if(scope==='GLOBAL'&&run.identity.scope_type!=='personal')
          P.enqueue(c,{id:'config:plugins:WORKSPACE:first',kind:'config_plugins',scope:'WORKSPACE',
            pageToken:'',page:0,seen:[],notBefore:0});
        else P.enqueue(c,{id:'config:schedules:scheduled:first',kind:'config_schedules',
          bucket:'scheduled',cursor:'',page:0,seen:[],notBefore:0});
        return 'Installed '+scope+' Plugins inventory '+run.plugin_pages[scope].status+'.';
      }
      case 'config_schedules':{
        const run=c.config_run,bucket=task.bucket;
        if(!run?.identity||!['scheduled','paused','finished'].includes(bucket))
          throw Error('Unverified schedules inventory task.');
        run.schedule_items ||= {scheduled:[],paused:[],finished:[]};
        run.schedule_pages ||= {};
        const items=run.schedule_items[bucket]||[];
        let res=null;
        try{res=await page({kind:'config_schedules',bucket,cursor:task.cursor||''});}
        catch(e){if(['API_COOLDOWN','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||
          [401,429,502,503,504].includes(e.httpStatus))throw e;
          run.warnings.push('Schedules '+bucket+' inventory unavailable: '+e.message);}
        if(res){
          items.push(...res.items);run.schedule_items[bucket]=items;
          const cursor=res.cursor;
          if(cursor&&!(task.seen||[]).includes(cursor)&&(task.page||0)<49){
            P.enqueue(c,{id:'config:schedules:'+bucket+':'+cursor,kind:'config_schedules',
              bucket,cursor,page:(task.page||0)+1,
              seen:[...(task.seen||[]),cursor],notBefore:0});
            return 'Schedules '+bucket+' page recorded.';
          }
          if(cursor)run.warnings.push('Schedules '+bucket+' pagination incomplete.');
          run.schedule_pages[bucket]={status:cursor?'partial':'complete',complete:!cursor,
            pages:(task.page||0)+1,items};
        }else run.schedule_pages[bucket]={status:'error',complete:false,pages:task.page||0,items};
        const next={scheduled:'paused',paused:'finished',finished:null}[bucket];
        if(next)P.enqueue(c,{id:'config:schedules:'+next+':first',kind:'config_schedules',
          bucket:next,cursor:'',page:0,seen:[],notBefore:0});
        else P.enqueue(c,{id:'config:commit',kind:'config_commit',notBefore:0});
        return 'Schedules '+bucket+' inventory '+run.schedule_pages[bucket].status+'.';
      }
      case 'config_commit':{
        const run=c.config_run;
        if(!run?.identity||run.identity.account_id!==c.account_id)
          throw Error('Unverified configuration cannot be written.');
        const inventory=ChatArchiveConfigInventory.pluginsFromPages(run.plugin_pages,c.account_id);
        const automations=ChatArchiveConfigInventory.automationsFromPages(run.schedule_pages||{});
        const path=c.prefix+'/_workspace_configuration.json';
        const text=ChatArchiveMeta.renderWorkspaceConfiguration({
          active_scope:{account_id:c.account_id},identity:run.identity,
          projects:(c.catalog||[]).filter(x=>ChatArchivePaths.isProject(x.id))
            .map(x=>({gizmo:{id:x.id,display:{name:x.name},created_at:x.created}})),
          projects_complete:!!c.catalog_projects_complete,gpts:c.catalog_gpts||[],
          custom_gpts:run.gpts,installed_plugins:inventory.plugins,bundled_skills:inventory.skills,
          schedules:automations,selection:'all_projects'},new Date().toISOString());
        const previous=await V.readJson(dir,path);
        const merged=ChatArchiveMeta.mergeWorkspaceConfiguration(previous,text,c.account_id);
        const unchanged=ChatArchiveMeta.sameConfiguration(previous,merged);
        const result=unchanged?{status:'skipped'}:await vault.writeText(path,merged,{kind:'metadata',key:c.account_id+'|'+path});
        if(result.status==='conflict')note(c,'Workspace configuration local edit preserved.','warning');
        c.config_run=null;
        P.enqueue(c,{id:'personalization',kind:'personalization',notBefore:0});
        return 'Active workspace configuration '+result.status+'; '+run.warnings.length+' inventory warnings.';
      }
      case 'projects':{
        if(!task.cursor){c.catalog_projects_complete=false;c.project_scan_seen=[];}
        const result=await page({kind:'projects',cursor:task.cursor});
        for(const p of result.items){
          if(!ChatArchivePaths.isProject(p?.gizmo?.id))continue;
          const id=p.gizmo.id,entry={id,name:p.gizmo.display.name,created:p.gizmo.created_at};
          c.project_scan_seen ||= [];if(!c.project_scan_seen.includes(id))c.project_scan_seen.push(id);
          const old=(c.catalog||[]).findIndex(x=>x.id===id);if(old<0)c.catalog.push(entry);else c.catalog[old]=entry;
          if(!offline&&isNewProject(c,p,known))P.enqueue(c,{id:'connectors:'+id+':first',kind:'connectors',projectId:id,
            snapshot:p,cursor:'',page:0,seen:[]});
          // New project conversations are discovered without waiting another chat interval.
          if(c.scope==='workspace'&&P.eligible(c,known.some(x=>x.id===id),p.gizmo.created_at))
            P.enqueue(c,{id:'project-chats:'+id+':0',kind:'project_chats',projectId:id,projectName:entry.name,cursor:'0',page:0,seen:[]});
        }
        pageNext(c,task,result.cursor);
        if(!result.cursor){
          const seen=new Set(c.project_scan_seen||[]);
          c.catalog=c.catalog.filter(x=>seen.has(x.id));
          c.catalog_projects_complete=true;delete c.project_scan_seen;
        }
        if(!offline&&!result.cursor){
          const rootPath=c.prefix+'/_workspace_configuration.json';
          const configuration=ChatArchiveMeta.renderWorkspaceConfiguration({
            projects:(c.catalog||[]).filter(x=>ChatArchivePaths.isProject(x.id)).map(x=>({gizmo:{id:x.id,display:{name:x.name},created_at:x.created}})),
            projects_complete:true,gpts:c.catalog_gpts||[],active_scope:{account_id:c.account_id}
          },new Date().toISOString());
          const prior=await V.readJson(dir,rootPath);
          const merged=ChatArchiveMeta.mergeWorkspaceConfiguration(prior,configuration,c.account_id);
          const result=ChatArchiveMeta.sameConfiguration(prior,merged)?{status:'skipped'}:
            await vault.writeText(rootPath,merged,{kind:'metadata',key:c.account_id+'|'+rootPath});
          if(result.status==='conflict')note(c,'Workspace configuration local edit preserved.','warning');
          if(has(vault.index.metadata,c.account_id+'|'+c.prefix+'/_personalization.md'))
            P.enqueue(c,{id:'personalization',kind:'personalization'});
        }
        return 'Project metadata enumerated.';
      }
      case 'connectors':{
        const result=await page({kind:'connectors',projectId:task.projectId,cursor:task.cursor});
        task.snapshot.connectors = [...new Map([...task.snapshot.connectors,...result.items].map(x=>[x.scope_id,x])).values()];
        if(result.cursor)pageNext(c,task,result.cursor);
        else {task.snapshot.connector_scopes_complete=true;await projectResult(c,task.snapshot,vault,known,layout);}
        return 'Project Sources inventory checked.';
      }
      case 'personalization':{
        const p=await page({kind:'personalization'}),path=c.prefix+'/_personalization.md';
        await vault.writeText(path,ChatArchiveMeta.renderPersonalization(p,new Date().toISOString()),{kind:'metadata',key:c.account_id+'|'+path});
        return 'Existing personalization snapshot updated.';
      }
      case 'hint':{
        const pending=c.pending[task.conversationId];
        if(pending?.streaming&&!task.checkPending)return 'Response still running; waiting for its completion event.';
        c.hint_checked[task.conversationId]=Date.now();
        const rawPid=ChatArchivePaths.canonical(task.projectId||ledger.chats[task.conversationId]?.project_id||'');
        const pid=ChatArchivePaths.isProject(rawPid)?rawPid:'';
        const name=known.find(x=>x.id===pid)?.name||c.catalog.find(x=>x.id===pid)?.name||'';
        const result=await page(ChatArchivePaths.isProject(pid)?{kind:'project_chats',projectId:pid,projectName:name,cursor:'0'}:{kind:'chats',offset:0});
        const item=result.items.find(x=>x.id===task.conversationId);
        const tracked=has(ledger.chats,task.conversationId);
        const isEligible=item?P.eligible(c,tracked,item.created):tracked;
        // A completion event may precede propagation of the list's updated
        // timestamp. Recheck only this conversation once, then (for an
        // already archived, unedited chat) verify the detail at most once.
        // No historical untracked chat is admitted by an update event.
        const stale=item&&tracked&&P.sameRevision(item,ledger.chats[item.id]);
        if(task.followUp&&isEligible&&stale&&!(task.rechecks||0)){
          P.enqueue(c,{id:'hint-recheck:'+task.conversationId,kind:'hint',conversationId:task.conversationId,
            projectId:pid,tabId:task.tabId,followUp:true,rechecks:1,notBefore:Date.now()+20000});
          wake(20200);
        }
        if(item)candidate(c,item,ledger,layout,dir,Boolean(task.checkPending),
          Boolean(stale&&tracked&&task.followUp&&task.rechecks),offline);
        else if(tracked){
          const old=ledger.chats[task.conversationId];
          candidate(c,{id:task.conversationId,title:old.title,projectId:pid,project:name,updated:null},ledger,layout,dir,Boolean(task.checkPending),false,offline);
        }
        return item&&!isEligible?'Old untracked chat excluded.':'Active chat metadata checked.';
      }
      case 'chats':case 'project_chats':{
        const result=await page(task);
        for(const item of result.items){
          if(item.gptId){
            c.catalog_gpts ||= [];
            const existing=c.catalog_gpts.find(x=>x.id===item.gptId);
            if(!existing)c.catalog_gpts.push({id:item.gptId,name:item.gptName||''});
            else if(!existing.name&&item.gptName)existing.name=item.gptName;
            c.catalog_gpts=c.catalog_gpts.slice(-500);
          }
          candidate(c,item,ledger,layout,dir,false,false,offline);
        }
        if(task.kind==='chats'&&result.nextOffset!==null)P.enqueue(c,{...task,id:`chats:${task.archived?'archived':'main'}:${result.nextOffset}`,offset:result.nextOffset});
        if(task.kind==='project_chats')pageNext(c,task,result.cursor);
        return 'Conversation metadata page checked.';
      }
      case 'chat':{
        const item=task.item;
        if(!P.eligible(c,has(ledger.chats,item.id),item.created))return 'Chat excluded by enrollment policy.';
        if(c.pending[item.id]?.streaming&&(!task.checkPending||Date.now()-(c.pending[item.id].lastSignal||0)<60000)){const e=Error('Response still running.');e.code='STILL_STREAMING';throw e;}
        if(offline){
          const cached=await S.metadata(c.account_id,item.id);
          if(cached?.state==='conflict')return 'Buffered conflict retained; chat not re-fetched.';
          if(cached&&!task.forceDetail){
            const updated=P.timestamp(item.updated);
            if(updated!==null&&cached.listed_updated_ms!==null&&updated<=cached.listed_updated_ms)
              return 'Chat already captured in the offline buffer.';
          }
          if(!task.forceDetail&&P.sameRevision(item,ledger.chats[item.id]))
            return 'Unchanged chat omitted from offline capture.';
        }
        const pre=offline?{action:'fetch'}:await vault.decideChat(item,{key:c.account_id+'|'+item.id,path:layout.chatPath(item)});
        if(pre.action==='skip'&&!(task.forceDetail&&pre.status==='skipped')){
          if(pre.status==='conflict')note(c,'Local chat edit preserved: '+item.title,'warning');
          return 'Chat '+pre.status+': '+item.title;
        }
        const chat=await rpc.call('CAE_GET_CHAT',{chat:item,expectedAccountId:c.account_id,background:true});
        if(!c.enabled)throw Object.assign(Error('Sync paused.'),{code:'CANCELLED'});
        if(task.checkPending&&c.pending[item.id])c.pending[item.id].streaming=false;
        // Admission is based on LIST creation date; do not broaden it using
        // the detail's update time or local file timestamps.
        const rawProjectId=ChatArchivePaths.canonical(
          item.containerObserved===true?item.projectId:(chat.projectId||item.projectId||''));
        const projectId=ChatArchivePaths.isProject(rawProjectId)?rawProjectId:'';
        const project=projectId?(item.project||chat.projectName||known.find(x=>x.id===projectId)?.name||c.catalog.find(x=>x.id===projectId)?.name||''):'';
        const prior=ledger.chats[item.id];
        const gptId=ChatArchivePaths.gptId(item.gptId||chat.gptId||prior?.gpt_id||'');
        const gptName=item.gptName||chat.gptName||
          (c.catalog_gpts||[]).find(x=>x.id===gptId)?.name||prior?.gpt_name||'';
        const output={...item,title:chat.title,projectId,project,gptId,gptName,
          archived:typeof item.archived==='boolean'?item.archived:chat.archived};
        // A forced detail check must not rewrite an unchanged Markdown file
        // solely because its YAML `exported` timestamp would be newer.
        if(task.forceDetail&&ledger.chats[item.id]?.exported){
          const comparison=ChatArchiveNormalize.renderMarkdown({...chat,...{archived:output.archived,projectId}},
            {workspace:c.display,project,gptId,gptName,exportedAt:ledger.chats[item.id].exported});
          const sha=ChatArchiveHash.hex(new TextEncoder().encode(comparison));
          if(sha===ledger.chats[item.id].sha256)return 'Chat unchanged after event verification: '+item.title;
        }
        const text=ChatArchiveNormalize.renderMarkdown({...chat,archived:output.archived,projectId},
          {workspace:c.display,project,gptId,gptName});
        if(offline){
          const staged=await S.stage(c.account_id,c.prefix,{item,text,path:layout.chatPath(output),projectId,
            vaultId:mirror?.disk_index_created_at||null});
          c.buffer=await S.stats(c.account_id);
          if(staged.status==='captured')c.totals.chats_captured=(c.totals.chats_captured||0)+1;
          for(const w of chat.warnings||[])note(c,item.title+': '+w,'warning');
          return 'Chat '+staged.status+' in local buffer: '+item.title;
        }
        const result=await vault.writeText(layout.chatPath(output),text,{kind:'chats',key:c.account_id+'|'+item.id,
          remoteChat:{...item,projectId,gptId,gptName,archived:output.archived}});
        for(const w of chat.warnings||[])note(c,item.title+': '+w,'warning');
        c.totals.chats_saved=(c.totals.chats_saved||0)+(result.status==='saved'?1:0);
        return 'Chat '+result.status+': '+item.title;
      }
      case 'source':{
        const job=task.job,key=c.account_id+'|'+job.key;
        if(!c.sources||!P.eligible(c,has(vault.index.sources,key),job.attachedAt))return 'Source excluded by enrollment policy.';
        const started=Date.now();
        const r=await ChatArchiveVaultTransfer.run([job],{
          vault,expectedAccountId:c.account_id,
          transport:{start:d=>rpc.call('CAE_SOURCE_START',{...d,background:true}),read:()=>rpc.call('CAE_SOURCE_READ'),close:()=>rpc.call('CAE_SOURCE_CLOSE')},
          limits:{maxFileBytes:I.maxSourceBytes,maxTotalBytes:I.maxSourceBytes,delayMs:0},
          cancelled:()=>!c.enabled||Date.now()-started>210000,
          progress:()=>{}
        });
        const out=r.results[0];
        if(['failed','cancelled'].includes(out.status)){
          const e=Error(out.reason||'Source transfer failed.');e.code=out.error_code;e.httpStatus=out.http_status;e.retryAfterMs=out.retry_after_ms;throw e;
        }
        c.source_outcomes[job.key]=out;
        // Bounded diagnostic cache; authoritative file records are in index.json.
        const keys=Object.keys(c.source_outcomes);if(keys.length>500)delete c.source_outcomes[keys[0]];
        c.totals.sources_saved=(c.totals.sources_saved||0)+(out.status==='saved'?1:0);
        return 'Source '+out.status+': '+job.name;
      }
      default:throw new Error('Unknown background task.');
    }
  }
  async function drainBuffered(c,vault,ledger){
    // Never require an authenticated ChatGPT tab to flush captured files.
    // The on-disk index and file hashes decide whether a staged update can be
    // committed. A local edit or an unexpected file is retained as a conflict.
    let handled=0;
    const records=await S.pending(c.account_id,2);
    for(const rec of records){
      if(!c.enabled)break;
      if(!rec.text||!rec.path?.startsWith(c.prefix+'/')||!V.validPath(rec.path)||
         ChatArchiveHash.hex(new TextEncoder().encode(rec.text))!==rec.sha256){
        await S.finish(c.account_id,rec,'conflict','Buffered Markdown validation failed.');
        note(c,'Unverifiable buffered chat retained for manual inspection.','warning');continue;
      }
      // A paused workspace can be rebound to a different local Vault. A
      // complete capture from the previous Vault must not silently migrate.
      if(rec.vault_id&&rec.vault_id!==vault.index.created_at){
        await S.finish(c.account_id,rec,'conflict','Buffered capture belongs to another Vault.');
        note(c,'Buffered capture belongs to an earlier Vault; it was not written.','warning');continue;
      }
      const old=ledger.chats[rec.conversation_id];
      const stageRevision=rec.content_updated_ms;
      if(old && Number.isFinite(old.updated_ms)&&Number.isFinite(stageRevision)&&stageRevision<old.updated_ms){
        await S.finish(c.account_id,rec);note(c,'Superseded buffered chat safely discarded.');handled++;continue;
      }
      // The capture was admitted under the workspace policy at capture time;
      // changing that policy does not discard an already captured full response.
      const result=await vault.writeText(rec.path,rec.text,{kind:'chats',
        key:c.account_id+'|'+rec.conversation_id,
        remoteChat:{id:rec.conversation_id,updated:rec.listed_updated_ms,projectId:rec.project_id},
        recovery:true});
      if(result.status==='conflict'){
        await S.finish(c.account_id,rec,'conflict',result.reason||'Local file changed.');
        note(c,'Buffered chat conflict: existing local file preserved.','warning');
      }else{
        await S.finish(c.account_id,rec);
        if(result.status==='saved'||result.status==='recovered')c.totals.chats_saved=(c.totals.chats_saved||0)+1;
        c.totals.buffer_committed=(c.totals.buffer_committed||0)+1;
        note(c,'Buffered chat '+result.status+' in Vault.');handled++;
      }
    }
    c.buffer=await S.stats(c.account_id);
    return handled;
  }
  const OFFLINE_KINDS=new Set(['projects','chats','project_chats','hint','chat']);
  async function runWorkspace(c){
    if(!c.enabled)return;
    const now=Date.now();
    const invalid=(c.queue||[]).filter(x=>['project_chats','project','connectors'].includes(x.kind)&&!ChatArchivePaths.isProject(x.projectId));
    if(invalid.length){
      c.queue=c.queue.filter(x=>!invalid.includes(x));
      note(c,`Removed ${invalid.length} invalid Project API jobs left by legacy GPT classification; regular chat enumeration remains active.`,'warning');
    }
    if(Array.isArray(c.catalog))c.catalog=c.catalog.filter(x=>ChatArchivePaths.isProject(x?.id));
    // Local drain must run even during a ChatGPT API cooldown, after tab loss,
    // or while a previously full buffer waits to be written to the Vault.
    // Only the later NETWORK phase honors blocked_until and cooldown_until.
    const apiBlocked=c.blocked_until>now&&!accessWaitStates.has(c.status)&&
      !['buffering','buffered_waiting_for_vault','buffer_conflict'].includes(c.status);
    const access=await inspectAccess(c,'background_preflight');
    if(access.inactive)return;
    const writable=access.worker.state==='granted';
    let dir=writable?access.dir:null,unlock=null,rpc=null,vault=null,ledger=null,known=null,mirror=null;
    try{
      if(writable){
        unlock=await V.acquireLock(true);
        if(!unlock){c.status='manual_export';c.message='Waiting for another Vault writer.';return;}
        vault=await V.openStore(dir);
        ledger=await vault.useWorkspace(c.prefix,c.account_id);
        known=await vault.knownProjects(c.prefix,c.account_id);
        if(!Object.keys(ledger.chats).length &&
           !(await verifiedConfigurationSeed(vault,dir,c.prefix,c.account_id))){
          c.enabled=false;c.status='needs_seed';
          note(c,'No verified chat or configuration seed remains in this Vault.','warning');return;
        }
        // Any previously missed manual export is now visible in the disk
        // ledger. Drain first; then make its new state available offline.
        const recovered=await drainBuffered(c,vault,ledger);
        if(recovered)note(c,'Buffered updates reconciled with the on-disk index.');
        try{mirror=await S.seed(c.account_id,c.prefix,ledger,known,vault.index);}
        catch(error){
          // Lack of local mirror is a degraded offline capability, never a
          // reason to disable healthy, already-authorized Vault writes.
          note(c,'Could not refresh offline mirror: '+(error.message||String(error)),'warning');
        }
        if(c.status==='buffer_full')c.blocked_until=0;
        c.tracked_chats=Object.keys(ledger.chats).length;
        if(c._last_vault_permission!=='granted'){
          // Connector snapshots captured before an access interruption are not
          // valid post-recovery inventories. Reset incomplete inventories and
          // any removal observations; do not quarantine from stale evidence.
          c.queue=c.queue.filter(t=>!['projects','connectors','source','personalization'].includes(t.kind));
          c.missing={};
          c.next_project_scan=0;
          c._last_vault_permission='granted';
        }
      }else{
        mirror=await S.readMirror(c.account_id,c.prefix);
        if(!mirror||(!Object.keys(mirror.chats||{}).length&&!mirror.disk_index_created_at)){
          blockForAccess(c,access);
          c.message+=' No verified local workspace mirror is available: grant access once to initialize it.';
          c.buffer=await S.stats(c.account_id);
          return;
        }
        ledger={schema:'cae.workspace-chats.v1',account_id:c.account_id,chats:mirror.chats};
        known=mirror.known||[];c.tracked_chats=Object.keys(ledger.chats).length;
        c._last_vault_permission=access.worker.state;
        if(!apiBlocked)c.blocked_until=0;
        if(!apiBlocked)c.status='buffering';
        c.message=apiBlocked?'API backoff is active; existing captures remain buffered.':
          'Vault is '+access.worker.state+'; capturing eligible chats in IndexedDB.';
      }
      const layout=layoutFor(c,known);
      scheduleDue(c,ledger,known,writable);await persist();
      const due=()=>c.queue.filter(t=>(t.notBefore||0)<=Date.now() && (writable||OFFLINE_KINDS.has(t.kind)));
      if(!due().length){
        c.buffer=await S.stats(c.account_id);
        if(apiBlocked || data.cooldown_until>Date.now())return;
        if(!writable){c.status=c.buffer.pending?'buffered_waiting_for_vault':
          (access.worker.state==='denied'?'permission_denied':access.worker.state==='no_handle'?'vault_missing':'permission_required');
          c.message=c.buffer.pending?c.buffer.pending+' chat updates captured locally; waiting for Vault write permission.':
            'Vault is unavailable. Conversation discovery remains enabled using the verified local mirror.';
        }else {c.status=c.buffer.conflicts?'buffer_conflict':'idle';
          c.message=c.buffer.conflicts?'Local buffered conflicts require review.':'Waiting for changes or the next metadata check.';}
        return;
      }
      // A recovered Vault grant is sufficient to flush the queue, even if the
      // user has closed every ChatGPT tab. API tasks need a verified live tab.
      if((apiBlocked&&c.blocked_until>Date.now())||data.cooldown_until>Date.now()){
        if(data.cooldown_until>Date.now())c.status='cooldown';
        c.message='API requests are deferred; captured updates remain stored locally.';
        return;
      }
      let tab;try{tab=await chrome.tabs.get(c.tab_id);}catch{}
      if(!tab||tab.discarded||!isChatUrl(tab.url)){
        c.status='waiting_for_tab';c.message='Open a ChatGPT tab in this workspace. Captured updates are retained.';
        c.blocked_until=Date.now()+60000;return;
      }
      rpc=ChatArchiveSyncRPC.connect(tab.id);
      const scope=await rpc.call('CAE_STATUS',{force:true});
      if(!scope.observed||scope.accountId!==c.account_id){
        c.status='workspace_changed';c.message='Workspace mismatch; no archive requests were made.';
        c.blocked_until=Date.now()+60000;return;
      }
      c.status=writable?'running':'buffering';c.last_run=new Date().toISOString();await persist();
      const start=Date.now();let processed=0;
      while(c.enabled&&processed<I.maxTasks&&Date.now()-start<I.maxTickMs){
        const priority=t=>t.kind==='hint'?0:t.kind==='chat'?1:t.kind==='source'?3:2;
        const task=due().sort((a,b)=>priority(a)-priority(b))[0];if(!task)break;
        const token=task.id,revision=task._revision;
        try{
          const message=await process(c,task,{rpc,vault,ledger,known,layout,dir,offline:!writable,mirror});
          c.queue=c.queue.filter(t=>t.id!==token||t._revision!==revision);
          note(c,message);c.tracked_chats=Object.keys(ledger.chats).length;
        }catch(error){
          if(['NotAllowedError','SecurityError'].includes(error.name)){
            const newAccess=await inspectAccess(c,'write_permission_error');
            blockForAccess(c,newAccess);
            task.notBefore=Date.now()+60000;
            await persist();break;
          }
          if(error.code==='SPOOL_FULL'||error.code==='SPOOL_CONFLICT'||error.name==='QuotaExceededError'){
            c.status=error.code==='SPOOL_CONFLICT'?'buffer_conflict':'buffer_full';
            task.notBefore=Date.now()+5*60_000;
            c.blocked_until=task.notBefore;
            note(c,'Offline buffer cannot accept this chat: '+(error.message||error.name)+'. No captured items were removed.','warning');
            await persist();break;
          }
          task.attempts=(task.attempts||0)+1;
          if(error.code==='STILL_STREAMING'){
            task.notBefore=Date.now()+60000;
            if(task.attempts>120){c.queue=c.queue.filter(t=>t.id!==token);note(c,'Pending chat exceeded the two-hour retry bound.','warning');}
            c.message='Waiting for a pending response.';
          }else if(error.code==='CANCELLED'&&!c.enabled)break;
          else if(error.code==='UNSUPPORTED_FILENAME'){
            // A deterministic browser filename refusal cannot be repaired by
            // replaying the same request; record it as a per-Source failure.
            c.queue=c.queue.filter(t=>t.id!==token);
            c.totals.failed=(c.totals.failed||0)+1;
            if(task.kind==='source'&&task.job?.key){
              c.source_outcomes ||= {};
              c.source_outcomes[task.job.key]={status:'failed',error_code:'UNSUPPORTED_FILENAME',
                file_id:task.job.fileId||null,name:task.job.name,reason:String(error.message||error)};
            }
            note(c,'Source filename rejected by Chrome/Edge after safe alias; task retained in diagnostics, not retried.','warning');
          }else if(error.code==='API_COOLDOWN'||[429,502,503,504].includes(error.httpStatus)){
            const deadline=Date.now()+P.retryDelay(error,task.attempts);
            data.cooldown_until=deadline;c.blocked_until=deadline;task.notBefore=deadline;c.status='cooldown';
            note(c,'Server cooldown; queued jobs retained until '+new Date(deadline).toISOString()+'.','warning');
            await persist();break;
          }else if(/timed?\s*out|timeout|receiving end does not exist/i.test(error.message||'')){
            task.notBefore=Date.now()+Math.min(15*60_000,P.backoff(task.attempts));
            c.status='waiting_for_tab';c.blocked_until=task.notBefore;
            note(c,'Background API unavailable after tab suspension; task retained for a later verified tab activation.','warning');
            await persist();break;
          }else if(error.code==='AUTH_REQUIRED'||[401,403].includes(error.httpStatus)){
            c.status='authorization_required';c.blocked_until=Date.now()+5*60_000;task.notBefore=c.blocked_until;
            note(c,'Authorization rejected the request; queue retained.','warning');await persist();break;
          }else{
            task.notBefore=Date.now()+P.backoff(task.attempts);
            note(c,(error.message||String(error))+'; task '+task.kind+' deferred.','warning');
            if(task.attempts>=5){c.queue=c.queue.filter(t=>t.id!==token);c.totals.failed=(c.totals.failed||0)+1;
              note(c,'Retry limit reached. The next scheduled inventory may rediscover this item.','warning');}
          }
        }
        await persist();processed++;
        if(c.enabled&&processed<I.maxTasks&&due().length)await sleep(I.requestGapMs);
      }
      c.buffer=await S.stats(c.account_id);
      if(c.status==='running')c.status=c.buffer.conflicts?'buffer_conflict':'idle';
      if(c.status==='buffering'){
        c.status=c.buffer.pending?'buffered_waiting_for_vault':
          (access.worker.state==='denied'?'permission_denied':access.worker.state==='no_handle'?'vault_missing':'permission_required');
        c.message=c.buffer.pending?c.buffer.pending+' complete chat updates safely captured locally; waiting for Vault.':
          'Waiting for changes. Vault grant is unavailable; local mirror is active.';
      }
      if(writable)await saveConfig(c,dir);
    }catch(e){
      if(['NotAllowedError','SecurityError'].includes(e.name))blockForAccess(c,await inspectAccess(c,'vault_operation_error'));
      else if(/timed?\s*out|timeout|receiving end does not exist/i.test(e.message||'')){
        c.status='waiting_for_tab';c.blocked_until=Date.now()+60000;
        note(c,'ChatGPT tab became unresponsive while backgrounded; waiting for reconnection.','warning');
      }else{c.status='error';c.blocked_until=Date.now()+P.backoff(1);note(c,e.message||String(e),'warning');}
    }finally{
      rpc?.close();if(unlock)unlock();await persist();
      if(writable&&c.enabled&&c.buffer?.pending>0)wake(5000);
    }
  }
  async function tick(){
    await load();if(root.ChatArchiveManualJobs?.isRunning?.()){wake(2000);return;}if(running){wakeAfterRun=true;return;}running=true;
    try{
      // Multiple workspaces have independent bindings and queues. The lock and
      // this controller make their transfers strictly serial.
      const list=Object.values(data.workspaces).filter(c=>c.enabled);
      for(const c of list)await runWorkspace(c);
    }finally{
      running=false;await alarms();
      if(wakeAfterRun){wakeAfterRun=false;wake(500);}
    }
  }
  let starting=null;
  function startup(){
    if(starting)return starting;
    const work=(async()=>{
      await load();await alarms();
      const enabled=Object.values(data.workspaces).filter(c=>c.enabled);
      if(root.ChatArchiveVaultContext?.reconcile)
        await root.ChatArchiveVaultContext.reconcile(enabled.map(c=>c.account_id)).catch(()=>{});
      if(!enabled.length)return;
      // Rehydrate EVERY enabled workspace, not just the visible ChatGPT tab.
      for(const c of enabled){
        const a=await inspectAccess(c,'worker_start');
        if(!a.inactive&&a.worker.state!=='granted')blockForAccess(c,a);
      }
      await persist();
      const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
      for(const tab of tabs)if(isChatUrl(tab.url))await armTab(tab.id);
    })().finally(()=>{if(starting===work)starting=null;});
    starting=work;return work;
  }
  async function deferNetwork(until){
    await load();data.cooldown_until=Math.max(data.cooldown_until||0,until||0);await persist();
  }
  root.ChatArchiveSync={deferNetwork,isRunning:()=>running,ALARM,STORAGE,enable,pause,inspect,armTab,signal,tick,startup,alarms,wake,
    resume,hasEnabledWorkspaces,probeAccess,accessReady,
    // Dependency-free policy tests plus controller integration use the same entrypoints.
    _state:()=>data};
})(globalThis);
