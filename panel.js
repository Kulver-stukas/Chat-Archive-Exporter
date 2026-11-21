(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    port: null, tab: null, scope: null, mode: 'current', directory: null,
    chats: [], projects: [], selected: new Set(), selectedProjects:new Set(), collapsed: new Set(), requests: new Map(), nextId: 1,
    busy: false, cancel: false, warnings: [], sync: null, syncLoaded: false, syncAccountId: null,
    lastVerifiedWorkspace: null,
    connecting: null, listLoading: null, listAccountId: null, listLoadedAt: 0, listCacheLoading: null, listSource: null, listLoadAccount: null,
    nextAutoAttempt: 0, autoFailures: 0, reconnectTimer: null,
    vaultPermission: 'unknown',
    library: null, libraryAccountId: null, libraryLoadedAt: 0, libraryLoading: null,
    libraryJob: null, librarySelected: new Set(), libraryCatalogRevision: -1, libraryRefresh: null, librarySubmitting: false,
  };

  const SURFACE=document.body.dataset.surface||'panel';
  const U=globalThis.CAEUIState;
  let uiView=SURFACE==='options'?'settings':'export',prefs=U.preferences(),previousView='export';
  let uiWindowId=null,libraryCollapsed=new Set(),libraryVisible=[],uiIntent=null;
  const sourceTabId=Number(new URLSearchParams(location.search).get('tab'))||null;
  function route(view){
    if(!['export','activity','settings','tools'].includes(view))return;
    // Settings and Tools are local views on every surface, including Side Panel.
    previousView=uiView==='tools'?previousView:uiView;uiView=view;applyModeView(state.mode);
    if(view==='activity'||view==='tools'||view==='settings'){
      refreshManual().catch(fail);refreshSync().catch(fail);refreshLibraryState(true).catch(fail);
    }
  }
  async function openOptions(view='settings'){
    // Only explicit "open in tab" and directory-picker actions use this page.
    // Reuse the existing settings tab instead of creating one for every click.
    const tab=state.tab?.id||sourceTabId;
    const base=chrome.runtime.getURL('options.html');
    const url=base+(tab?'?tab='+tab:'')+'#'+view;
    try{
      const existing=(await chrome.tabs.query({})).find(t=>(t.url||'').startsWith(base));
      if(existing?.id&&typeof chrome.tabs.update==='function'){
        await chrome.tabs.update(existing.id,{url,active:true});
        if(existing.windowId&&chrome.windows?.update)await chrome.windows.update(existing.windowId,{focused:true});
      }else await chrome.tabs.create({url});
    }catch(error){fail(error);}
  }
  function openPanel(name,refresh=false){
    const windowId=state.tab?.windowId??uiWindowId;
    if(!Number.isInteger(windowId)){status('Activate a browser window and reopen the popup.');return;}
    // Call open in this click handler, before awaits: preserve the user gesture.
    const intent={mode:name,refresh,at:Date.now(),nonce:crypto.randomUUID()};
    const saved=chrome.storage.session.set({['cae.ui.intent.'+windowId]:intent});
    const opened=chrome.sidePanel.open({windowId});
    Promise.all([saved,opened]).then(()=>{if(SURFACE==='popup')window.close();}).catch(fail);
  }
  async function acceptedExport(){
    if(SURFACE!=='panel'){route('activity');return;}
    if($('keepPanelOpen').checked||!prefs.autoClosePanel){uiView='activity';applyModeView(state.mode);return;}
    if(typeof chrome.sidePanel?.close!=='function'){
      uiView='activity';applyModeView(state.mode);status('Accepted. This Chrome version cannot close the panel automatically.');return;
    }
    try{await chrome.sidePanel.close({windowId:uiWindowId??state.tab?.windowId});}
    catch(e){uiView='activity';applyModeView(state.mode);status('Accepted. You can close the panel; the job continues.');}
  }
  function uiRefresh(){
    const account=libraryAccount();const j=manualJob?.accountId===account?manualJob:null;
    const a=U.activity(j,state.libraryJob,state.sync);
    $('appIcon').src='icons/cae-'+a.icon+'-32.png';$('appIcon').alt=a.label;
    $('overallStatus').textContent=a.label;
    // A permission check in a newly opened UI document may return 'prompt'
    // even while the background/offscreen writer still has a valid grant.
    // Never describe that as Vault disconnection, or derive it from a canceled Save.
    const bg=state.sync?.enabled&&state.sync?.access?.worker==='granted'&&state.sync?.access?.offscreen==='granted';
    const permission={granted:'connected',prompt:bg?'background connected; confirm here':'confirmation required here',
      denied:'access denied',no_handle:'not connected',unsupported:'permission check unavailable',
      error:'permission check unavailable',unknown:'checking access'};
    $('vaultBadge').textContent=state.directory?`Vault: ${state.directory.name} - ${permission[state.vaultPermission]||'checking access'}`:'Vault not selected';
    $('headerReconnect').classList.toggle('hidden',!state.directory||state.vaultPermission==='granted');
    $('headerReconnect').disabled=false;
    $('quickVault').disabled=state.busy||!state.port||!state.scope?.observed||!state.scope.currentId||!state.directory||!$('currentSelect').checked;
    $('showWidget').disabled=!state.scope?.observed||!state.tab;
    $('showWidget').textContent='Show / hide widget on this tab';
    $('toolsReconnectVault').disabled=!state.directory;
    $('pickFolder').disabled=!!manualJob?.active||!!state.sync?.enabled||!!state.libraryJob?.enabled||!!state.libraryJob?.job?.active;
    const summary=state.library?.summary;
    $('inventoryBrief').textContent=state.libraryJob?.job?.active?U.humanStatus(state.libraryJob.job)+': '+(state.libraryJob.job.detail||''):
      summary?`${summary.total||0} files in saved inventory. ${summary.selectable??0} originals requestable.`:'No saved inventory. Choose a Vault before starting.';
    $('catalogStamp').textContent=state.library?.captured_at?'Saved catalog: '+new Date(state.library.captured_at).toLocaleString()+'. No scan on download.':'No saved catalog for this workspace.';
    $('panelCloseHint').textContent=$('keepPanelOpen').checked||!prefs.autoClosePanel?'Panel stays open for monitoring.':
      typeof chrome.sidePanel?.close==='function'?'Closes after export is accepted.':'Auto-close is unavailable in this Chrome version.';
  }
  async function savePreferences(){
    prefs=U.preferences({theme:$('themeSelect').value,autoClosePanel:$('autoClosePanel').checked,
      widgetEnabled:$('widgetEnabled').checked,monitorOnStart:$('libraryMonitorOnStart').checked});
    await chrome.storage.local.set({[U.KEY]:prefs});applyPreferences();
    // Visible existing tabs can obtain the optional UI without reloading the site.
    if(prefs.widgetEnabled&&state.tab?.id)chrome.runtime.sendMessage({type:'CAE_UI_SHOW_WIDGET',tabId:state.tab.id}).catch(fail);
  }
  function applyPreferences(){
    document.documentElement.dataset.theme=prefs.theme;
    $('themeSelect').value=prefs.theme;$('autoClosePanel').checked=prefs.autoClosePanel;
    $('widgetEnabled').checked=prefs.widgetEnabled;$('libraryMonitorOnStart').checked=prefs.monitorOnStart;
    uiRefresh();
  }
  const CHAT_URL = /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i;
  const LIST_MAX_AGE_MS = 5 * 60_000;
  // A verified workspace is the identity of a background job, not the currently
  // focused browser tab. Session storage is scoped to this browser window so
  // a newly created side-panel can display background status on non-ChatGPT tabs.
  const workspaceSessionKey = windowId => `cae.panel.lastWorkspace.${windowId}`;
  function syncWorkspace() {
    if (state.scope) return state.scope.observed && state.scope.accountId
      ? {accountId: state.scope.accountId, display: state.scope.display} : null;
    return state.lastVerifiedWorkspace;
  }
  function canEditSync(accountId) {
    return !!(state.scope?.observed && state.scope.accountId &&
      (!accountId || state.scope.accountId === accountId));
  }
  function rememberVerifiedWorkspace(scope, tab) {
    if (!scope?.observed || !scope.accountId) return;
    const remembered = {accountId: scope.accountId, display: scope.display || 'ChatGPT workspace'};
    state.lastVerifiedWorkspace = remembered;
    if (!Number.isInteger(tab?.windowId) || !chrome.storage?.session?.set) return;
    Promise.resolve(chrome.storage.session.set({[workspaceSessionKey(tab.windowId)]: remembered}))
      .catch(error => log('WARNING: Could not remember panel workspace: ' + error.message));
  }
  async function restoreVerifiedWorkspace() {
    if (!chrome.storage?.session?.get) return;
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!Number.isInteger(tab?.windowId)) return;
    const key=workspaceSessionKey(tab.windowId);
    // Chrome supports callback and Promise styles. Callback style also works in
    // the test harness and older Chromium extension implementations.
    const saved=await new Promise(resolve=>{
      let settled=false;
      const complete=value=>{if(!settled){settled=true;resolve(value||{});}};
      try {
        const pending=chrome.storage.session.get(key,complete);
        if(pending?.then)pending.then(complete,()=>complete({}));
      }catch(_err){complete({});}
    });
    const value=saved[key];
    if (!value || typeof value.accountId!=='string' || !value.accountId || state.scope) return;
    state.lastVerifiedWorkspace={accountId:value.accountId,display:String(value.display||'ChatGPT workspace')};
    // Read-only restoration: no ChatGPT API request and no permission prompt.
    try {
      const bound=await ChatArchiveVault.restoreWorkspaceDirectory(value.accountId);
      if(bound)state.directory=bound; // Workspace binding wins over global last-selected folder.
    }catch(_err){}
    if(!state.scope)await refreshSync().catch(error=>log('WARNING: Workspace status unavailable: '+error.message));
  }
  function status(message) { $('status').textContent = message; $('status').dataset.error='false'; }
  function log(message) {
    $('log').classList.remove('hidden');
    $('log').textContent = ($('log').textContent + `[${new Date().toLocaleTimeString()}] ${message}\n`).slice(-120000);
    $('log').scrollTop = $('log').scrollHeight;
  }
  function fail(error) { status(error?.message || String(error)); $('status').dataset.error='true'; log('ERROR: ' + (error?.message || error)); }

  function markBusy(value) {
    state.busy=value;
    // Manual jobs can be retained for a later Retry delivery even when no work
    // is running. Chat-list metadata is read-only and must remain available.
    for(const id of ['snapshotSettings','syncApply','pickFolder'])$(id).disabled=value;
    // Navigation and filtering never own a job and remain usable during work.
    refreshButtons();updateSyncApply();
    if(!value)scheduleReconnect(150);
  }
  function refreshButtons(){
    $('exportCurrent').disabled=state.busy||!state.port||!state.scope?.observed||!state.scope?.currentId||!$('currentSelect').checked;
    $('exportSelected').disabled=state.busy||!state.port||!state.scope?.observed||!(state.selected.size||state.selectedProjects.size);
    $('snapshotSettings').disabled=state.busy||!state.port||!state.scope?.observed||!state.directory;
    $('refreshLibrary').disabled=state.busy||state.librarySubmitting||!!state.libraryJob?.job?.active||!state.port||!state.scope?.observed||!state.directory;
    $('downloadLibraryCatalog').disabled=!state.library||state.libraryAccountId!==libraryAccount();
    $('selectedCount').textContent=`${state.selected.size} chats${state.selectedProjects.size?' + '+state.selectedProjects.size+' empty Projects':''} selected`;
    const hidden=state.chats.filter(c=>state.selected.has(c.id)&&!filteredChats().some(v=>v.id===c.id)).length;
    if(hidden)$('selectedCount').textContent+=` (${hidden} hidden by filters)`;
    $('exportSelected').textContent=$('outputFolder').checked?'Save selection to Vault':'Download selection ZIP';
    const title=state.chats.find(c=>c.id===state.scope?.currentId)?.title||state.tab?.title?.replace(/\s*[-|]\s*ChatGPT$/i,'');
    $('currentTitle').textContent=state.scope?.currentId?(title||'Current conversation'):'Open a ChatGPT conversation';
    $('currentTitle').title=state.scope?.currentId||'';
    refreshLibraryControls();uiRefresh();
  }
  function applyModeView(name){
    document.body.dataset.uiView=uiView;document.body.dataset.mode=name;
    if(SURFACE==='panel'){
      const header=$('librarySection').querySelector('h2');
      if(!$('refreshLibrary').closest('#librarySection')){const row=document.createElement('div');row.className='row';header.replaceWith(row);row.append(header,$('refreshLibrary'));}
      if(name==='all'){$('allSection').querySelector('.action-bar').prepend($('folderSection'));$('allSection').querySelector('.action-bar').append($('panelBehavior'));}
      else if(name==='library')$('librarySection').querySelector('.action-bar').append($('panelBehavior'));
      else $('currentSection').append($('panelBehavior'));
    }
    for(const node of document.querySelectorAll('[data-view]'))node.classList.toggle('hidden',node.dataset.view!==uiView);
    for(const [id,value] of [['navExport','export'],['navActivity','activity'],['navSettings','settings']]){
      $(id).classList.toggle('selected',uiView===value);$(id).setAttribute('aria-current',uiView===value?'page':'false');
    }
    for(const [id,value] of [['modeCurrent','current'],['modeAll','all'],['modeLibrary','library']])$(id).classList.toggle('selected',uiView==='export'&&name===value);
    $('modeMonitor').classList.toggle('selected',uiView==='activity');
    if(uiView==='export'){
      $('currentSection').classList.toggle('hidden',SURFACE==='panel'&&name!=='current');
      $('allSection').classList.toggle('hidden',SURFACE!=='panel'||name!=='all');
      $('librarySection').classList.toggle('hidden',SURFACE!=='panel'||name!=='library');
      $('inventorySection').classList.toggle('hidden',SURFACE==='panel'&&name!=='library');
      $('folderSection').classList.toggle('hidden',SURFACE!=='panel'||name!=='all');
    }
    $('folderControls').classList.remove('hidden');
  }
  function mode(name){
    if(!['current','all','library'].includes(name))return;
    if(SURFACE!=='panel'&&name!=='current'){openPanel(name);return;}
    state.mode=name;uiView='export';applyModeView(name);refreshButtons();
    if(name==='library'&&!state.libraryJob?.job?.active)status('Saved inventory. Refresh is manual.');
    if(name==='all')ensureListLoaded().catch(fail);
    if(name==='library')refreshLibraryState(true).catch(fail);
  }
  function call(type, data = {}, progress = null, timeoutMs = 150000) {
    if (!state.port) return Promise.reject(new Error('No ChatGPT connection. Use Reconnect.'));
    const id = state.nextId++;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, progress, timer: setTimeout(() => {
        state.requests.delete(id); reject(new Error('Export request timed out.'));
      }, timeoutMs) };
      state.requests.set(id, entry);
      try { state.port.postMessage({ id, type, ...data }); }
      catch (error) { clearTimeout(entry.timer); state.requests.delete(id); reject(error); }
    });
  }
  function disconnect() {
    if (state.port) try { state.port.disconnect(); } catch (_err) {}
    state.port = null;
    for (const pending of state.requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('ChatGPT tab was disconnected.')); }
    state.requests.clear();
  }
  async function connectActive(auto = false, force = false) {
    const tab=sourceTabId?await chrome.tabs.get(sourceTabId).catch(()=>null):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
    if (!tab || !CHAT_URL.test(tab.url || '')) {
      if (state.port) disconnect();
      state.tab = null;
      state.scope = null;
      $('scope').textContent = 'Open an active ChatGPT tab';
      refreshButtons();
      // Do not clear background status: it belongs to the last verified
      // workspace even while the current tab is an unrelated website.
      refreshSync().catch(error=>log('WARNING: Workspace status unavailable: '+error.message));
      if (!auto) throw new Error('Activate a ChatGPT tab in this window.');
      status('Waiting for an active ChatGPT tab.');
      return null;
    }
    // The same live port can be reused for ordinary tab-focus events. Refresh
    // CAE_STATUS when asked explicitly or after SPA URL changes.
    if (state.port && state.scope && state.tab?.id === tab.id && !force && state.tab.url === tab.url)
      return state.scope;
    disconnect();
    state.tab = tab;
    try { state.port = chrome.tabs.connect(tab.id, { name: 'CAE_API' }); }
    catch (_err) { throw new Error('ChatGPT tab is not accepting connections yet.'); }
    const activePort = state.port;
    activePort.onMessage.addListener(msg => {
      if (!msg || !state.requests.has(msg.id)) return;
      const entry = state.requests.get(msg.id);
      if (msg.progress) {
        clearTimeout(entry.timer); entry.timer = setTimeout(() => { state.requests.delete(msg.id); entry.reject(new Error('Export request timed out.')); }, 150000);
        entry.progress?.(msg.progress); return;
      }
      clearTimeout(entry.timer);
      state.requests.delete(msg.id);
      if (msg.error) { const error = new Error(msg.error); error.code = msg.errorCode; error.httpStatus = msg.httpStatus; error.retryAfterMs=msg.retryAfterMs; entry.reject(error); }
      else entry.resolve(msg.result);
    });
    activePort.onDisconnect.addListener(() => {
      // A missing/unloaded content-script receiver is reported asynchronously
      // here, not necessarily by tabs.connect(). Reading lastError is required
      // to acknowledge this expected Port failure in Chrome/Edge.
      const reason = chrome.runtime.lastError?.message || '';
      if (state.port !== activePort) return;
      const failedTabId = state.tab?.id;
      disconnect();
      // Reconnect an already-open ChatGPT tab after an extension update by
      // asking the worker to restore the content-script bridge in-place.
      const missingReceiver = /receiving end|could not establish connection|context invalidated/i.test(reason);
      if (missingReceiver && failedTabId != null) {
        chrome.runtime.sendMessage({type:'CAE_ENSURE_TAB',tabId:failedTabId})
          .then(reply => {
            if (reply?.ok && reply?.result?.ok && !state.busy) {
              state.nextAutoAttempt = 0; state.autoFailures = 0;
              scheduleReconnect(150);
            }
          }).catch(()=>{});
      }
      if (!state.busy) {
        if (state.autoFailures < 5) {
          status(reason ? 'ChatGPT tab temporarily unavailable; reconnecting automatically.' : 'ChatGPT connection closed; reconnecting.');
          scheduleReconnect(1200);
        } else {
          status('ChatGPT tab did not accept a connection. Reload that tab; reconnection will resume automatically.');
        }
      }
    });
    const scope = await call('CAE_STATUS', {force:force===true}, null, 12000);
    if(state.port!==activePort)return null; // A tab change may invalidate an in-flight reply.
    if (state.scope?.accountId && scope.accountId && state.scope.accountId !== scope.accountId) {
      state.chats = []; state.selected.clear();state.selectedProjects.clear(); state.listAccountId = null; state.listLoadedAt = 0; state.listSource = null;
      state.sync = null; state.syncLoaded = false; renderChats();
      state.library=null; state.libraryAccountId=null; state.libraryLoadedAt=0; state.libraryJob=null; state.librarySelected.clear(); state.libraryCatalogRevision=-1; renderLibrary();
      log('Workspace changed. Previous chat selection cleared.');
    }
    if(state.libraryAccountId && state.libraryAccountId!==scope.accountId){
      state.library=null;state.libraryAccountId=null;state.libraryJob=null;state.librarySelected.clear();state.libraryCatalogRevision=-1;
    }
    const previousAccount=state.lastVerifiedWorkspace?.accountId;
    if(previousAccount&&previousAccount!==scope.accountId){state.selected.clear();state.selectedProjects.clear();state.chats=[];state.projects=[];state.listAccountId=null;state.listLoadedAt=0;state.listSource=null;state.sync=null;state.librarySelected.clear();}
    state.scope = scope;
    chrome.runtime.sendMessage({type:'CAE_UI_BIND',tabId:tab.id,accountId:scope.accountId,display:scope.display,observed:scope.observed}).catch(()=>{});
    if(state.mode==='library')renderLibrary();
    rememberVerifiedWorkspace(scope,tab);
    // A workspace can have its own already-authorized Vault binding. It wins
    // over the globally last-chosen folder when returning to that workspace.
    try {
      const bound = await ChatArchiveVault.restoreWorkspaceDirectory(scope.accountId);
      state.directory=bound||null;
      await refreshVaultStatus();
    } catch (error) { log('WARNING: Workspace Vault status: ' + error.message); }
    $('scope').textContent = `${scope.display} · ${scope.accountId ? scope.accountId.slice(0, 8) : 'account not identified'}`;
    refreshButtons();
    if(manualJob?.active)showManual(manualJob);else status('Connected.');
    await refreshSync().catch(error => log('WARNING: Background status unavailable: ' + error.message));
    if (SURFACE==='panel'&&uiView==='export'&&state.mode === 'all'&&!manualJob?.active) ensureListLoaded().catch(error => log('WARNING: Could not load conversations: ' + error.message));
    refreshLibraryState(true).catch(error => log('WARNING: Could not read saved Library state: ' + error.message));
    if (!scope.observed) log('WARNING: Active workspace ID was not confirmed by the session API. Do not bulk export until the workspace is verified.');
    return scope;
  }
  async function reconnect(options = {}) {
    if (state.connecting) return state.connecting;
    const auto = !!options.auto;
    if (auto && Date.now() < state.nextAutoAttempt) return state.scope;
    const p = connectActive(auto, !!options.force).then(scope => {
      state.autoFailures = 0; state.nextAutoAttempt = 0;
      return scope;
    }).catch(error => {
      if (auto) {
        state.nextAutoAttempt = Date.now() + Math.min(30000, 1500 * 2 ** Math.min(++state.autoFailures, 4));
        status('Connection pending; will retry on the next ChatGPT tab event.');
        if (state.autoFailures <= 5) scheduleReconnect(state.nextAutoAttempt - Date.now() + 50);
        return null;
      }
      throw error;
    }).finally(() => { if (state.connecting === p) state.connecting = null; });
    state.connecting = p;
    return p;
  }
  function scheduleReconnect(delay = 250,force = false) {
    state.reverifyScope=!!state.reverifyScope||force;
    if (state.busy && !manualJob?.active) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      const reverify=state.reverifyScope;state.reverifyScope=false;
      reconnect({auto:true,force:reverify}).catch(() => {});
    }, delay);
  }

  function chatKind(c){return ChatArchivePaths.isProject(c.projectId)?'project':ChatArchivePaths.isGPT(c.gptId||c.projectId)?'gpt':'unassigned';}
  function filteredChats(){
    const query=$('search').value.toLocaleLowerCase().trim(),container=$('chatContainer').value,archived=$('chatArchived').value;
    return state.chats.filter(c=>(container==='all'||chatKind(c)===container)&&(archived==='all'||!!c.archived===(archived==='archived'))&&
      (!query||`${c.title} ${c.project||''} ${c.gptName||''}`.toLocaleLowerCase().includes(query)));
  }
  function refreshSelectionUi(){
    const ids=filteredChats().map(c=>c.id),v=U.selection(ids,state.selected);
    $('selectAll').checked=v.checked;$('selectAll').indeterminate=v.mixed;$('selectAll').disabled=!ids.length;
    refreshButtons();
  }
  function renderChats(){
    const all=new Map(),visibleIds=new Set(filteredChats().map(c=>c.id));
    for(const c of state.chats){
      const kind=chatKind(c),id=kind==='project'?ChatArchivePaths.canonical(c.projectId):kind==='gpt'?ChatArchivePaths.gptId(c.gptId||c.projectId):'unassigned';
      const key=kind+':'+id;
      if(!all.has(key))all.set(key,{id:key,name:kind==='project'?'Project - '+(c.project||id):kind==='gpt'?'GPT - '+ChatArchivePaths.gptLabel(id,c.gptName):'Without Project',entries:[]});
      all.get(key).entries.push(c);
    }
    for(const p of state.projects){
      const key='project:'+ChatArchivePaths.canonical(p.id);
      if(!all.has(key)&&ChatArchivePaths.isProject(p.id))all.set(key,{id:key,name:'Project - '+p.name,entries:[],emptyProjectId:p.id});
    }
    const selected=new Set([...state.selected,...[...state.selectedProjects].map(id=>'project:'+id)]),groups=[];
    for(const [key,g] of [...all.entries()].sort((a,b)=>ChatArchiveSort.compareGroups(a,b))){
      const visible=g.entries.filter(c=>visibleIds.has(c.id)).sort(ChatArchiveSort.compareChats);
      if(g.entries.length&&!visible.length)continue;
      if(g.emptyProjectId&&(($('chatContainer').value!=='all'&&$('chatContainer').value!=='project')||($('search').value&&!g.name.toLowerCase().includes($('search').value.toLowerCase()))))continue;
      groups.push({id:key,name:g.name,selectableIds:g.emptyProjectId?['project:'+g.emptyProjectId]:g.entries.map(c=>c.id),
        hint:g.emptyProjectId?'No conversations. Selection exports this Project configuration and Sources.':null,
        countText:visible.length===g.entries.length?String(visible.length):`${visible.length}/${g.entries.length}`,
        items:visible.map(c=>({id:c.id,title:c.title,note:c.updated?'Updated '+new Date(typeof c.updated==='number'?c.updated*1000:c.updated).toLocaleDateString():'',badge:c.archived?'archived':''}))});
    }
    CAEUITree.render($('groupList'),{groups,selected,collapsed:state.collapsed,onToggle:id=>{state.collapsed.has(id)?state.collapsed.delete(id):state.collapsed.add(id);renderChats();},
      onSelect:(ids,on)=>{for(const id of ids){if(id.startsWith('project:')){on?state.selectedProjects.add(id.slice(8)):state.selectedProjects.delete(id.slice(8));}else{on?state.selected.add(id):state.selected.delete(id);}}renderChats();}});
    refreshSelectionUi();
  }
  function showCachedChatList(data,account,source){
    if(!data?.items?.length||state.scope?.accountId!==account||state.listLoadedAt>0)return false;
    // Selection is by stable chat ID, never by title; preserve existing choices.
    state.chats=data.items;state.projects=data.projects||[];state.listAccountId=account;
    state.listSource=source||'saved';state.selected=new Set([...state.selected].filter(id=>data.items.some(c=>c.id===id)));
    $('listSummary').textContent=`${data.items.length} saved chats (${state.listSource}); checking ChatGPT for updates…`;
    renderChats();return true;
  }
  async function hydrateCachedChats(account){
    const C=globalThis.CAEUIChatListCache;
    if(!C||!account||state.scope?.accountId!==account||state.listLoadedAt>0)return;
    try{
      const key=C.key(account),saved=C.accept((await chrome.storage.local.get(key))[key],account);
      if(saved?.items?.length)showCachedChatList(saved,account,saved.source==='live_api'?'last ChatGPT list':saved.source);
    }catch(e){log('WARNING: Last chat-list cache unavailable: '+e.message);}
    // The Vault index/mirror is read-only. It is useful on the very first
    // panel opening, before any UI list cache exists for this workspace.
    if(state.listAccountId===account&&state.chats.length)return;
    try{
      const v=await syncCommand('CAE_UI_CHAT_CACHE',{accountId:account,display:state.scope?.display||''});
      if(v?.items?.length&&showCachedChatList(v,account,v.source||'Vault')){
        const value=C.envelope(account,v.source,v.items,v.projects);
        chrome.storage.local.set({[C.key(account)]:value}).catch(()=>{});
      }
    }catch(e){log('WARNING: Vault chat index unavailable: '+e.message);}
  }
  async function loadList() {
    // Refresh is independent of export jobs: the saved list stays interactive
    // while metadata is loaded in the background.
    const account=state.scope?.accountId;
    if(!account){status('Open an authenticated ChatGPT tab to load conversations.');return;}
    $('loadAll').disabled=true;
    try {
      status(state.chats.length?'Refreshing conversations; saved list remains available…':'Loading conversations…');
      const listPort=state.port,listScope=account;
      const data=await call('CAE_LIST',{},p=>status(p.detail));
      if(state.port!==listPort||state.scope?.accountId!==listScope||data.scope?.accountId!==listScope)
        throw Error('Workspace changed. Discarded the old chat list.');
      state.scope=data.scope;state.warnings=data.warnings||[];
      state.chats=data.items||[];state.projects=data.projects||[];
      state.listAccountId=listScope;state.listLoadedAt=Date.now();state.listSource='live_api';
      const current=new Set(state.chats.map(c=>c.id));
      state.selected=new Set([...state.selected].filter(id=>current.has(id)));
      const projects=new Set(state.projects.map(p=>p.id));
      state.selectedProjects=new Set([...state.selectedProjects].filter(id=>projects.has(id)));
      $('scope').textContent=`${data.scope.display} · ${String(listScope).slice(0,8)}`;
      $('listSummary').textContent=`${state.chats.length} current chats in ${state.projects.length} projects. ${state.warnings.length?'Warnings: '+state.warnings.length:''}`;
      for(const w of state.warnings)log('WARNING: '+w);
      renderChats();status(`Updated list: ${state.chats.length} conversations.`);
      // This UI-only metadata cache never writes to Vault and cannot change
      // Chat Archive Exporter indexes or the underlying export semantics.
      const C=globalThis.CAEUIChatListCache;
      if(C){const cached=C.envelope(listScope,'live_api',state.chats,state.projects);
        chrome.storage.local.set({[C.key(listScope)]:cached}).catch(e=>log('WARNING: Could not cache chat list: '+e.message));}
    }catch(error){
      if(state.scope?.accountId!==account)return;
      if(state.chats.length){
        status('Showing saved chat list. Could not update from ChatGPT: '+error.message);
        $('listSummary').textContent=`${state.chats.length} saved chats · update unavailable`;
        log('WARNING: Live chat-list refresh failed; cached rows preserved: '+error.message);
      }else fail(error);
    }finally{$('loadAll').disabled=false;refreshButtons();}
  }
  function ensureListLoaded(force=false){
    // Do not gate metadata listing on manualJob.active: download_failed and
    // delivery_uncertain intentionally keep active=true while waiting for the
    // user's Retry/Stop decision. Blocking here prevents BOTH the saved Vault
    // preview and the live ChatGPT list in an otherwise healthy workspace.
    // The original export job remains untouched and still prevents a second
    // manual export from being submitted until the user resolves it.
    if(!state.scope?.observed||!state.scope.accountId)return Promise.resolve();
    const account=state.scope.accountId;
    if(state.listLoading&&state.listLoadAccount===account)return state.listLoading;
    if(!force&&state.listAccountId===account&&state.listLoadedAt&&Date.now()-state.listLoadedAt<LIST_MAX_AGE_MS)
      return Promise.resolve();
    // Start both at once: the cache renders as soon as available, rather
    // than waiting for all pages of the provider's listing API.
    const task=Promise.allSettled([hydrateCachedChats(account),loadList()]);
    const pending=task.finally(()=>{if(state.listLoading===pending){state.listLoading=null;state.listLoadAccount=null;}});
    state.listLoading=pending;state.listLoadAccount=account;return pending;
  }

  function libraryEligible(f){return !!f.archive_eligibility?.selectable&&!f.managed_by_project_sources&&!['saved','already_archived'].includes(f.archive?.status);}
  function renderLibrary(){
    const catalog=state.libraryAccountId===libraryAccount()?state.library:null;
    if(!catalog){$('libraryGroups').replaceChildren();$('librarySummary').textContent='No saved inventory for this workspace.';$('libraryCount').textContent='No inventory loaded.';libraryVisible=[];refreshButtons();return;}
    const summary=catalog.summary||{};
    $('librarySummary').textContent=`${summary.total||0} files - ${catalog.status||'unknown'} - ${summary.project_source_excluded||0} Project Sources excluded`;
    const needle=$('librarySearch').value.toLowerCase().trim(),context=$('libraryContextFilter').value,origin=$('libraryOrigin').value,media=$('libraryMedia').value,arch=$('libraryArchiveFilter').value;
    const filtered=(catalog.items||[]).filter(f=>{
      const saved=['saved','already_archived'].includes(f.archive?.status);
      if(context!=='all'&&!(f.contexts||[]).includes(context)||origin!=='all'&&f.origin!==origin||media!=='all'&&f.media_class!==media)return false;
      if(arch==='saved'&&!saved||arch==='ready'&&!libraryEligible(f)||arch==='excluded'&&f.archive_eligibility?.selectable||arch==='failed'&&!['failed','download_failed','error'].includes(f.archive?.status))return false;
      return !needle||[f.name,f.mime_type,f.format_class,...(f.library_locations||[]).map(l=>l.folder_path),...(f.placements||[]).map(p=>p.project_name)].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
    libraryVisible=filtered;
    const ids=new Set((catalog.items||[]).filter(libraryEligible).map(f=>f.id));
    for(const id of state.librarySelected)if(!ids.has(id))state.librarySelected.delete(id);
    const groups=[];
    for(const [o,label] of [['uploaded','Uploaded'],['generated','Generated'],['unknown','Unknown origin']])for(const [m,mlabel] of [['image','Images'],['file','Other files']]){
      const all=catalog.items.filter(f=>f.origin===o&&f.media_class===m),files=filtered.filter(f=>f.origin===o&&f.media_class===m);if(!files.length)continue;
      groups.push({id:o+'/'+m,name:label+' - '+mlabel,selectableIds:all.filter(libraryEligible).map(f=>f.id),countText:files.length===all.length?String(files.length):`${files.length}/${all.length}`,
        items:files.map(f=>({id:f.id,title:f.name||f.id,selectable:!!f.archive_eligibility?.selectable&&!f.managed_by_project_sources,archived:['saved','already_archived'].includes(f.archive?.status),disabled:!libraryEligible(f),
          reason:f.managed_by_project_sources?'Project Source: Vault copy not verified; use Project Sources export':f.archive_eligibility?.reason||'Not selectable',badge:f.managed_by_project_sources?'Source':f.archive?.status==='saved'?'Saved':f.archive?.status==='failed'?'Failed':'',
          note:[f.format_class,f.origin_status==='inferred'?'inferred':f.origin==='unknown'?'origin unknown':null,
            f.managed_by_project_sources?'Project Source: Library download disabled (Vault copy not verified)':null,...(f.placements||[]).filter(p=>p.type==='project_source').map(p=>p.project_name),
            f.library_locations?.[0]?.folder_path,f.archive?.http_status?'HTTP '+f.archive.http_status:null].filter(Boolean).join(' - ')}))});
    }
    CAEUITree.render($('libraryGroups'),{groups,selected:state.librarySelected,collapsed:libraryCollapsed,disabled:!!state.libraryJob?.job?.active,kind:'library',
      onToggle:id=>{libraryCollapsed.has(id)?libraryCollapsed.delete(id):libraryCollapsed.add(id);renderLibrary();},
      onSelect:(ids,on)=>{for(const id of ids)on?state.librarySelected.add(id):state.librarySelected.delete(id);renderLibrary();}});
    $('libraryCount').textContent=`Showing ${filtered.length} of ${catalog.items.length} files`;
    $('libraryWarnings').textContent=(catalog.warnings||[]).join('\n');$('libraryWarnings').classList.toggle('hidden',!catalog.warnings?.length);refreshButtons();
  }
  function libraryAccount(){return state.scope?.accountId||state.lastVerifiedWorkspace?.accountId||null;}
  function refreshLibraryControls(){
    const j=state.libraryJob,active=!!j?.job?.active,verified=state.scope?.observed&&state.scope?.accountId===libraryAccount();
    $('libraryStop').disabled=!(active||j?.enabled);
    $('libraryResume').classList.toggle('hidden',!j?.job||!['waiting_for_tab','permission_required','error','retry_wait','cooldown'].includes(j.job.status));
    $('libraryMonitor').disabled=!j?.baseline_at||active||!verified;
    $('libraryMonitor').checked=!!j?.enabled;
    $('libraryPickVault').disabled=active||!!j?.enabled||!!state.sync?.enabled||state.busy;
    $('libraryGrantVault').classList.toggle('hidden',!state.directory||state.vaultPermission==='granted');
    $('libraryVaultName').textContent=state.directory?`Vault: ${state.directory.name} (${state.vaultPermission})`:'Choose a Vault before starting.';
    $('libraryArchive').disabled=!verified||active||state.librarySubmitting||!j?.baseline_at||!state.librarySelected.size;
    $('librarySelectAll').disabled=active||!state.library;
    for(const box of $('libraryGroups').querySelectorAll('.library-file-checkbox'))box.disabled=active||box.dataset.archived==='true';
    const visibleIds=libraryVisible.filter(libraryEligible).map(f=>f.id),sel=U.selection(visibleIds,state.librarySelected);
    $('librarySelectAll').checked=sel.checked;$('librarySelectAll').indeterminate=sel.mixed;
    const hiddenCount=[...state.librarySelected].filter(id=>!visibleIds.includes(id)).length;
    $('librarySelectedCount').textContent=`${state.librarySelected.size} selected`+(hiddenCount?` (${hiddenCount} hidden by filters)`:'');
    const job=j?.job;
    $('libraryJobStatus').textContent=job?`${job.status}: ${job.detail}`:'Idle. Start inventory is the only initial scan trigger.';
  }
  async function refreshLibraryState(includeCatalog=false){
    const account=libraryAccount();if(!account)return;
    if(state.libraryRefresh){await state.libraryRefresh;if(includeCatalog)return refreshLibraryState(true);return;}
    const operation=(async()=>{
      let j=await syncCommand('CAE_LIBRARY_JOB_STATUS',{accountId:account,withCatalog:includeCatalog});
      if(libraryAccount()!==account)return;
      if(j&&!includeCatalog&&j.catalog_revision!==state.libraryCatalogRevision)
        j=await syncCommand('CAE_LIBRARY_JOB_STATUS',{accountId:account,withCatalog:true});
      if(libraryAccount()!==account)return;
      state.libraryJob=j;
      if(!j){state.library=null;state.libraryAccountId=null;state.librarySelected.clear();state.libraryCatalogRevision=-1;renderLibrary();}
      if(j?.catalog){
        state.library=j.catalog;state.libraryAccountId=account;state.libraryCatalogRevision=j.catalog_revision;
        const archived=new Set(j.catalog.items.filter(x=>['saved','already_archived'].includes(x.archive?.status)).map(x=>x.id));
        for(const id of archived)state.librarySelected.delete(id);
        renderLibrary();
      }
      if(j?.job?.active||j?.enabled){
        const bound=await ChatArchiveLibraryStore.directory(account);
        if(bound&&libraryAccount()===account)state.directory=bound;
      }
      refreshButtons();refreshLibraryControls();
    })().finally(()=>{if(state.libraryRefresh===operation)state.libraryRefresh=null;});
    state.libraryRefresh=operation;return operation;
  }
  async function startLibrary(){
    if(state.librarySubmitting)return;
    const scope=state.scope?{...state.scope}:null,tabId=state.tab?.id,dir=state.directory,monitor=$('libraryMonitorOnStart').checked;
    state.librarySubmitting=true;refreshButtons();
    try{
      if(!scope?.observed||!scope.accountId||!tabId)throw Error('Connect the active ChatGPT workspace first.');
      if(!dir)throw Error('Choose a Vault first.');
      if(!(await ChatArchiveVault.hasPermission(dir,true)))throw Error('Vault write access is required.');
      if(state.scope?.accountId!==scope.accountId||state.tab?.id!==tabId)throw Error('Workspace changed before inventory acceptance.');
      await ChatArchiveLibraryStore.bind(scope.accountId,dir);
      await ChatArchiveVault.rememberWorkspaceDirectory(scope.accountId,dir);
      state.libraryJob=await syncCommand('CAE_LIBRARY_JOB_START',{options:{accountId:scope.accountId,display:scope.display,tabId,monitor}});
      status('Library inventory accepted. You may switch sections or close this interface.');
      await refreshLibraryState(true);
    }catch(e){fail(e);}finally{state.librarySubmitting=false;refreshButtons();}
  }
  async function archiveLibrarySelection(){
    if(state.librarySubmitting)return;
    try{
      if(!state.scope?.observed)throw Error('Reconnect the original workspace first.');
      state.librarySubmitting=true;refreshButtons();
      state.libraryJob=await syncCommand('CAE_LIBRARY_JOB_ARCHIVE',{options:{accountId:state.scope.accountId,
        tabId:state.tab?.id,ids:[...state.librarySelected]}});
      status('Selected originals queued. Existing archived copies will not be duplicated.');
      await acceptedExport();
      await refreshLibraryState(true);
    }catch(e){fail(e);}finally{state.librarySubmitting=false;refreshButtons();}
  }
  function downloadLibrary(){
    if(!state.library||state.libraryAccountId!==libraryAccount())return;
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const bytes=JSON.stringify(state.library,null,2)+'\n';
    downloadBlob(new Blob([bytes],{type:'application/json'}),`CAE-Library-Inventory-${stamp}.json`);
    status('Metadata catalog prepared. No original files were downloaded.');
  }
  let lifecyclePort=null, vaultStatusRun=null;
  let holderReadyKey='', holderReadyAt=0, holderReadyPending=null;
  function notifyPanelPermission(permission) {
    if(!state.scope?.accountId||!chrome.runtime.connect)return;
    try {
      if(!lifecyclePort){
        const port=chrome.runtime.connect({name:'cae-panel-lifecycle'});
        lifecyclePort=port;
        port.onDisconnect.addListener(()=>{
          const ignored=chrome.runtime.lastError?.message;
          if(lifecyclePort===port)lifecyclePort=null;
          // Reconnect only on a later genuine UI event; no keepalive loop.
        });
      }
      lifecyclePort.postMessage({type:'bind',accountId:state.scope.accountId,permission,
        userActivation:navigator.userActivation?.isActive===true});
    }catch(_){lifecyclePort=null;}
  }
  async function retainGrantedVault(force=false) {
    const accountId=state.scope?.accountId;
    if(!state.sync?.enabled||!accountId)return;
    if(holderReadyPending)return holderReadyPending;
    const key=accountId;
    if(!force&&holderReadyKey===key&&Date.now()-holderReadyAt<60000)return;
    const p=(async()=>{
      const result=await syncCommand('CAE_VAULT_READY',{accountId});
      if(state.scope?.accountId!==accountId)return;
      holderReadyKey=key;holderReadyAt=Date.now();
      if(result?.access){
        state.sync.access=result.access;
        const a=result.access;
        $('accessState').textContent=`Last access check: writer ${a.worker}; holder ${a.offscreen}`+
          (a.retained?' (handle retained)':' (not retained)');
      }
    })().finally(()=>{if(holderReadyPending===p)holderReadyPending=null;});
    holderReadyPending=p;return p;
  }
  async function refreshVaultStatus() {
    if(vaultStatusRun)return vaultStatusRun;
    const dir=state.directory,account=state.scope?.accountId;
    const operation=(async()=>{
      const button=$('authorizeVault'),picker=$('pickFolder');
      picker.disabled=state.busy||!!state.sync?.enabled;
      if(!dir){
        picker.textContent='Choose Vault\u2026';
        $('folderStatus').textContent='No directory handle selected. Choose the existing Vault to reconnect it.';
        state.vaultPermission='no_handle';button.classList.add('hidden');
        notifyPanelPermission('no_handle');return;
      }
      picker.textContent='Change Vault\u2026';
      const permission=await ChatArchiveVault.permissionState(dir);
      // Ignore a stale async result from a different workspace/directory.
      if(dir!==state.directory||account!==state.scope?.accountId)return;
      const previous=state.vaultPermission;
      state.vaultPermission=permission.state;
      const labels={
        granted:'write access available',
        prompt:'browser confirmation required to write; queued work is retained',
        denied:'write access denied by the browser',
        no_handle:'directory handle is missing',
        unsupported:'File System Access permission API unavailable',
        error:'permission check failed ('+(permission.errorName||'Error')+')'
      };
      $('folderStatus').textContent=`Vault: ${dir.name} \u00b7 ${labels[permission.state]||labels.error}`;
      $('folderStatus').title=dir.name;
      button.textContent=permission.state==='denied'?'Review Vault access\u2026':'Restore Vault access\u2026';
      const manualNeedsAccess=manualJob?.active&&manualJob.destination==='vault'&&manualJob.accountId===account;
      button.classList.toggle('hidden',permission.state==='granted');
      if(manualNeedsAccess)button.disabled=false;
      notifyPanelPermission(permission.state);
      if(permission.state==='granted'&&state.sync?.enabled){
        await retainGrantedVault(previous!=='granted').catch(error=>
          log('WARNING: Could not confirm Vault handle retention: '+error.message));
      }
    })().finally(()=>{
      if(vaultStatusRun===operation)vaultStatusRun=null;
      uiRefresh();
      if(dir!==state.directory||account!==state.scope?.accountId)refreshVaultStatus().catch(()=>{});
    });
    vaultStatusRun=operation;return operation;
  }
  async function restoreFolder() {
    try { const restored = await ChatArchiveVault.restoreDirectory(); if (!state.directory) state.directory = restored; }
    catch (e) { log('Vault directory handle could not be restored: ' + (e.message || e)); }
    await refreshVaultStatus();
  }
  async function selectFolder() {
    if (manualJob?.active || state.sync?.enabled || state.libraryJob?.enabled || state.libraryJob?.job?.active) throw new Error('Pause background updates and Library jobs before changing the Vault.');
    if(SURFACE==='popup'){openOptions('settings');status('Use Choose Vault in the persistent settings tab.');return;}
    if (typeof window.showDirectoryPicker !== 'function')
      throw new Error('Directory picker unavailable. Use Chrome with File System Access support.');
    // Picker must be invoked directly from the click gesture, before other awaits.
    const dir = await window.showDirectoryPicker({ id: 'chat-archive-exporter-vault', mode: 'readwrite' });
    state.directory = dir;
    if(state.scope?.observed)await ChatArchiveVault.rememberWorkspaceDirectory(state.scope.accountId,dir);
    try { await ChatArchiveVault.rememberDirectory(dir); }
    catch (e) { log('WARNING: This Vault can be used now, but its folder handle could not be remembered: ' + e.message); }
    await refreshVaultStatus();refreshLibraryControls();
    status('Vault selected. Existing files and indexes will be reused.');
  }
  async function grantVaultAccess() {
    if(!state.scope?.observed)throw Error('Activate the original ChatGPT workspace before reconnecting its Vault.');
    if (!state.directory) throw new Error('Choose a Vault directory first.');
    if (!(await ChatArchiveVault.hasPermission(state.directory, true)))
      throw new Error('Vault write permission was not granted.');
    await refreshVaultStatus();
    if(state.sync?.enabled)await retainGrantedVault();
    await syncCommand('CAE_MANUAL_WAKE',{accountId:state.scope?.accountId}).catch(()=>{});
    if(libraryAccount())await syncCommand('CAE_LIBRARY_JOB_RESUME',{accountId:libraryAccount()}).catch(()=>{});
    refreshLibraryControls();
    status('Vault write access granted; accepted jobs may resume.');
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  // Manual tasks are accepted by the worker after their selection and folder
  // binding have been persisted. No chat/source execution remains in this UI.
  let manualJob = null, manualSubmitting = false, manualRefresh = null, manualBindingId = null, manualDirectory = null;
  async function restoreManualBinding(j) {
    if(!j?.active||j.destination!=='vault'||j.accountId!==state.scope?.accountId)return;
    const dir=manualBindingId===j.id&&manualDirectory?manualDirectory:await ChatArchiveManualStore.directory(j.id);
    if(!dir||manualJob?.id!==j.id||state.scope?.accountId!==j.accountId)return;
    manualBindingId=j.id;manualDirectory=dir;state.directory=dir;await refreshVaultStatus();
  }
  function showManual(j) {
    manualJob = j;
    if (!j) {uiRefresh();return;}
    if(j.active&&j.destination==='vault'&&j.accountId===state.scope?.accountId)restoreManualBinding(j).then(()=>refreshVaultStatus()).catch(e=>log('Could not restore manual Vault binding: '+e.message));
    const busy = !!j.active;
    if (state.busy !== busy && !state.listLoading) markBusy(busy);
    $('progress').classList.remove('hidden');
    const sourcePhase = j.phase === 'sources';
    $('progress').max = Math.max(1, sourcePhase ? j.totalSources : j.totalChats);
    $('progress').value = sourcePhase ? j.sourcesDone : j.chatsDone;
    const word = j.destination === 'vault' ? 'saved' : 'prepared';
    const userCanceled=U.userCanceledDownload(j);
    const unsaved=j.destination==='download'&&j.status==='completed_not_saved';
    $('manualSummary').textContent=(`${unsaved?'Prepared, not saved':userCanceled?'Download canceled by user':j.status} - ${j.workspace} - ${unsaved?'Browser Save was canceled. No file saved; temporary data discarded.':userCanceled?'Browser Save was canceled. Prepared data retained; Retry is optional.':j.message || ''}` +
      ` Chats: ${j.counts.saved} ${word}, ${j.counts.skipped} skipped, ${j.counts.failed} failed.` +
      (j.counts.conflict ? ` ${j.counts.conflict} local conflicts preserved.` : '') +
      (j.sources ? ` Sources: ${j.sources.saved} ${word}, ${j.sources.skipped} skipped, ${j.sources.failed} failed.` : ''));
    $('cancel').classList.toggle('hidden', !busy);
    $('cancel').disabled = !!j.cancelRequested;
    $('retryManual').classList.toggle('hidden', !['download_failed','delivery_uncertain','storage_error','error'].includes(j.status));
    $('manualHint').textContent = unsaved
      ? 'Selection processed; no browser file was saved. The job is closed and another export may start. Vault access was not changed.'
      : userCanceled
        ? 'You canceled the browser Save dialog. This does not affect Vault access. Use Retry delivery if you want the ZIP, or Stop export to discard the pending job.'
      : busy
        ? 'Accepted job runs independently. You may close this panel. A live ChatGPT tab in the original workspace is needed for pending downloads from ChatGPT.'
        : (j.destination === 'download' && j.status.startsWith('completed') ? 'Browser download completed.' : 'No manual job is running.');
    if (j.logs?.length) {
      $('log').classList.remove('hidden');
      $('log').textContent = j.logs.map(x=>`[${new Date(x.at).toLocaleTimeString()}] ${x.level}: ${x.message}`).join('\n');
      $('log').scrollTop = $('log').scrollHeight;
    }
    uiRefresh();
  }
  function refreshManual() {
    if (manualRefresh) return manualRefresh;
    const p = syncCommand('CAE_MANUAL_STATUS').then(j => { if (!manualSubmitting) showManual(j); }).finally(()=>{if(manualRefresh===p)manualRefresh=null;});
    manualRefresh=p;return p;
  }
  async function exportChats(items,options={}) {
    if (state.busy || manualSubmitting) return;
    if (!items.length&&!state.selectedProjects.size) { status('No conversations or Projects selected.'); return; }
    if (!state.scope?.observed || !state.scope?.accountId) { status('Connect to a verified workspace first.'); return; }
    manualSubmitting=true;markBusy(true);
    const destination=options.destination||($('outputFolder').checked?'vault':'download'),exportMode=options.mode||state.mode;
    const boundScope={...state.scope},boundTab=state.tab?.id,boundDirectory=state.directory;
    const selectedProjects=exportMode==='all'?[...state.selectedProjects]:[],projectSnapshot=state.projects.map(p=>({...p})),totalChats=state.chats.length;
    const requestId=crypto.randomUUID();
    try {
      // Permission comes from this user action; never from a hidden controller.
      if (destination==='vault') {
        if (!boundDirectory) throw new Error('Choose a Vault first.');
        if (!(await ChatArchiveVault.hasPermission(boundDirectory,true))) throw new Error('Vault write permission required.');
        await ChatArchiveManualStore.bind(requestId,boundDirectory);
      }
      if(state.scope?.accountId!==boundScope.accountId||state.tab?.id!==boundTab)throw Error('Workspace changed before acceptance. Start again in the intended workspace.');
      const j=await syncCommand('CAE_MANUAL_SUBMIT',{options:{requestId,
        accountId:boundScope.accountId,display:boundScope.display,tabId:boundTab,
        destination,mode:exportMode,items:items.map(x=>({...x})),projects:projectSnapshot,
        selectedProjectIds:selectedProjects,
        fullWorkspace:exportMode==='all'&&totalChats>0&&items.length===totalChats}});
      showManual(j);
      if(exportMode!=='configuration')await acceptedExport();
    }catch(e){fail(e);markBusy(false);}
    finally{manualSubmitting=false;refreshManual().catch(()=>{});}
  }


  async function snapshotSettings(){
    if(state.busy||manualSubmitting)return;
    if(!state.scope?.observed||!state.scope.accountId||!state.tab?.id)
      throw Error('Activate the confirmed ChatGPT workspace first.');
    if(!state.directory)throw Error('Choose the existing Vault first.');
    manualSubmitting=true;markBusy(true);
    const scope={...state.scope},tabId=state.tab.id,dir=state.directory;
    const requestId=crypto.randomUUID();
    try{
      if(!(await ChatArchiveVault.hasPermission(dir,true)))
        throw Error('Vault write permission is required.');
      await ChatArchiveManualStore.bind(requestId,dir);
      if(state.scope?.accountId!==scope.accountId||state.tab?.id!==tabId)throw Error('Workspace changed before snapshot acceptance.');
      const j=await syncCommand('CAE_MANUAL_SUBMIT',{options:{requestId,
        accountId:scope.accountId,display:scope.display,tabId,
        destination:'vault',mode:'configuration',items:[],projects:[],fullWorkspace:true}});
      showManual(j);status('Workspace snapshot accepted. See Activity for progress.');
    }catch(e){fail(e);markBusy(false);}
    finally{manualSubmitting=false;refreshManual().catch(()=>{});}
  }

  async function currentChat(destination='download') {
    if (state.busy || !$('exportCurrent') || $('exportCurrent').disabled) return;
    if (!state.scope?.currentId) { status('Open a ChatGPT conversation first.'); return; }
    const item=state.chats.find(c=>c.id===state.scope.currentId)||{id:state.scope.currentId,title:'Current chat',project:'',projectId:''};
    await exportChats([item],{mode:'current',destination});
  }

  async function syncCommand(type, extra={}) {
    const response = await chrome.runtime.sendMessage({type,...extra});
    if(!response?.ok)throw new Error(response?.error||'Background controller unavailable.');
    return response.result;
  }
  function syncForm() {
    return {enabled:$('syncEnabled').checked,scope:$('syncScope').value,
      enrollment:$('syncEnrollment').value,sources:$('syncSources').checked};
  }
  function syncSaved(c=state.sync) {
    return {enabled:!!c?.enabled,scope:c?.scope||'active',
      enrollment:c?.enrollment||'tracked',sources:!!c?.sources};
  }
  function isSyncDirty(c=state.sync) {
    if(!state.syncLoaded)return false;
    const desired=syncForm(), saved=syncSaved(c);
    if(desired.enabled!==saved.enabled)return true;
    if(!desired.enabled)return false;
    return desired.scope!==saved.scope||desired.enrollment!==saved.enrollment||desired.sources!==saved.sources;
  }
  function updateSyncApply() {
    const enabled=!!state.sync?.enabled;
    const editable=canEditSync(state.syncAccountId);
    $('syncApply').textContent=enabled?'Apply changes':'Apply / enable';
    $('syncApply').disabled=state.busy||!editable||!isSyncDirty();
    $('syncPause').disabled=!editable||!enabled;
    for(const id of ['syncEnabled','syncScope','syncEnrollment','syncSources'])
      $(id).disabled=state.busy||!editable;
  }
  async function refreshSync(force=false) {
    const workspace=syncWorkspace();
    if(!workspace?.accountId){
      state.syncLoaded=false;
      $('syncStatus').textContent='Connect to a verified ChatGPT workspace first.';
      updateSyncApply();return;
    }
    const accountId=workspace.accountId;
    const c=await syncCommand('CAE_SYNC_STATUS',{accountId});
    if(syncWorkspace()?.accountId!==accountId)return; // Ignore replies from previous tabs/workspaces.
    const preserveEdits=!force&&state.syncAccountId===accountId&&isSyncDirty();
    state.sync=c;
    state.syncAccountId=accountId;
    state.syncLoaded=true;
    // Preserve unsaved changes even if focus moved off the select/checkbox.
    if(!preserveEdits){
      $('syncEnabled').checked=!!c.enabled;
      $('syncScope').value=c.scope||'active';
      $('syncEnrollment').value=c.enrollment||'tracked';
      $('syncSources').checked=!!c.sources;
    }
    $('syncStatus').textContent=c.enabled
      ? `${c.status} · ${c.trackedChats||0} archived chats · ${c.queue||0} queued · ${(c.buffer?.pending||0)} buffered · ${(c.buffer?.conflicts||0)} conflicts\nVault: ${c.vaultName||'unknown'}${c.since?' · Since: '+new Date(c.since).toLocaleString():''}\n${c.message||''}`
      : (c.startedAt?'Paused. The original enrollment date is retained.':'Off. Enable only after a successful manual Vault export.');
    if(!canEditSync(accountId))
      $('syncStatus').textContent+='\nViewing '+workspace.display+' (status only). Activate its ChatGPT tab to change settings.';
    $('accessState').textContent=c.access
      ? `Last access check: writer ${c.access.worker}; holder ${c.access.offscreen}`+
        (c.access.retained?' (handle retained)':' (not retained)')
      : 'Permission checks run for enabled workspaces. No content is stored in the access log.';
    $('syncLog').textContent=(c.logs||[]).map(x=>`[${new Date(x.at).toLocaleTimeString()}] ${x.level}: ${x.message}`).join('\n');
    $('syncLog').classList.toggle('hidden',!(c.logs||[]).length);
    updateSyncApply();uiRefresh();
    refreshVaultStatus().catch(()=>{});
  }
  async function applySync() {
    if(state.busy)throw new Error('Finish the current export first.');
    if(!state.scope?.observed||!state.scope?.accountId)throw new Error('Connect to a verified workspace first.');
    if(!isSyncDirty())return;
    $('syncApply').disabled=true;
    try{
      if(!$('syncEnabled').checked){await syncCommand('CAE_SYNC_PAUSE',{accountId:state.scope.accountId});}
      else{
        if(!state.directory)throw new Error('Choose a Vault and export at least one chat first.');
        if(!(await ChatArchiveVault.hasPermission(state.directory,true)))throw new Error('Vault write permission is required.');
        await ChatArchiveVault.rememberDirectory(state.directory);
        await syncCommand('CAE_SYNC_ENABLE',{options:{accountId:state.scope.accountId,display:state.scope.display,
          tabId:state.tab.id,scope:$('syncScope').value,enrollment:$('syncEnrollment').value,sources:$('syncSources').checked}});
      }
      await refreshSync(true);
    }finally{updateSyncApply();}
  }
  $('exportAccessDiagnostics').addEventListener('click',async()=>{
    const button=$('exportAccessDiagnostics');button.disabled=true;
    try{
      const data=await syncCommand('CAE_VAULT_DIAGNOSTICS',{accountId:state.scope?.accountId});
      downloadBlob(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}),
        'CAE-access-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
      status('Access diagnostics downloaded. No chat text, paths, tokens or source URLs are included.');
    }catch(error){fail(error);}finally{button.disabled=false;}
  });
  $('syncApply').addEventListener('click',()=>applySync().catch(e=>{fail(e);refreshSync(true).catch(()=>{});}));
  $('syncPause').addEventListener('click',async()=>{
    if(!canEditSync(state.syncAccountId))return;
    try{await syncCommand('CAE_SYNC_PAUSE',{accountId:state.scope.accountId});await refreshSync(true);}catch(e){fail(e);}
  });
  for(const id of ['syncEnabled','syncScope','syncEnrollment','syncSources'])
    $(id).addEventListener('change',updateSyncApply);
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes['cae.background.v1'])refreshSync().catch(()=>{});
  });
  // Permission revalidation is passive and never opens a dialog on tab focus.
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      refreshVaultStatus().catch(()=>{});
      scheduleReconnect();
      if (state.scope) refreshSync().catch(()=>{});
    }
  });
  window.addEventListener('focus',()=>{refreshVaultStatus().catch(()=>{});scheduleReconnect();});
  chrome.tabs.onActivated?.addListener(()=>{
    state.nextAutoAttempt=0;state.autoFailures=0;scheduleReconnect(250,true);
  });
  chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{
    if (tab.active&&(change.url||change.status==='complete')) {
      state.nextAutoAttempt=0;state.autoFailures=0;scheduleReconnect(350,true);
    }
  });
  chrome.windows?.onFocusChanged?.addListener(windowId=>{
    if(windowId!==chrome.windows.WINDOW_ID_NONE) scheduleReconnect(350);
  });


  async function setPanelModeFromSession(){
    const w=await chrome.windows.getCurrent?.().catch(()=>null);uiWindowId=w?.id??state.tab?.windowId;
    if(SURFACE!=='panel')return;
    const key='cae.ui.intent.'+uiWindowId;
    const result=await chrome.storage.session.get([key,'caeInitialMode']);
    const i=result[key];
    if(i)consumeIntent(i);else if(result.caeInitialMode==='all')mode('all');
  }
  function consumeIntent(intent){
    if(!intent||uiIntent===intent.nonce)return;uiIntent=intent.nonce;
    if(intent.mode==='monitor')route('activity');else if(['all','current','library'].includes(intent.mode)){mode(intent.mode);if(intent.mode==='all'&&intent.refresh)ensureListLoaded(true).catch(fail);}
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (SURFACE==='panel' && area === 'session' && changes.caeInitialMode && ['current', 'all'].includes(changes.caeInitialMode.newValue)) {
      mode(changes.caeInitialMode.newValue);
    }
  });
  $('modeCurrent').addEventListener('click', () => mode('current'));
  $('modeAll').addEventListener('click', () => mode('all'));
  $('modeLibrary').addEventListener('click', () => mode('library'));
  $('refreshLibrary').addEventListener('click', startLibrary);
  $('libraryPickVault').addEventListener('click',()=>selectFolder().catch(fail));
  $('libraryGrantVault').addEventListener('click',()=>grantVaultAccess().catch(fail));
  $('libraryStop').addEventListener('click',async()=>{
    try{await syncCommand('CAE_LIBRARY_JOB_STOP',{accountId:libraryAccount()});await refreshLibraryState(true);}catch(e){fail(e);}
  });
  $('libraryResume').addEventListener('click',async()=>{
    try{await syncCommand('CAE_LIBRARY_JOB_RESUME',{accountId:libraryAccount()});await refreshLibraryState(true);}catch(e){fail(e);}
  });
  $('libraryMonitor').addEventListener('change',async()=>{
    try{await syncCommand('CAE_LIBRARY_JOB_MONITOR',{accountId:libraryAccount(),enabled:$('libraryMonitor').checked});await refreshLibraryState();}catch(e){fail(e);refreshLibraryControls();}
  });
  $('libraryArchive').addEventListener('click',archiveLibrarySelection);
  $('libraryClear').addEventListener('click',()=>{state.librarySelected.clear();$('librarySelectAll').checked=false;renderLibrary();});
  $('librarySelectAll').addEventListener('change',()=>{
    for(const f of libraryVisible.filter(libraryEligible))$('librarySelectAll').checked?state.librarySelected.add(f.id):state.librarySelected.delete(f.id);
    renderLibrary();
  });
  let libraryStatusTimer=null;
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes['cae.library-status.v1']?.newValue?.account_id===libraryAccount()){
      clearTimeout(libraryStatusTimer);libraryStatusTimer=setTimeout(()=>refreshLibraryState().catch(fail),200);
    }
  });
  $('downloadLibraryCatalog').addEventListener('click', downloadLibrary);
  $('librarySearch').addEventListener('input', renderLibrary);
  $('libraryContextFilter').addEventListener('change', renderLibrary);
  $('pickFolder').addEventListener('click', () => selectFolder().catch(fail));
  $('authorizeVault').addEventListener('click', () => grantVaultAccess().catch(fail));
  for(const id of ['outputDownload','outputFolder'])$(id).addEventListener('change',refreshButtons);
  $('reconnect').addEventListener('click', () => reconnect({force:true}).catch(fail));
  $('loadAll').addEventListener('click',()=>{if(SURFACE!=='panel')openPanel('all',true);else{mode('all');ensureListLoaded(true);}});
  $('exportCurrent').addEventListener('click', () => currentChat());
  $('exportSelected').addEventListener('click', () => exportChats(state.chats.filter(c => state.selected.has(c.id))));
  $('snapshotSettings').addEventListener('click',()=>snapshotSettings().catch(fail));
  $('search').addEventListener('input', renderChats);
  $('selectAll').addEventListener('change', e => {
    for (const item of filteredChats()) e.target.checked ? state.selected.add(item.id) : state.selected.delete(item.id);
    renderChats();
  });
  $('clearSelection').addEventListener('click', () => { state.selected.clear();state.selectedProjects.clear(); renderChats(); });
  $('cancel').addEventListener('click', async () => {
    if(!manualJob?.active)return;
    try { showManual(await syncCommand('CAE_MANUAL_CANCEL',{jobId:manualJob.id})); } catch(e){fail(e);}
  });
  $('retryManual').addEventListener('click', async()=>{
    if(!manualJob?.active)return;
    try{showManual(await syncCommand('CAE_MANUAL_RETRY',{jobId:manualJob.id}));}catch(e){fail(e);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes['cae.manual-status.v1'])refreshManual().catch(()=>{});
  });
  refreshManual().catch(e=>log('Manual export controller unavailable: '+e.message));
  setPanelModeFromSession().catch(()=>{});
  restoreFolder().catch(fail);
  updateSyncApply();
  restoreVerifiedWorkspace().catch(error=>log('WARNING: Workspace view was not restored: '+error.message))
    .finally(()=>reconnect({auto:true}).catch(fail));

  for(const [id,view] of [['navExport','export'],['navActivity','activity'],['navSettings','settings'],['openTools','tools'],['openSettings','settings']])$(id).addEventListener('click',()=>route(view));
  $('toolsBack').addEventListener('click',()=>{
    if(SURFACE==='options'){
      chrome.tabs.getCurrent?.().then(t=>t?.id?chrome.tabs.remove(t.id):window.close()).catch(()=>window.close());
    }else route(previousView);
  });
  $('quickVault').addEventListener('click',()=>currentChat('vault'));
  $('currentSelect').addEventListener('change',refreshButtons);
  $('openChats').addEventListener('click',()=>openPanel('all'));$('openFiles').addEventListener('click',()=>openPanel('library'));
  $('openMonitor').addEventListener('click',()=>openPanel('monitor'));$('modeMonitor').addEventListener('click',()=>route('activity'));
  $('openStableSettings').addEventListener('click',()=>openOptions('settings'));
  for(const id of ['headerReconnect','toolsReconnectVault'])$(id).addEventListener('click',()=>grantVaultAccess().catch(fail));
  for(const id of ['themeSelect','autoClosePanel','widgetEnabled','libraryMonitorOnStart'])$(id).addEventListener('change',()=>savePreferences().catch(fail));
  for(const id of ['chatContainer','chatArchived'])$(id).addEventListener('change',renderChats);
  for(const id of ['libraryOrigin','libraryMedia','libraryArchiveFilter'])$(id).addEventListener('change',renderLibrary);
  $('keepPanelOpen').addEventListener('change',uiRefresh);
  $('refreshStatus').addEventListener('click',()=>Promise.all([refreshManual(),refreshSync(),refreshVaultStatus(),refreshLibraryState(true)]).then(()=>status('Cached job and Vault status refreshed. No inventory scan.')).catch(fail));
  $('showWidget').addEventListener('click',()=>syncCommand('CAE_UI_TOGGLE_WIDGET',{tabId:state.tab?.id})
    .then(r=>status(r?.shown?'Widget shown. Click again to hide it.':'Widget hidden.'))
    .catch(fail));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes[U.KEY]){prefs=U.preferences(changes[U.KEY].newValue);applyPreferences();}
    if(area==='session'&&SURFACE==='panel'&&changes['cae.ui.intent.'+uiWindowId])consumeIntent(changes['cae.ui.intent.'+uiWindowId].newValue);
  });
  chrome.storage.local.get(U.KEY).then(r=>{prefs=U.preferences(r[U.KEY]);applyPreferences();}).catch(()=>{});
  if(['settings','tools','activity'].includes(location.hash.slice(1))&&SURFACE!=='panel')uiView=location.hash.slice(1);
  applyModeView(state.mode);
})();
