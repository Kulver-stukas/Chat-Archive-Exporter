(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    port: null, tab: null, scope: null, mode: 'current', directory: null,
    chats: [], projects: [], selected: new Set(), selectedProjects:new Set(), collapsed: new Set(), requests: new Map(), nextId: 1,
    busy: false, cancel: false, warnings: [], sync: null, syncLoaded: false, syncAccountId: null,
    lastVerifiedWorkspace: null,
    connecting: null, listLoading: null, listAccountId: null, listLoadedAt: 0,
    nextAutoAttempt: 0, autoFailures: 0, reconnectTimer: null,
    vaultPermission: 'unknown',
  };
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
  function status(message) { $('status').textContent = message; }
  function log(message) {
    $('log').classList.remove('hidden');
    $('log').textContent = ($('log').textContent + `[${new Date().toLocaleTimeString()}] ${message}\n`).slice(-120000);
    $('log').scrollTop = $('log').scrollHeight;
  }
  function fail(error) { status(error?.message || String(error)); log('ERROR: ' + (error?.message || error)); }
  function markBusy(value) {
    state.busy = value;
    for (const id of ['loadAll', 'exportCurrent', 'exportSelected', 'pickFolder', 'snapshotSettings', 'reconnect', 'modeCurrent', 'modeAll', 'outputDownload', 'outputFolder', 'authorizeVault', 'clearSelection', 'selectAll', 'search','syncApply','syncEnabled','syncScope','syncEnrollment','syncSources']) $(id).disabled = value;
    $('cancel').classList.toggle('hidden', !value);
    for (const el of $('groupList').querySelectorAll('input, button')) el.disabled = value;
    if (!value) { refreshButtons(); updateSyncApply(); scheduleReconnect(150); }
  }
  function refreshButtons() {
    $('exportCurrent').disabled = state.busy || !state.port || !state.scope?.currentId;
    $('exportSelected').disabled = state.busy || !state.port || !(state.selected.size||state.selectedProjects.size);
    $('snapshotSettings').disabled = state.busy || !state.port || !state.scope?.observed;
    $('selectedCount').textContent = `${state.selected.size} chats + ${state.selectedProjects.size} empty projects selected`;
    $('currentTitle').textContent = state.scope?.currentId
      ? `Conversation: ${state.scope.currentId}`
      : 'Open a conversation on chatgpt.com/c/… to export it.';
  }
  function mode(name) {
    if (state.busy) return;
    state.mode = name;
    $('modeCurrent').classList.toggle('selected', name === 'current');
    $('modeAll').classList.toggle('selected', name === 'all');
    $('currentSection').classList.toggle('hidden', name !== 'current');
    $('allSection').classList.toggle('hidden', name !== 'all');
    refreshButtons();
    if (name === 'all') ensureListLoaded().catch(error => { if (!state.busy) fail(error); });
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    const scope = await call('CAE_STATUS', {}, null, 12000);
    if(state.port!==activePort)return null; // A tab change may invalidate an in-flight reply.
    if (state.scope?.accountId && scope.accountId && state.scope.accountId !== scope.accountId) {
      state.chats = []; state.selected.clear();state.selectedProjects.clear(); state.listAccountId = null; state.listLoadedAt = 0;
      state.sync = null; state.syncLoaded = false; renderChats();
      log('Workspace changed. Previous chat selection cleared.');
    }
    state.scope = scope;
    rememberVerifiedWorkspace(scope,tab);
    // A workspace can have its own already-authorized Vault binding. It wins
    // over the globally last-chosen folder when returning to that workspace.
    try {
      const bound = await ChatArchiveVault.restoreWorkspaceDirectory(scope.accountId);
      if (bound) state.directory = bound;
      await refreshVaultStatus();
    } catch (error) { log('WARNING: Workspace Vault status: ' + error.message); }
    $('scope').textContent = `${scope.display} · ${scope.accountId ? scope.accountId.slice(0, 8) : 'account not identified'}`;
    refreshButtons();
    if(manualJob?.active)showManual(manualJob);else status('Connected.');
    await refreshSync().catch(error => log('WARNING: Background status unavailable: ' + error.message));
    if (state.mode === 'all'&&!manualJob?.active) ensureListLoaded().catch(error => log('WARNING: Could not load conversations: ' + error.message));
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
  function scheduleReconnect(delay = 250) {
    if (state.busy && !manualJob?.active) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      reconnect({auto:true}).catch(() => {});
    }, delay);
  }
  function filteredChats() {
    const query = $('search').value.toLocaleLowerCase().trim();
    if (!query) return state.chats;
    return state.chats.filter(c => `${c.title} ${c.project || ''} ${c.gptName || ''}`.toLocaleLowerCase().includes(query));
  }
  function refreshSelectionUi() {
    const visible = filteredChats();
    const selectedVisible = visible.filter(c => state.selected.has(c.id)).length;
    $('selectAll').checked = visible.length > 0 && selectedVisible === visible.length;
    $('selectAll').indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    $('selectAll').disabled = !visible.length;
    refreshButtons();
  }
  function renderChats() {
    const container = $('groupList');
    container.replaceChildren();
    const visible = filteredChats();
    const groups = new Map();
    for (const chat of visible) {
      const legacyGPT=ChatArchivePaths.isGPT(chat.projectId)?chat.projectId:'';
      const gid=ChatArchivePaths.gptId(chat.gptId||legacyGPT);
      const pid=ChatArchivePaths.isProject(chat.projectId)?ChatArchivePaths.canonical(chat.projectId):'';
      const key=pid?'project:'+pid:gid?'gpt:'+gid:'__unassigned';
      if (!groups.has(key)) groups.set(key, {name:pid?'Project · '+(chat.project||'Project ['+pid.slice(-8)+']'):
        gid?'GPT · '+ChatArchivePaths.gptLabel(gid,chat.gptName):'Without project',entries:[]});
      groups.get(key).entries.push(chat);
    }
    // Empty Projects are first-class archive objects. GPTs are NOT Projects.
    for(const project of state.projects){
      if(!ChatArchivePaths.isProject(project.id))continue;
      const key='project:'+ChatArchivePaths.canonical(project.id);
      if(!groups.has(key))groups.set(key,{name:'Project · '+(project.name||'Unnamed project'),entries:[],emptyProjectId:project.id});
    }
    // Newest active group first, empty Projects last.
    const order = [...groups.entries()].sort(ChatArchiveSort.compareGroups);
    if (!visible.length && !groups.size) {
      const empty = document.createElement('p');
      empty.className = 'hint'; empty.style.padding = '10px';
      empty.textContent = state.chats.length ? 'No matching conversations.' : 'No conversations loaded.';
      container.append(empty);
    }
    for (const [key, group] of order) {
      group.entries.sort(ChatArchiveSort.compareChats);
      const wrapper = document.createElement('div'); wrapper.className = 'group';
      const header = document.createElement('div'); header.className = 'group-head';
      const toggle = document.createElement('button'); toggle.className = 'group-toggle';
      toggle.textContent = state.collapsed.has(key) ? '▸' : '▾'; toggle.title = 'Expand or collapse';
      const groupBox = document.createElement('input'); groupBox.type = 'checkbox';
      groupBox.title = 'Select all chats in this group';
      const selectedCount = group.entries.filter(item => state.selected.has(item.id)).length;
      groupBox.checked = group.emptyProjectId ? state.selectedProjects.has(group.emptyProjectId) : selectedCount === group.entries.length;
      groupBox.indeterminate = !group.emptyProjectId && selectedCount > 0 && selectedCount < group.entries.length;
      groupBox.addEventListener('change', () => {
        if(group.emptyProjectId){groupBox.checked ? state.selectedProjects.add(group.emptyProjectId) : state.selectedProjects.delete(group.emptyProjectId);}
        else for (const entry of group.entries) groupBox.checked ? state.selected.add(entry.id) : state.selected.delete(entry.id);
        renderChats();
      });
      const name = document.createElement('span'); name.className = 'group-name'; name.textContent = `▣ ${group.name}`;
      const count = document.createElement('span'); count.className = 'group-count'; count.textContent = String(group.entries.length);
      header.append(toggle, groupBox, name, count); wrapper.append(header);
      const body = document.createElement('div');
      body.classList.toggle('hidden', state.collapsed.has(key));
      if(group.emptyProjectId){const hint=document.createElement('p');hint.className='hint';
        hint.textContent='No conversations. Select the Project to export its configuration and Sources.';
        body.append(hint);}

      toggle.addEventListener('click', () => { state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key); renderChats(); });
      for (const entry of group.entries) {
        const row = document.createElement('label'); row.className = 'chat-row';
        const box = document.createElement('input'); box.type = 'checkbox'; box.checked = state.selected.has(entry.id);
        box.addEventListener('change', () => { box.checked ? state.selected.add(entry.id) : state.selected.delete(entry.id); renderChats(); });
        const title = document.createElement('span'); title.className = 'chat-text'; title.textContent = entry.title;
        row.append(box, title);
        if (entry.archived) {
          const archive = document.createElement('span'); archive.className = 'archived'; archive.textContent = 'archived'; row.append(archive);
        }
        body.append(row);
      }
      wrapper.append(body); container.append(wrapper);
    }
    refreshSelectionUi();
  }
  async function loadList() {
    markBusy(true);
    try {
      if (!state.scope) await reconnect({auto:true});
      if (!state.scope) throw new Error('Open an active ChatGPT tab to load conversations.');
      status('Loading conversations…');
      const data = await call('CAE_LIST', {}, p => status(p.detail));
      state.scope = data.scope;
      state.warnings = data.warnings || [];
      state.chats = data.items;
      state.projects = data.projects || [];
      state.listAccountId = data.scope.accountId;
      state.listLoadedAt = Date.now();
      state.selected.clear();state.selectedProjects.clear();
      state.collapsed.clear();
      $('scope').textContent = `${data.scope.display} · ${data.scope.accountId?.slice(0, 8) || 'unknown account'}`;
      $('listSummary').textContent = `${data.items.length} chats in ${data.projects.length} projects. ${data.warnings.length ? `Warnings: ${data.warnings.length}` : ''}`;
      for (const warning of data.warnings) log('WARNING: ' + warning);
      renderChats();
      status(`Loaded ${data.items.length} conversations.`);
    } catch (error) { fail(error); }
    finally { markBusy(!!manualJob?.active);if(manualJob?.active)showManual(manualJob); }
  }
  function ensureListLoaded(force = false) {
    if(manualJob?.active)return Promise.resolve();
    if (state.listLoading) return state.listLoading;
    if (!force && state.scope?.accountId && state.listAccountId === state.scope.accountId &&
        Date.now() - state.listLoadedAt < LIST_MAX_AGE_MS) return Promise.resolve();
    const p = loadList().finally(() => { if (state.listLoading === p) state.listLoading = null; });
    state.listLoading = p;
    return p;
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
      button.classList.toggle('hidden',!['prompt','denied'].includes(permission.state)||(!state.sync?.enabled&&!manualNeedsAccess));
      if(manualNeedsAccess)button.disabled=false;
      notifyPanelPermission(permission.state);
      if(permission.state==='granted'&&state.sync?.enabled){
        await retainGrantedVault(previous!=='granted').catch(error=>
          log('WARNING: Could not confirm Vault handle retention: '+error.message));
      }
    })().finally(()=>{
      if(vaultStatusRun===operation)vaultStatusRun=null;
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
    if (state.sync?.enabled) throw new Error('Pause background update before changing the Vault for this workspace.');
    if (typeof window.showDirectoryPicker !== 'function')
      throw new Error('Directory picker unavailable. Use Chrome with File System Access support.');
    // Picker must be invoked directly from the click gesture, before other awaits.
    const dir = await window.showDirectoryPicker({ id: 'chat-archive-exporter-vault', mode: 'readwrite' });
    state.directory = dir;
    try { await ChatArchiveVault.rememberDirectory(dir); }
    catch (e) { log('WARNING: This Vault can be used now, but its folder handle could not be remembered: ' + e.message); }
    await refreshVaultStatus();
    status('Vault selected. Existing files and indexes will be reused.');
  }
  async function grantVaultAccess() {
    if (!state.directory) throw new Error('Choose a Vault directory first.');
    if (!(await ChatArchiveVault.hasPermission(state.directory, true)))
      throw new Error('Vault write permission was not granted.');
    await refreshVaultStatus();
    if(state.sync?.enabled)await retainGrantedVault();
    await syncCommand('CAE_MANUAL_WAKE',{accountId:state.scope?.accountId}).catch(()=>{});
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
    if (!j) return;
    if(j.active&&j.destination==='vault'&&j.accountId===state.scope?.accountId)restoreManualBinding(j).then(()=>refreshVaultStatus()).catch(e=>log('Could not restore manual Vault binding: '+e.message));
    const busy = !!j.active;
    if(busy){
      // Reopening is a view of the accepted job, not a fresh default form.
      $('outputFolder').checked=j.destination==='vault';
      $('outputDownload').checked=j.destination!=='vault';
      $('folderControls').classList.toggle('hidden',j.destination!=='vault');
      state.mode=j.mode;
      $('modeCurrent').classList.toggle('selected',j.mode==='current');
      $('modeAll').classList.toggle('selected',j.mode==='all');
      $('currentSection').classList.toggle('hidden',j.mode!=='current');
      $('allSection').classList.toggle('hidden',j.mode!=='all');
    }
    if (state.busy !== busy && !state.listLoading) markBusy(busy);
    $('progress').classList.remove('hidden');
    const sourcePhase = j.phase === 'sources';
    $('progress').max = Math.max(1, sourcePhase ? j.totalSources : j.totalChats);
    $('progress').value = sourcePhase ? j.sourcesDone : j.chatsDone;
    const word = j.destination === 'vault' ? 'saved' : 'prepared';
    status(`${j.status} - ${j.workspace} - ${j.message || ''}` +
      ` Chats: ${j.counts.saved} ${word}, ${j.counts.skipped} skipped, ${j.counts.failed} failed.` +
      (j.counts.conflict ? ` ${j.counts.conflict} local conflicts preserved.` : '') +
      (j.sources ? ` Sources: ${j.sources.saved} ${word}, ${j.sources.skipped} skipped, ${j.sources.failed} failed.` : ''));
    $('cancel').classList.toggle('hidden', !busy);
    $('cancel').disabled = !!j.cancelRequested;
    $('retryManual').classList.toggle('hidden', !['download_failed','delivery_uncertain','storage_error','error'].includes(j.status));
    $('manualHint').textContent = busy
      ? 'Accepted job runs independently. You may close this panel. A live ChatGPT tab in the original workspace is needed for pending downloads from ChatGPT.'
      : (j.destination === 'download' && j.status.startsWith('completed') ? 'Browser download completed.' : 'No manual job is running.');
    if (j.logs?.length) {
      $('log').classList.remove('hidden');
      $('log').textContent = j.logs.map(x=>`[${new Date(x.at).toLocaleTimeString()}] ${x.level}: ${x.message}`).join('\n');
      $('log').scrollTop = $('log').scrollHeight;
    }
  }
  function refreshManual() {
    if (manualRefresh) return manualRefresh;
    const p = syncCommand('CAE_MANUAL_STATUS').then(j => { if (!manualSubmitting) showManual(j); }).finally(()=>{if(manualRefresh===p)manualRefresh=null;});
    manualRefresh=p;return p;
  }
  async function exportChats(items) {
    if (state.busy || manualSubmitting) return;
    if (!items.length&&!state.selectedProjects.size) { status('No conversations or Projects selected.'); return; }
    if (!state.scope?.observed || !state.scope?.accountId) { status('Connect to a verified workspace first.'); return; }
    manualSubmitting=true;markBusy(true);
    const destination=$('outputFolder').checked?'vault':'download';
    const requestId=crypto.randomUUID();
    try {
      // Permission comes from this user action; never from a hidden controller.
      if (destination==='vault') {
        if (!state.directory) throw new Error('Choose a Vault first.');
        if (!(await ChatArchiveVault.hasPermission(state.directory,true))) throw new Error('Vault write permission required.');
        await ChatArchiveManualStore.bind(requestId,state.directory);
      }
      const j=await syncCommand('CAE_MANUAL_SUBMIT',{options:{requestId,
        accountId:state.scope.accountId,display:state.scope.display,tabId:state.tab.id,
        destination,mode:state.mode,items:items.map(x=>({...x})),projects:state.projects,
        selectedProjectIds:[...state.selectedProjects],
        fullWorkspace:state.mode==='all'&&state.chats.length>0&&items.length===state.chats.length}});
      showManual(j);
    }catch(e){fail(e);markBusy(false);}
    finally{manualSubmitting=false;refreshManual().catch(()=>{});}
  }


  async function snapshotSettings(){
    if(state.busy||manualSubmitting)return;
    if(!state.scope?.observed||!state.scope.accountId||!state.tab?.id)
      throw Error('Activate the confirmed ChatGPT workspace first.');
    if(!state.directory)throw Error('Choose the existing Vault first.');
    manualSubmitting=true;markBusy(true);
    const requestId=crypto.randomUUID();
    try{
      if(!(await ChatArchiveVault.hasPermission(state.directory,true)))
        throw Error('Vault write permission is required.');
      await ChatArchiveManualStore.bind(requestId,state.directory);
      const j=await syncCommand('CAE_MANUAL_SUBMIT',{options:{requestId,
        accountId:state.scope.accountId,display:state.scope.display,tabId:state.tab.id,
        destination:'vault',mode:'configuration',items:[],projects:[],fullWorkspace:true}});
      showManual(j);
    }catch(e){fail(e);markBusy(false);}
    finally{manualSubmitting=false;refreshManual().catch(()=>{});}
  }

  async function currentChat() {
    if (state.busy || !$('exportCurrent') || $('exportCurrent').disabled) return;
    if (!state.scope?.currentId) { status('Open a ChatGPT conversation first.'); return; }
    const item=state.chats.find(c=>c.id===state.scope.currentId)||{id:state.scope.currentId,title:'Current chat',project:'',projectId:''};
    await exportChats([item]);
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
    $('syncPause').disabled=state.busy||!editable||!enabled;
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
    updateSyncApply();
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
    state.nextAutoAttempt=0;state.autoFailures=0;scheduleReconnect();
  });
  chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{
    if (tab.active&&(change.url||change.status==='complete')) {
      state.nextAutoAttempt=0;state.autoFailures=0;scheduleReconnect(350);
    }
  });
  chrome.windows?.onFocusChanged?.addListener(windowId=>{
    if(windowId!==chrome.windows.WINDOW_ID_NONE) scheduleReconnect(350);
  });

  function setPanelModeFromSession() {
    chrome.storage.session.get({ caeInitialMode: 'current' }, result => {
      if (result.caeInitialMode === 'all') mode('all');
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.caeInitialMode && ['current', 'all'].includes(changes.caeInitialMode.newValue)) {
      mode(changes.caeInitialMode.newValue);
    }
  });
  $('modeCurrent').addEventListener('click', () => mode('current'));
  $('modeAll').addEventListener('click', () => mode('all'));
  $('pickFolder').addEventListener('click', () => selectFolder().catch(fail));
  $('authorizeVault').addEventListener('click', () => grantVaultAccess().catch(fail));
  for (const id of ['outputDownload', 'outputFolder']) $(id).addEventListener('change', () => $('folderControls').classList.toggle('hidden', !$('outputFolder').checked));
  $('reconnect').addEventListener('click', () => reconnect({force:true}).catch(fail));
  $('loadAll').addEventListener('click', () => ensureListLoaded(true));
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
  setPanelModeFromSession();
  restoreFolder().catch(fail);
  updateSyncApply();
  restoreVerifiedWorkspace().catch(error=>log('WARNING: Workspace view was not restored: '+error.message))
    .finally(()=>reconnect({auto:true}).catch(fail));
})();
