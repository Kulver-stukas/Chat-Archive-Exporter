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
    library: null, libraryAccountId: null, libraryLoadedAt: 0, libraryLoading: null,
    libraryJob: null, librarySelected: new Set(), libraryCatalogRevision: -1, libraryRefresh: null, librarySubmitting: false,
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
    for (const id of ['refreshLibrary', 'downloadLibraryCatalog', 'librarySearch', 'libraryContextFilter', 'modeLibrary', 'loadAll', 'exportCurrent', 'exportSelected', 'pickFolder', 'snapshotSettings', 'reconnect', 'modeCurrent', 'modeAll', 'outputDownload', 'outputFolder', 'authorizeVault', 'clearSelection', 'selectAll', 'search','syncApply','syncEnabled','syncScope','syncEnrollment','syncSources']) $(id).disabled = value;
    $('cancel').classList.toggle('hidden', !value || state.mode === 'library');
    for (const el of $('groupList').querySelectorAll('input, button')) el.disabled = value;
    if (!value) { refreshButtons(); updateSyncApply(); scheduleReconnect(150); }
  }
  function refreshButtons() {
    $('exportCurrent').disabled = state.busy || !state.port || !state.scope?.currentId;
    $('exportSelected').disabled = state.busy || !state.port || !(state.selected.size||state.selectedProjects.size);
    $('snapshotSettings').disabled = state.busy || !state.port || !state.scope?.observed;
    $('refreshLibrary').disabled = state.busy || state.librarySubmitting || !!state.libraryJob?.job?.active || !state.port || !state.scope?.observed;
    $('downloadLibraryCatalog').disabled = !state.library || state.libraryAccountId !== libraryAccount();
    refreshLibraryControls();
    $('selectedCount').textContent = `${state.selected.size} chats + ${state.selectedProjects.size} empty projects selected`;
    $('currentTitle').textContent = state.scope?.currentId
      ? `Conversation: ${state.scope.currentId}`
      : 'Open a conversation on chatgpt.com/c/… to export it.';
  }
  function applyModeView(name) {
    for (const [id,value] of [['modeCurrent','current'],['modeAll','all'],['modeLibrary','library']])
      $(id).classList.toggle('selected',name===value);
    $('currentSection').classList.toggle('hidden',name!=='current');
    $('allSection').classList.toggle('hidden',name!=='all');
    $('librarySection').classList.toggle('hidden',name!=='library');
    // Chat export output and background settings are not Library operations.
    $('folderSection').classList.toggle('hidden',name==='library');
    $('syncSection').classList.toggle('hidden',name==='library');
    if(!manualJob?.active) $('manualHint').textContent=name==='library'
      ? 'Library jobs run independently of this panel. Start manually; use Stop / pause to stop collection. Originals are opt-in only.'
      : 'Manual exports continue after this panel closes.';
  }
  function mode(name) {
    if (state.busy || !['current','all','library'].includes(name)) return;
    state.mode = name;
    applyModeView(name);
    refreshButtons();
    if (name === 'all') ensureListLoaded().catch(error => { if (!state.busy) fail(error); });
    if (name === 'library') refreshLibraryState(true).catch(fail);
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
      state.library=null; state.libraryAccountId=null; state.libraryLoadedAt=0; state.libraryJob=null; state.librarySelected.clear(); state.libraryCatalogRevision=-1; renderLibrary();
      log('Workspace changed. Previous chat selection cleared.');
    }
    if(state.libraryAccountId && state.libraryAccountId!==scope.accountId){
      state.library=null;state.libraryAccountId=null;state.libraryJob=null;state.librarySelected.clear();state.libraryCatalogRevision=-1;
    }
    state.scope = scope;
    if(state.mode==='library')renderLibrary();
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
    if (state.mode === 'library') refreshLibraryState(true).catch(error => log('WARNING: Could not read saved Library state: ' + error.message));
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
  function renderLibrary() {
    const target=$('libraryGroups');target.replaceChildren();
    const catalog=state.libraryAccountId===libraryAccount()?state.library:null;
    if(!catalog){
      $('librarySummary').textContent='No saved inventory for this workspace. Choose a Vault, then Start inventory.';
      $('libraryCount').textContent='No inventory loaded.';
      $('libraryWarnings').classList.add('hidden');refreshButtons();return;
    }
    const summary=catalog.summary||{};
    const parts=[`${summary.total||0} distinct files`,`Library: ${summary.library_files||0}`,`Images: ${summary.images_gallery||0}`,
      `not in Library: ${summary.image_only||0}`,`Project Sources: ${summary.by_context?.project_source||0}`,
      `folders: ${summary.folders||0}`,`listing: ${catalog.status||'unknown'}`,
      `descriptors: ${catalog.classification_status||'unknown'}`,`origins classified: ${summary.classified??0}/${summary.total||0}`,`Sources excluded: ${summary.project_source_excluded||0}`];
    $('librarySummary').textContent=parts.join(' · ')+'.';
    const needle=$('librarySearch').value.trim().toLocaleLowerCase();
    const context=$('libraryContextFilter').value;
    const filtered=(catalog.items||[]).filter(x=>{
      if(context!=='all' && !(x.contexts||[]).includes(context))return false;
      return !needle || [x.name,x.mime_type,x.format_class,...(x.library_locations||[]).map(y=>y.folder_path),
        ...(x.placements||[]).flatMap(p=>[p.project_name,p.type,p.conversation_id])]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
    });
    const groupDefs=[['uploaded','image','Uploaded · Images'],['uploaded','file','Uploaded · Other files'],
      ['generated','image','Generated · Images'],['generated','file','Generated · Other files'],
      ['unknown','image','Unknown origin · Images'],['unknown','file','Unknown origin · Other files']];
    for(const [origin,media,title] of groupDefs){
      const files=filtered.filter(x=>x.origin===origin&&x.media_class===media);
      if(!files.length)continue;
      const section=document.createElement('section');section.className='group';
      const head=document.createElement('div');head.className='group-head';
      const label=document.createElement('span');label.className='group-name';label.textContent=title;
      const count=document.createElement('span');count.className='group-count';count.textContent=String(files.length);
      head.append(label,count);section.append(head);
      for(const f of files){
        const row=document.createElement('div');row.className='library-row';
        const eligible=f.archive_eligibility?.selectable&&!f.managed_by_project_sources;
        if(eligible){
          const box=document.createElement('input');box.type='checkbox';box.className='library-file-checkbox';
          box.dataset.fileId=f.id;box.dataset.archived=String(['saved','already_archived'].includes(f.archive?.status));box.setAttribute('aria-label','Archive '+(f.name||f.id));box.title=f.archive_eligibility.reason;
          box.checked=state.librarySelected.has(f.id);
          box.disabled=!!state.libraryJob?.job?.active||['saved','already_archived'].includes(f.archive?.status);
          box.addEventListener('change',()=>{box.checked?state.librarySelected.add(f.id):state.librarySelected.delete(f.id);refreshLibraryControls();});
          row.append(box);
        }
        const titleSpan=document.createElement('span');titleSpan.className='chat-text';titleSpan.textContent=f.name || f.id;
        const note=document.createElement('span');note.className='library-note';
        note.textContent=[f.format_class,f.origin_status!=='confirmed'?f.origin_status:null,
          f.managed_by_project_sources?'Excluded: managed by Project Sources':null,
          f.archive?`Archive: ${f.archive.status}${f.archive.http_status?' (HTTP '+f.archive.http_status+')':''}`:null,
          ...(f.placements||[]).filter(p=>p.type==='project_source').map(p=>`Project Source: ${p.project_name}`),
          f.library_locations?.[0]?.folder_path ? `Library: ${f.library_locations[0].folder_path}` : null,
          f.contexts?.includes('conversation_message') ? 'Conversation reference (role unknown)' : null,
          f.sources?.includes('library')&&f.sources?.includes('images')?'Library + Images':null].filter(Boolean).join(' · ');
        row.append(titleSpan,note);section.append(row);
      }
      target.append(section);
    }
    if(!filtered.length){const p=document.createElement('p');p.className='hint';p.style.padding='8px';p.textContent='No matching files.';target.append(p);}
    $('libraryCount').textContent=`Showing ${filtered.length} of ${catalog.items.length} distinct files`;
    const warnings=catalog.warnings||[];
    $('libraryWarnings').textContent=warnings.join('\n');
    $('libraryWarnings').classList.toggle('hidden',!warnings.length);
    refreshButtons();
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
    $('librarySelectedCount').textContent=`${state.librarySelected.size} selected`;
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
    try{
      if(!state.scope?.observed||!state.scope.accountId||!state.tab?.id)throw Error('Connect the active ChatGPT workspace first.');
      if(!state.directory)throw Error('Choose a Vault first.');
      // Directly initiated by the click; no permission request from a timer.
      if(!(await ChatArchiveVault.hasPermission(state.directory,true)))throw Error('Vault write access is required.');
      const account=state.scope.accountId;
      state.librarySubmitting=true;refreshButtons();
      await ChatArchiveLibraryStore.bind(account,state.directory);
      await ChatArchiveVault.rememberWorkspaceDirectory(account,state.directory);
      state.libraryJob=await syncCommand('CAE_LIBRARY_JOB_START',{options:{accountId:account,display:state.scope.display,
        tabId:state.tab.id,monitor:$('libraryMonitorOnStart').checked}});
      status('Library inventory accepted. You may switch sections or close this panel.');
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
    if (state.sync?.enabled || state.libraryJob?.enabled || state.libraryJob?.job?.active) throw new Error('Pause background updates and Library jobs before changing the Vault.');
    if (typeof window.showDirectoryPicker !== 'function')
      throw new Error('Directory picker unavailable. Use Chrome with File System Access support.');
    // Picker must be invoked directly from the click gesture, before other awaits.
    const dir = await window.showDirectoryPicker({ id: 'chat-archive-exporter-vault', mode: 'readwrite' });
    state.directory = dir;
    try { await ChatArchiveVault.rememberDirectory(dir); }
    catch (e) { log('WARNING: This Vault can be used now, but its folder handle could not be remembered: ' + e.message); }
    await refreshVaultStatus();refreshLibraryControls();
    status('Vault selected. Existing files and indexes will be reused.');
  }
  async function grantVaultAccess() {
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
    if (!j) return;
    if(j.active&&j.destination==='vault'&&j.accountId===state.scope?.accountId)restoreManualBinding(j).then(()=>refreshVaultStatus()).catch(e=>log('Could not restore manual Vault binding: '+e.message));
    const busy = !!j.active;
    if(busy){
      // Reopening is a view of the accepted job, not a fresh default form.
      $('outputFolder').checked=j.destination==='vault';
      $('outputDownload').checked=j.destination!=='vault';
      $('folderControls').classList.toggle('hidden',j.destination!=='vault');
      state.mode=j.mode;
      applyModeView(j.mode);
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
    for(const box of $('libraryGroups').querySelectorAll('.library-file-checkbox:not(:disabled)')){
      box.checked=$('librarySelectAll').checked;
      box.checked?state.librarySelected.add(box.dataset.fileId):state.librarySelected.delete(box.dataset.fileId);
    }refreshLibraryControls();
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
