(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    port: null, tab: null, scope: null, mode: 'current', directory: null, currentContextPending:false,
    chats: [], projects: [], selected: new Set(), selectedProjects:new Set(), collapsed: new Set(), requests: new Map(), nextId: 1,
    busy: false, cancel: false, warnings: [], sync: null, syncLoaded: false, syncAccountId: null,
    lastVerifiedWorkspace: null, chatVaultEvidence:null, chatVaultRead:null, chatVaultAt:0, chatVaultAttempt:null,
    connecting: null, listLoading: null, listAccountId: null, listLoadedAt: 0, listCacheLoading: null, listSource: null, listLoadAccount: null,
    nextAutoAttempt: 0, autoFailures: 0, reconnectTimer: null,
    vaultPermission: 'unknown', vaultCandidate:null, lastConnectionCode:null, lastControllerCode:null, lastControllerCommand:null,
    library: null, libraryAccountId: null, libraryLoadedAt: 0, libraryLoading: null,
    libraryJob: null, sharedActivity:null, libraryLoadError:null, librarySelected: new Set(), libraryCatalogRevision: -1, libraryRefresh: null, librarySubmitting: false,
  };

  const SURFACE=document.body.dataset.surface||'panel';
  const U=globalThis.CAEUIState;
  const E=globalThis.ChatArchiveExportSelection;
  const EXPORT_PREFS_KEY='cae.export.preferences.v1';
  const EXPORT_FIELDS=['questions','answers','thinking','uploadedFiles','generatedFiles'];
  const exportDefaults={questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:true};
  const cleanExportPrefs=raw=>E?.preferences?E.preferences(raw):Object.fromEntries(Object.keys(exportDefaults).map(k=>[k,raw?.[k]!==false]));
  let exportPrefs=cleanExportPrefs(),exportPrefsReady=false,exportPrefsPending=0,exportPrefsPromise=null,exportStoredRevision=-1;
  let messageSelection=null,messageSelectorOpen=false,messageSelectionLoading=false,messageLoadGeneration=0,messageLoadBinding=null;
  // Selection follows navigation only within the workspace in which the user opened it.
  const MESSAGE_FOLLOW_DELAY_MS=300;
  let messageAutoAccount=null,messageAutoPending=false,messageAutoTimer=null,contextGeneration=0;
  let uiView=SURFACE==='options'?'settings':'export',prefs=U.preferences(),previousView='export';
  let uiWindowId=null,libraryCollapsed=new Set(),libraryVisible=[],uiIntent=null;
  const sourceTabId=Number(new URLSearchParams(location.search).get('tab'))||null;
  function route(view){
    if(!['export','activity','settings','tools'].includes(view))return;
    // Settings and Tools are local views on every surface, including Side Panel.
    previousView=uiView==='tools'?previousView:uiView;uiView=view;applyModeView(state.mode);
    if(view==='activity'||view==='tools'||view==='settings'){
      refreshManual().catch(fail);refreshSync().catch(fail);refreshLibraryState(true).catch(fail);refreshSharedActivity(true).catch(()=>{});
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
  function openPanel(name,refresh=false,extra={}){
    const windowId=state.tab?.windowId??uiWindowId;
    if(!Number.isInteger(windowId)){status('Activate a browser window and reopen the popup.');return;}
    // Call open in this click handler, before awaits: preserve the user gesture.
    const intent={mode:name,refresh,...extra,at:Date.now(),nonce:crypto.randomUUID()};
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
  function vaultRepairNeeded(){
    const bad=['error','unsupported','denied','no_handle'];
    return bad.includes(state.vaultPermission)||state.vaultPermission==='prompt'||!!state.sync?.enabled&&bad.includes(state.sync?.access?.worker);
  }
  function vaultBindingActive(){return !!(manualJob?.active||state.sync?.enabled||state.libraryJob?.enabled||state.libraryJob?.job?.active);}
  function canReselectVault(){return vaultBindingActive()?!!state.directory&&providers.verified(state.scope)&&!state.currentContextPending&&vaultRepairNeeded():!state.busy;}
  function uiRefresh(){
    const account=libraryAccount();const j=manualJob?.accountId===account?manualJob:null;
    const a=U.activity(j,state.libraryJob,state.sync);
    const saved=state.sharedActivity?.account_id===account?state.sharedActivity.manual:null;
    if(saved&&!j?.active&&(!j||!j.finishedAt||Date.parse(saved.finished_at)>Date.parse(j.finishedAt))){
      $('manualSummary').textContent=saved.summary;
      $('progress').classList.add('hidden');$('cancel').classList.add('hidden');$('retryManual').classList.add('hidden');
      $('manualHint').textContent='Recorded in the shared Vault; no job or download is resumed in this browser.';
      $('log').textContent=saved.summary;$('log').classList.remove('hidden');
    }else if(!j){$('manualSummary').textContent=manualJob?.active?'A local export is running in another workspace.':'No manual export recorded.';
      $('progress').classList.add('hidden');$('cancel').classList.add('hidden');$('retryManual').classList.add('hidden');$('log').textContent='';$('log').classList.add('hidden');
    }
    $('appIcon').src='icons/cae-'+a.icon+'-32.png';$('appIcon').alt=a.label;
    $('overallStatus').textContent=!state.syncLoaded&&!a.busy?'Monitoring status unavailable':a.label;
    // A permission check in a newly opened UI document may return 'prompt'
    // even while the background/offscreen writer still has a valid grant.
    // Never describe that as Vault disconnection, or derive it from a canceled Save.
    const bg=state.sync?.enabled&&state.sync?.access?.worker==='granted'&&state.sync?.access?.offscreen==='granted';
    const permission={granted:'connected',prompt:bg?'background connected; confirm here':'confirmation required here',
      denied:'access denied',no_handle:'not connected',unsupported:'permission check unavailable',
      error:'permission check unavailable',unknown:'checking access'};
    const selected=state.directory||state.vaultCandidate,verified=providers.verified(state.scope)&&!state.currentContextPending;
    $('vaultBadge').textContent=selected?'Vault: '+selected.name+' - '+(!verified?'verify workspace first':state.directory?permission[state.vaultPermission]||'checking access':'connect to this workspace'):'Vault not selected';
    $('headerReconnect').classList.toggle('hidden',!selected||verified&&!!state.directory&&state.vaultPermission==='granted'&&!vaultRepairNeeded());
    $('headerReconnect').textContent=state.directory?'Reconnect Vault':'Connect Vault';
    $('headerReconnect').disabled=!verified;
    $('reconnect').classList.toggle('required-action',!verified);
    $('toolsReconnectVault').classList.toggle('required-action',state.vaultPermission!=='granted');
    $('pickFolder').classList.toggle('required-action',!state.directory||vaultRepairNeeded());
    $('headerReconnect').title=verified?'Connect or restore this selected Vault.':'Reconnect ChatGPT first; the workspace must be verified.';
    $('quickVault').disabled=state.busy||state.currentContextPending||!state.port||!state.scope?.observed||!state.scope.currentId||!state.directory;
    $('showWidget').disabled=!state.scope?.observed||!state.tab;
    $('showWidget').textContent='Show / hide widget on this tab';
    $('toolsReconnectVault').disabled=!selected||!verified;
    $('pickFolder').disabled=!canReselectVault();
    $('pickFolder').textContent=state.directory&&vaultBindingActive()&&vaultRepairNeeded()?'Reselect original Vault…':state.directory?'Change Vault…':'Choose Vault…';
    const summary=state.library?.summary;
    $('inventoryBrief').textContent=state.libraryJob?.job?.active?U.humanStatus(state.libraryJob.job)+': '+(state.libraryJob.job.detail||''):
      summary?`${summary.total||0} files in saved inventory. ${summary.selectable??0} originals requestable.`:'No saved inventory. Choose a Vault before starting.';
    $('catalogStamp').textContent=state.library?.captured_at?'Saved catalog: '+new Date(state.library.captured_at).toLocaleString():'No saved catalog for this workspace.';
    $('panelCloseHint').textContent=$('keepPanelOpen').checked||!prefs.autoClosePanel?'Panel stays open for monitoring.':
      typeof chrome.sidePanel?.close==='function'?'Closes after export is accepted.':'Auto-close is unavailable in this Chrome version.';
    $('keepPanelOpen').title=$('panelCloseHint').textContent;
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
    $('widgetEnabled').checked=prefs.widgetEnabled;if(!pendingRestore())$('libraryMonitorOnStart').checked=prefs.monitorOnStart;
    uiRefresh();
  }
  function exportCategoriesSelected(){return EXPORT_FIELDS.some(k=>exportPrefs[k]);}
  function acceptExportPreferences(value){
    const revision=Number.isSafeInteger(value?._revision)&&value._revision>=0?value._revision:0;
    // Events and replies can cross in flight. Only the worker's monotonic
    // revision determines which complete settings snapshot is authoritative.
    if(revision<exportStoredRevision)return false;
    exportStoredRevision=revision;exportPrefs=cleanExportPrefs(value);exportPrefsReady=true;return true;
  }
  function setExportMenu(open,focus=false){
    $('exportContentMenu').classList.toggle('hidden',!open);
    $('exportMenuToggle').setAttribute('aria-expanded',String(open));
    if(open&&focus)$('exportAll').focus();
  }
  function selectorActive(){return SURFACE==='panel'&&!exportPrefs.completeConversation&&messageSelectorOpen;}
  function messageStatus(text='',loading=false){
    const node=$('messageSelectionStatus');node.textContent=text;node.classList.toggle('hidden',!text);
    $('messageLoadProgress').classList.toggle('hidden',!loading);
    $('messageRows').setAttribute('aria-busy',String(loading));
  }
  function selectorVisible(){return selectorActive()&&uiView==='export'&&state.mode==='current';}
  function clearMessageAutoTimer(){clearTimeout(messageAutoTimer);messageAutoTimer=null;}
  function maybeAutoLoadMessages(){
    if(!messageAutoPending||!messageAutoAccount||state.currentContextPending||state.connecting)return;
    if(!state.scope?.observed){if(selectorActive())messageStatus(state.scope?'Workspace not verified. Click Refresh when connected.':'Open a ChatGPT conversation to continue.');return;}
    if(state.scope.accountId!==messageAutoAccount){
      clearMessageAutoTimer();messageAutoPending=false;messageAutoAccount=null;
      if(selectorActive())messageStatus('Workspace changed. Click Refresh to select messages here.');
      return;
    }
    const binding=selectionBinding();
    if(!binding){if(selectorActive())messageStatus('Open a ChatGPT conversation to continue.');return;}
    if(!selectorVisible()||state.busy||messageSelectionLoading||!exportPrefsReady||exportPrefsPending||!state.port)return;
    if(messageAutoTimer!==null)return;
    messageAutoTimer=setTimeout(()=>{
      messageAutoTimer=null;
      if(!messageAutoPending||!selectorVisible()||state.busy||state.connecting||state.currentContextPending||!state.port||
        !exportPrefsReady||exportPrefsPending||!sameSelectionBinding(binding)||binding.accountId!==messageAutoAccount)return;
      messageAutoPending=false;
      loadMessageSelection(binding,{verified:true}).catch(fail);
    },MESSAGE_FOLLOW_DELAY_MS);
  }
  function setDownloadLabels(selectedFiles=null){
    const main=$('exportCurrent'),menu=$('exportMenuToggle');
    const withFiles=exportPrefs.uploadedFiles||exportPrefs.generatedFiles;
    // Do not claim an exact format before the conversation has been read. No
    // extra API request is made simply to populate a button label.
    const label=!exportPrefs.completeConversation?'Select messages':withFiles?'Download':'Download MD';
    const summary=$('exportContentSummary').textContent;
    main.textContent=label;
    main.title=selectorActive()?'Use Download selection below; Refresh reloads the current conversation.':
      !exportPrefs.completeConversation?'Open the message selector. '+summary:
      'Download the complete conversation. '+summary+'. '+(withFiles?'ZIP if original files are included; otherwise .md.':'Markdown (.md).');
    menu.title='Export content settings: '+summary+'. Saved for all tabs.';
    if(selectedFiles!==null){
      $('downloadMessages').textContent=selectedFiles>0?'Download selection as .zip':'Download selection as .md';
      $('downloadMessages').title=selectedFiles>0?`${selectedFiles} file reference(s) selected. ZIP includes Markdown, obtainable originals and a report.`:
        'Download the selected message content as Markdown (.md).';
    }
  }
  function applyExportPreferences(){
    $('currentSelect').checked=exportPrefs.completeConversation;
    const count=EXPORT_FIELDS.filter(k=>exportPrefs[k]).length;
    $('exportAll').checked=count===EXPORT_FIELDS.length;$('exportAll').indeterminate=count>0&&count<EXPORT_FIELDS.length;
    for(const node of document.querySelectorAll('[data-export-field]'))node.checked=exportPrefs[node.dataset.exportField];
    const labels={questions:'Question',answers:'Answers',thinking:'Thinking',uploadedFiles:'Uploaded files',generatedFiles:'Generated files'};
    $('exportContentSummary').textContent=(count===EXPORT_FIELDS.length?'All content':count?EXPORT_FIELDS.filter(k=>exportPrefs[k]).map(k=>labels[k]).join(', '):'No content selected')+
      (exportPrefs.completeConversation?' · Complete conversation':' · Choose messages in the side panel');
    $('messageSelector').classList.toggle('hidden',!selectorActive());
    if(exportPrefs.completeConversation){
      clearMessageAutoTimer();messageAutoPending=false;
      if(messageSelectionLoading)invalidateMessageSelection('');
    }
    setDownloadLabels();
    if(messageSelection)renderMessageSelection();
    refreshButtons();
  }
  async function ensureExportPreferences(){
    if(exportPrefsReady)return exportPrefs;
    if(exportPrefsPromise)return exportPrefsPromise;
    const operation=syncCommand('CAE_EXPORT_PREFS_GET').then(value=>{
      acceptExportPreferences(value);applyExportPreferences();return exportPrefs;
    }).finally(()=>{if(exportPrefsPromise===operation)exportPrefsPromise=null;});
    exportPrefsPromise=operation;return operation;
  }
  async function patchExportPreferences(patch){
    exportPrefsPending++;
    exportPrefs=cleanExportPrefs({...exportPrefs,...patch});applyExportPreferences();
    try{
      // The worker serializes field patches from every extension page. A panel
      // never writes its stale copy over another tab's settings.
      const value=await syncCommand('CAE_EXPORT_PREFS_PATCH',{patch});
      // The acknowledgement is authoritative even when its storage event has
      // not arrived yet; a newer event received first takes precedence.
      acceptExportPreferences(value);
      applyExportPreferences();
      persistPortable({export:exportPrefs}).catch(e=>log('WARNING: Portable export settings: '+e.message));
    }catch(error){
      exportPrefsReady=false;await ensureExportPreferences().catch(()=>{});throw error;
    }finally{exportPrefsPending--;refreshButtons();}
  }
  function selectionBinding(){return providers.verified(state.scope)&&state.scope.currentId&&state.tab?.id?
    {accountId:state.scope.accountId,conversationId:state.scope.currentId,tabId:state.tab.id}:null;}
  function sameSelectionBinding(a,b=selectionBinding()){
    return !!a&&!!b&&a.accountId===b.accountId&&a.conversationId===b.conversationId&&a.tabId===b.tabId;
  }
  function invalidateMessageSelection(message='Conversation changed. Click Refresh to load messages.',follow=false){
    clearMessageAutoTimer();
    messageAutoPending=!!(follow&&messageAutoAccount&&selectorActive());
    messageLoadGeneration++;messageSelectionLoading=false;messageSelection=null;messageLoadBinding=null;
    $('messageRows').replaceChildren();$('messageSelectedCount').textContent='0 selected';
    messageStatus(!messageAutoPending&&message==='Checking active conversation…'?'Conversation changed. Click Refresh to load messages.':message,messageAutoPending&&selectorVisible());$('downloadMessages').disabled=true;setDownloadLabels(null);
    $('downloadMessages').textContent='Download selection';
  }
  function selectionRows(){return messageSelection&&E?E.rows(messageSelection.chat,{...exportPrefs,completeConversation:true}):[];}
  function chosenMessageIds(){
    if(!messageSelection)return [];
    return [...new Set(selectionRows().filter(row=>row.eligible&&messageSelection.selected.has(row.id)).flatMap(row=>row.messageIds))];
  }
  function refreshMessageSelectionCount(){
    const rows=selectionRows(),selected=rows.filter(row=>row.eligible&&messageSelection.selected.has(row.id)),eligible=rows.filter(row=>row.eligible);
    let files=0;
    if(selected.length&&E?.attachments){
      try{files=E.attachments(messageSelection.chat,{...exportPrefs,completeConversation:false,
        conversationId:messageSelection.conversationId,branchNode:messageSelection.chat.branchNode,messageIds:chosenMessageIds()}).length;}catch{}
    }
    $('messageSelectedCount').textContent=`${selected.length} / ${eligible.length} messages selected${files?' · '+files+' files':''}`;
    setDownloadLabels(files);
    $('downloadMessages').disabled=state.busy||state.currentContextPending||messageSelectionLoading||!exportPrefsReady||!!exportPrefsPending||!sameSelectionBinding(messageSelection)||!selected.length;
  }
  function renderMessageSelection(){
    if(!messageSelection)return;
    const rendered=messageSelection;
    const list=$('messageRows');list.replaceChildren();
    const rows=selectionRows();
    const messagesById=new Map(messageSelection.chat.messages.map(m=>[m.id,m]));
    for(const row of rows){
      const wrapper=document.createElement('div');wrapper.className='message-row';wrapper.dataset.eligible=String(row.eligible);wrapper.dataset.rowId=row.id;wrapper.dataset.role=row.role;
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='message-checkbox';
      checkbox.checked=row.eligible&&messageSelection.selected.has(row.id);checkbox.disabled=!row.eligible;
      checkbox.setAttribute('aria-label',`Select ${row.role==='question'?'question':'answer'}: ${String(row.preview||'Attachment').slice(0,160)}`);checkbox.title=row.eligible?'Include this message according to the export content settings.':'Excluded by content settings.';
      checkbox.addEventListener('change',()=>{if(messageSelection!==rendered)return;checkbox.checked?messageSelection.selected.add(row.id):messageSelection.selected.delete(row.id);refreshMessageSelectionCount();});
      const detail=document.createElement('details');detail.className='message-copy';detail.open=messageSelection.expanded.has(row.id);
      detail.addEventListener('toggle',()=>{if(messageSelection!==rendered)return;detail.open?messageSelection.expanded.add(row.id):messageSelection.expanded.delete(row.id);if(detail.open)fillPreview();});
      const summary=document.createElement('summary');
      summary.setAttribute('aria-label',`Preview ${row.role}: ${row.preview}`);summary.title='Expand or collapse the message preview.';
      const snippet=document.createElement('span');snippet.className='message-snippet';snippet.textContent=String(row.preview||'Attachment without text').slice(0,280);
      const meta=document.createElement('span');meta.className='message-meta';meta.textContent=[row.hasThinking?'Thinking available':'',row.attachmentCount?row.attachmentCount+' file references':'',!row.eligible?'Excluded by content settings':''].filter(Boolean).join(' · ');
      snippet.title=String(row.preview||'');
      summary.append(snippet);detail.append(summary);
      const preview=document.createElement('div');preview.className='message-preview';
      // Populate text only when expanded, in original message order.
      // Selection still contains the entire logical response (including Thinking).
      const fillPreview=()=>{
        if(preview.textContent)return;
        const messages=row.messageIds.map(id=>messagesById.get(id)).filter(Boolean);
        const names=[...new Set(messages.flatMap(m=>m.attachments||[]).map(a=>a.name||a.fileId||'Unnamed file'))];
        const text=E.previewText(messages);
        const hasBody=messages.some(m=>m.role===(row.role==='question'?'user':'assistant')&&E.textOf(m).trim());
        preview.textContent=[text,...(hasBody?names.map(name=>'File: '+name):[])].join('\n\n');
      };
      summary.addEventListener('click',()=>{if(!detail.open)fillPreview();});
      if(detail.open)fillPreview();
      detail.append(preview);if(meta.textContent)detail.append(meta);wrapper.append(checkbox,detail);list.append(wrapper);
    }
    if(!rows.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='No selectable messages were returned.';list.append(empty);}
    refreshMessageSelectionCount();
  }
  async function loadMessageSelection(expected=null,{verified=false}={}){
    if(SURFACE!=='panel')return;
    clearMessageAutoTimer();messageAutoPending=false;
    const wanted=expected||selectionBinding();
    // An intent from another surface is only trusted after its exact binding
    // has been verified. Do not let a stale popup intent arm auto-follow.
    if(wanted?.accountId&&!state.currentContextPending&&sameSelectionBinding(wanted))messageAutoAccount=wanted.accountId;
    else if(!verified)messageAutoAccount=null;
    messageSelectorOpen=true;messageSelectionLoading=true;messageLoadBinding=wanted;
    const generation=++messageLoadGeneration;
    $('messageSelector').classList.remove('hidden');messageStatus('Loading messages…',true);refreshButtons();
    try{
      await ensureExportPreferences();
      if(generation!==messageLoadGeneration)return;
      if(exportPrefs.completeConversation){$('messageSelector').classList.add('hidden');return;}
      if(!E)throw Error('Selection helper is unavailable. Reload the extension.');
      if(!verified)await reconnect({force:true});
      if(generation!==messageLoadGeneration)return;
      const binding=selectionBinding();
      if(state.currentContextPending||!binding||wanted&&!sameSelectionBinding(wanted,binding))throw Error('The active chat changed. Click Refresh in the intended chat.');
      messageLoadBinding=binding;messageAutoAccount=binding.accountId;
      const item=state.chats.find(c=>c.id===binding.conversationId)||{id:binding.conversationId,title:state.tab?.title||'Current chat'};
      const chat=await call('CAE_GET_CHAT',{chat:item,expectedAccountId:binding.accountId});
      if(generation!==messageLoadGeneration)return;
      if(state.currentContextPending||!sameSelectionBinding(binding)||chat?.id!==binding.conversationId)throw Error('The active chat changed while messages were loading.');
      if(!Array.isArray(chat.messages)||!chat.messages.length)throw Error('No readable messages were returned. Reload messages to try again.');
      const previous=messageSelection;
      const rows=E.rows(chat,{...exportPrefs,completeConversation:true});
      const sameBranch=sameSelectionBinding(previous,binding)&&previous.chat.branchNode===chat.branchNode;
      messageSelection={...binding,chat,item,selected:sameBranch?previous.selected:new Set(rows.map(r=>r.id)),expanded:sameBranch?previous.expanded:new Set()};
      messageStatus();
      renderMessageSelection();
    }catch(error){
      if(generation!==messageLoadGeneration)return;
      messageSelection=null;$('messageRows').replaceChildren();$('messageSelectedCount').textContent='0 selected';
      messageStatus(error?.message||String(error));fail(error);
    }finally{if(generation===messageLoadGeneration){messageSelectionLoading=false;messageLoadBinding=null;$('messageLoadProgress').classList.add('hidden');$('messageRows').setAttribute('aria-busy','false');refreshButtons();if(messageSelection)refreshMessageSelectionCount();}}
  }
  function selectMessageRows(action){
    if(!messageSelection||messageSelectionLoading)return;
    const rows=selectionRows().filter(r=>r.eligible);
    if(action==='none')messageSelection.selected.clear();
    else if(action==='invert')for(const row of rows)messageSelection.selected.has(row.id)?messageSelection.selected.delete(row.id):messageSelection.selected.add(row.id);
    else{
      messageSelection.selected.clear();
      for(const row of rows)if(action==='all'||(action==='files'?row.attachmentCount>0:row.role===action))messageSelection.selected.add(row.id);
    }
    renderMessageSelection();
  }
  async function downloadMessageSelection(){
    if($('downloadMessages').disabled||!messageSelection)return;
    const bound=messageSelection,ids=chosenMessageIds();
    try{
      const selection={...exportPrefs,completeConversation:false,conversationId:bound.conversationId,
        branchNode:bound.chat.branchNode,messageIds:ids};
      E.validate(bound.chat,selection);
      const fresh=await call('CAE_STATUS',{force:true},null,25000);
      const active=sourceTabId?await chrome.tabs.get(sourceTabId):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
      if(messageSelection!==bound||state.currentContextPending||active?.id!==bound.tabId||!sameSelectionBinding(bound)||fresh.accountId!==bound.accountId||fresh.currentId!==bound.conversationId)
        throw Error('Conversation changed before export. Reload messages in the intended chat.');
      await exportChats([bound.item],{mode:'current',destination:'download',exportSelection:selection});
    }catch(error){fail(error);}
  }
  const providers=globalThis.ChatArchiveProviders;
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
    return !!(providers.verified(state.scope) && !state.currentContextPending &&
      (!accountId || state.scope.accountId === accountId));
  }
  function rememberVerifiedWorkspace(scope, tab) {
    if (!providers.verified(scope)) return;
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
    if(messageSelection&&!sameSelectionBinding(messageSelection))invalidateMessageSelection('Checking active conversation…',true);
    document.body.classList.toggle('message-selector-active',selectorActive());
    // The top action opens the selector; once open, only its footer submits
    // a selective export. Keep the split menu active so categories can change.
    $('exportCurrent').disabled=selectorActive()||state.busy||state.currentContextPending||!state.port||!state.scope?.observed||!state.scope?.currentId||!exportPrefsReady||!!exportPrefsPending||messageSelectionLoading||!exportCategoriesSelected();
    $('quickVault').classList.toggle('hidden',selectorActive());
    setDownloadLabels();
    $('exportMenuToggle').disabled=!exportPrefsReady;
    $('currentSelect').disabled=!exportPrefsReady||!!exportPrefsPending;
    $('exportAll').disabled=!exportPrefsReady||!!exportPrefsPending;
    for(const node of document.querySelectorAll('[data-export-field]'))node.disabled=!exportPrefsReady||!!exportPrefsPending;
    $('reloadMessages').disabled=messageSelectionLoading||state.busy||state.currentContextPending||!state.scope?.observed||!state.scope?.currentId;
    for(const node of document.querySelectorAll('[data-message-selection]'))node.disabled=!messageSelection||messageSelectionLoading||state.currentContextPending||(node.dataset.messageSelection==='files'&&!selectionRows().some(r=>r.eligible&&r.attachmentCount>0));
    if(messageSelection)refreshMessageSelectionCount();else $('downloadMessages').disabled=true;
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
    refreshLibraryControls();uiRefresh();maybeAutoLoadMessages();
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
    if(!selectorVisible())clearMessageAutoTimer();else maybeAutoLoadMessages();
  }
  function mode(name){
    if(!['current','all','library'].includes(name))return;
    if(SURFACE!=='panel'&&name!=='current'){openPanel(name);return;}
    state.mode=name;uiView='export';applyModeView(name);refreshButtons();
    if(name==='library'&&!state.libraryJob?.job?.active)status('Loading saved inventory from Vault…');
    if(name==='all')ensureListLoaded().catch(fail);
    if(name==='library')refreshLibraryState(true,true).catch(fail);
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
    const old=state.port;state.port=null;
    if (old) try { old.disconnect(); } catch (_err) {}
    for (const pending of state.requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('ChatGPT tab was disconnected.')); }
    state.requests.clear();
  }
  async function connectActive(auto = false, force = false) {
    const context=contextGeneration;
    const tab=sourceTabId?await chrome.tabs.get(sourceTabId).catch(()=>null):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
    if(context!==contextGeneration)return null;
    if (!tab || !providers.isLegacyUrl(tab.url)) {
      if (state.port) disconnect();
      state.tab = null;
      state.scope = null;state.currentContextPending=false;
      if(messageAutoPending)messageStatus('Open a ChatGPT conversation to continue.');
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
    if (state.port && state.scope && state.tab?.id === tab.id && !force && !state.currentContextPending && state.tab.url === tab.url)
      return state.scope;
    // Focus can reveal a different active tab even before its navigation event.
    if(state.tab&&(state.tab.id!==tab.id||state.tab.url!==tab.url)){
      state.currentContextPending=true;
      // A newly received popup intent may already target this tab. Let its
      // own exact-binding check decide rather than cancelling it on connect.
      const requested=messageSelectionLoading&&messageLoadBinding?.tabId===tab.id;
      if(!requested&&(messageSelection||messageLoadBinding||messageAutoAccount&&selectorActive()))
        invalidateMessageSelection('Checking active conversation…',true);
      refreshButtons();
    }
    state.currentContextPending=true;
    disconnect();
    state.tab = tab;
    refreshButtons();
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
    const scope = await call('CAE_STATUS', {force:force===true}, null, 25000);
    if(state.port!==activePort||context!==contextGeneration)return null; // A tab change may invalidate an in-flight reply.
    if(!providers.verified(scope))throw Object.assign(Error('Workspace could not be verified.'),{code:'WORKSPACE_UNVERIFIED'});
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
    if(previousAccount&&previousAccount!==scope.accountId){state.selected.clear();state.selectedProjects.clear();state.chats=[];state.projects=[];state.listAccountId=null;state.listLoadedAt=0;state.listSource=null;state.sync=null;state.syncLoaded=false;state.librarySelected.clear();}
    state.scope = scope;state.directory=null;state.chatVaultEvidence=null;state.chatVaultAt=0;state.sharedActivity=null;state.libraryLoadError=null;state.lastConnectionCode=null;
    chrome.runtime.sendMessage({type:'CAE_UI_BIND',tabId:tab.id,accountId:scope.accountId,display:scope.display,observed:scope.observed}).catch(()=>{});
    if(state.mode==='library')renderLibrary();
    rememberVerifiedWorkspace(scope,tab);
    // A workspace can have its own already-authorized Vault binding. It wins
    // over the globally last-chosen folder when returning to that workspace.
    try {
      const bound = await deadline(ChatArchiveVault.restoreWorkspaceDirectory(scope.accountId),'Workspace Vault lookup',8000);
      if(context!==contextGeneration||state.port!==activePort)return null;
      state.directory=bound||null;
      await refreshVaultStatus();
    } catch (error) { log('WARNING: Workspace Vault status: ' + error.message); }
    if(context!==contextGeneration||state.port!==activePort)return null;
    state.currentContextPending=false;
    $('scope').textContent = `${scope.display} · ${scope.accountId ? scope.accountId.slice(0, 8) : 'account not identified'}`;
    refreshButtons();
    if(manualJob?.active)showManual(manualJob);else status('Connected.');
    await refreshSync().catch(error => log('WARNING: Background status unavailable: ' + error.message));
    if (SURFACE==='panel'&&uiView==='export'&&state.mode === 'all'&&!manualJob?.active) ensureListLoaded().catch(error => log('WARNING: Could not load conversations: ' + error.message));
    refreshLibraryState(true,SURFACE==='panel'&&uiView==='export'&&state.mode==='library').catch(error => log('WARNING: Could not read saved Library state: ' + error.message));
    refreshManual().catch(()=>{});refreshSharedActivity(true).catch(()=>{});
    if (!scope.observed) log('WARNING: Active workspace ID was not confirmed by the session API. Do not bulk export until the workspace is verified.');
    return scope;
  }
  async function reconnect(options = {}) {
    if (state.connecting) return state.connecting;
    const auto = !!options.auto,context=contextGeneration;
    if (auto && Date.now() < state.nextAutoAttempt) return state.scope;
    const p = connectActive(auto, !!options.force).then(scope => {
      state.autoFailures = 0; state.nextAutoAttempt = 0;
      return scope;
    }).catch(error => {
      if(context!==contextGeneration)return null;
      state.lastConnectionCode=connectionCode(error);disconnect();state.scope=null;state.currentContextPending=true;state.syncLoaded=false;
      $('scope').textContent='Workspace not verified';$('syncStatus').textContent='Monitoring status unknown until workspace is verified.';refreshButtons();updateSyncApply();
      if (auto) {
        state.nextAutoAttempt = Date.now() + Math.min(30000, 1500 * 2 ** Math.min(++state.autoFailures, 4));
        status('ChatGPT connection pending ('+state.lastConnectionCode+'). Retrying when available.');
        if (state.autoFailures <= 5) scheduleReconnect(state.nextAutoAttempt - Date.now() + 50);
        return null;
      }
      throw error;
    }).finally(() => {
      if(state.connecting!==p)return;
      state.connecting=null;
      if(state.reverifyScope&&state.reconnectTimer===null)scheduleReconnect(150,true);
      maybeAutoLoadMessages();
    });
    state.connecting = p;
    return p;
  }
  function scheduleReconnect(delay = 250,force = false) {
    state.reverifyScope=!!state.reverifyScope||force;
    if (state.busy && !manualJob?.active) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if(state.connecting)return; // Its finally handler consumes a queued forced recheck.
      const reverify=state.reverifyScope;state.reverifyScope=false;
      reconnect({auto:true,force:reverify}).catch(() => {});
    }, delay);
  }

  function chatKind(c){return ChatArchivePaths.isProject(c.projectId)?'project':ChatArchivePaths.isGPT(c.gptId||c.projectId)?'gpt':'unassigned';}
  function chatArchiveStatus(c){
    const e=state.chatVaultEvidence;
    if(!e||e.dir!==state.directory||state.currentContextPending||e.context!==contextGeneration)return 'unknown';
    return CAEUIChatListCache.archiveStatus(c,e.value,state.scope?.accountId,state.listSource==='live_api'||state.listSource==='last ChatGPT list');
  }
  function filteredChats(){
    const query=$('search').value.toLocaleLowerCase().trim(),container=$('chatContainer').value,archived=$('chatArchived').value;
    return state.chats.filter(c=>(container==='all'||chatKind(c)===container)&&(archived==='all'||(archived==='archived'?chatArchiveStatus(c)==='current':['missing','outdated'].includes(chatArchiveStatus(c))))&&
      (!query||`${c.title} ${c.project||''} ${c.gptName||''}`.toLocaleLowerCase().includes(query)));
  }
  function refreshSelectionUi(){
    const ids=filteredChats().map(c=>c.id),v=U.selection(ids,state.selected);
    $('selectAll').checked=v.checked;$('selectAll').indeterminate=v.mixed;$('selectAll').disabled=!ids.length;
    refreshButtons();
  }
  function renderChats(){
    const all=new Map(),visibleIds=new Set(filteredChats().map(c=>c.id));
    const unknown=state.chats.filter(c=>['unknown','saved'].includes(chatArchiveStatus(c))).length;
    $('chatArchiveHint').textContent=unknown?`${unknown} chat(s) without confirmed Vault currency. Unknown rows are shown in All chats only. Currency is compared with the latest available conversation list.`:'Archived = indexed current Vault revision; older copies need an update.';
    $('chatArchiveHint').classList.toggle('hidden',!state.chats.length);
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
        items:visible.map(c=>{const a=chatArchiveStatus(c);return {id:c.id,title:c.title,
          note:[c.updated?'Updated '+new Date(typeof c.updated==='number'?c.updated*1000:c.updated).toLocaleDateString():'',c.archived?'ChatGPT archive':''].filter(Boolean).join(' · '),
          archived:a==='current',badge:a==='current'?'archived':a==='outdated'?'update pending':a==='saved'?'saved':'',
          reason:a==='current'?'Current revision in the saved Vault index; not a live file-integrity audit.':a==='outdated'?'Saved revision differs from the last conversation list.':undefined};})});
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
  async function refreshChatVault(force=false){
    const account=state.scope?.accountId,dir=state.directory,context=contextGeneration;
    if(!account||!dir||state.currentContextPending||!providers.verified(state.scope)){
      state.chatVaultEvidence=null;state.chatVaultAt=0;return null;
    }
    if(state.chatVaultRead?.context===context&&state.chatVaultRead.dir===dir&&state.chatVaultRead.account===account)return state.chatVaultRead.promise;
    if(!force&&state.chatVaultAttempt?.dir===dir&&state.chatVaultAttempt.context===context&&Date.now()-state.chatVaultAt<5000)return null;
    const valid=()=>state.scope?.accountId===account&&state.directory===dir&&contextGeneration===context&&!state.currentContextPending;
    const read={account,dir,context,promise:null};
    state.chatVaultAttempt={dir,context};state.chatVaultAt=Date.now();
    read.promise=(async()=>{
      try{
        const v=await syncCommand('CAE_UI_CHAT_CACHE',{accountId:account,display:state.scope?.display||''});
        if(!valid())return null;
        state.chatVaultEvidence=v?.vault?.account_id===account?{dir,context,value:v.vault}:null;
        state.chatVaultAt=Date.now();
        if(v?.items?.length&&showCachedChatList(v,account,v.source||'Vault')){
          const C=globalThis.CAEUIChatListCache;
          chrome.storage.local.set({[C.key(account)]:C.envelope(account,v.source,v.items,v.projects)}).catch(()=>{});
        }else if(state.listAccountId===account&&state.chats.length)renderChats();
        return v;
      }catch(e){if(valid()){state.chatVaultEvidence=null;if(state.chats.length)renderChats();log('WARNING: Vault chat index unavailable: '+e.message);}return null;}
      finally{if(state.chatVaultRead===read)state.chatVaultRead=null;}
    })();state.chatVaultRead=read;return read.promise;
  }
  async function hydrateCachedChats(account){
    const C=globalThis.CAEUIChatListCache;
    if(!C||!account||state.scope?.accountId!==account)return;
    if(!state.listLoadedAt)try{
      const key=C.key(account),saved=C.accept((await chrome.storage.local.get(key))[key],account);
      if(saved?.items?.length)showCachedChatList(saved,account,saved.source==='live_api'?'last ChatGPT list':saved.source);
    }catch(e){log('WARNING: Last chat-list cache unavailable: '+e.message);}
    await refreshChatVault(true);
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
      return refreshChatVault(true);
    // Start both at once: the cache renders as soon as available, rather
    // than waiting for all pages of the provider's listing API.
    const task=Promise.allSettled([hydrateCachedChats(account),loadList()]);
    const pending=task.finally(()=>{if(state.listLoading===pending){state.listLoading=null;state.listLoadAccount=null;}});
    state.listLoading=pending;state.listLoadAccount=account;return pending;
  }

  function libraryEligible(f){return !!f.archive_eligibility?.selectable&&!['saved','already_archived'].includes(f.archive?.status);}
  function renderLibrary(){
    const catalog=state.libraryAccountId===libraryAccount()?state.library:null;
    if(!catalog){$('libraryGroups').replaceChildren();$('librarySummary').textContent=state.libraryLoadError?'Saved inventory unavailable: '+state.libraryLoadError:state.libraryRefresh?'Loading saved inventory…':'No saved inventory for this workspace.';$('libraryCount').textContent='No inventory loaded.';libraryVisible=[];refreshButtons();return;}
    const summary=catalog.summary||{};
    $('librarySummary').textContent=`${summary.total||0} records (${summary.library_files||0} in Library, ${summary.project_source_only||0} Source-only) - ${catalog.status||'unknown'} - ${summary.project_source_excluded||0} verified Source copies excluded`;
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
        items:files.map(f=>({id:f.id,title:f.name||f.id,selectable:!!f.archive_eligibility?.selectable,archived:['saved','already_archived'].includes(f.archive?.status),disabled:!libraryEligible(f),
          reason:f.source_copy_verified?'Verified original in Project Sources Vault export':f.source_only?'Project Source reference only':f.managed_by_project_sources?'Project Source linked; no verified Vault copy':f.archive_eligibility?.reason||'Not selectable',badge:f.source_copy_verified?'Saved Source':f.managed_by_project_sources?'Source':f.archive?.status==='saved'?'Saved':f.archive?.status==='failed'?'Failed':'',
          note:[f.format_class,f.origin_status==='inferred'?'inferred':f.origin==='unknown'?'origin unknown':null,
            f.source_copy_verified?'Project Source: verified copy in Vault; library download disabled':f.managed_by_project_sources?'Project Source linked; library original remains selectable until a Vault copy is verified':null,...(f.placements||[]).filter(p=>p.type==='project_source').map(p=>p.project_name),
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
    const pending=pendingRestore();
    $('libraryMonitor').disabled=active||!verified||!(pending?restored.saved.hasInventory:j?.baseline_at);
    if(!pending)$('libraryMonitor').checked=!!j?.enabled;
    $('libraryPickVault').disabled=!canReselectVault();
    $('libraryGrantVault').classList.toggle('hidden',!state.directory||state.vaultPermission==='granted'&&!vaultRepairNeeded());
    $('libraryVaultName').textContent=state.directory?`Vault: ${state.directory.name} (${state.vaultPermission})`:'Choose a Vault before starting.';
    $('libraryArchive').disabled=!verified||active||state.librarySubmitting||!j?.baseline_at||!state.librarySelected.size;
    $('librarySelectAll').disabled=active||!state.library;
    for(const box of $('libraryGroups').querySelectorAll('.library-file-checkbox'))box.disabled=active||box.dataset.archived==='true';
    const visibleIds=libraryVisible.filter(libraryEligible).map(f=>f.id),sel=U.selection(visibleIds,state.librarySelected);
    $('librarySelectAll').checked=sel.checked;$('librarySelectAll').indeterminate=sel.mixed;
    const hiddenCount=[...state.librarySelected].filter(id=>!visibleIds.includes(id)).length;
    $('librarySelectedCount').textContent=`${state.librarySelected.size} selected`+(hiddenCount?` (${hiddenCount} hidden by filters)`:'');
    const job=j?.job,saved=state.sharedActivity?.account_id===libraryAccount()?state.sharedActivity.library:null;
    $('refreshLibrary').textContent=state.libraryAccountId===libraryAccount()&&state.library?'Refresh inventory':'Start inventory';
    const useSaved=saved&&!job?.active&&(!job||!job.finished_at||Date.parse(saved.finished_at)>Date.parse(job.finished_at));
    $('libraryJobStatus').textContent=useSaved?saved.summary:job?`${job.status}: ${job.detail}`:state.library?'Saved inventory loaded.':'Idle. Start inventory is the only initial scan trigger.';
  }
  function applyLibraryState(j,account){
    if(libraryAccount()!==account)return;
    state.libraryJob=j;
    if(!j||j.catalog===null){state.library=null;state.libraryAccountId=null;state.librarySelected.clear();state.libraryCatalogRevision=-1;renderLibrary();}
    if(j?.catalog){
      state.library=j.catalog;state.libraryAccountId=account;state.libraryCatalogRevision=j.catalog_revision;
      const archived=new Set(j.catalog.items.filter(x=>['saved','already_archived'].includes(x.archive?.status)).map(x=>x.id));
      for(const id of archived)state.librarySelected.delete(id);renderLibrary();
    }
    refreshButtons();refreshLibraryControls();
  }
  async function refreshLibraryState(includeCatalog=false,updateAPI=false){
    const account=libraryAccount();if(!account)return;
    if(state.libraryRefresh){await state.libraryRefresh;if(includeCatalog)return refreshLibraryState(true,updateAPI);return;}
    const context=contextGeneration,dir=state.directory,valid=()=>libraryAccount()===account&&contextGeneration===context;
    const operation=(async()=>{
      let j=await syncCommand('CAE_LIBRARY_JOB_STATUS',{accountId:account,withCatalog:includeCatalog});
      if(!valid())return;
      if(j&&!includeCatalog&&j.catalog_revision!==state.libraryCatalogRevision)j=await syncCommand('CAE_LIBRARY_JOB_STATUS',{accountId:account,withCatalog:true});
      if(!valid())return;
      applyLibraryState(j,account);
      // Only a live verified binding may load the disk snapshot; a cached
      // workspace name or an old account's directory cannot authorize it.
      if(includeCatalog&&dir&&dir===state.directory&&state.vaultPermission==='granted'&&providers.verified(state.scope,account)&&!state.currentContextPending&&!j?.job?.active&&Number.isInteger(state.tab?.id)){
        const options={accountId:account,display:state.scope.display,tabId:state.tab.id};
        try{
          j=await syncCommand('CAE_LIBRARY_JOB_LOAD_VAULT',{options});
          if(!valid()||dir!==state.directory)return;
          state.libraryLoadError=null;applyLibraryState(j,account);
          // Paint the existing catalog before starting the optional one-shot
          // metadata update. Never create the first baseline automatically.
          if(updateAPI&&j?.baseline_at&&j.catalog&&state.mode==='library'&&uiView==='export'){
            status('Saved inventory loaded from Vault. Checking for updates if due.');
            j=await syncCommand('CAE_LIBRARY_JOB_REFRESH_ONCE',{options});
            if(!valid()||dir!==state.directory)return;applyLibraryState(j,account);
            status(j?.job?.active?'Saved inventory displayed; checking API for updates.':'Saved inventory loaded from Vault.');
          }else if(updateAPI&&!j?.catalog)status('No saved inventory. Use Start inventory.');
        }catch(e){if(valid()&&dir===state.directory){state.libraryLoadError=e.message;renderLibrary();if(updateAPI)status(state.library?'Showing saved inventory; update unavailable.':'Could not read the saved inventory: '+e.message);}}
      }
      if(j?.job?.active||j?.enabled){
        const bound=await ChatArchiveLibraryStore.directory(account);
        if(bound&&valid())state.directory=bound;
      }
      if(valid()){refreshButtons();refreshLibraryControls();}
    })().finally(()=>{if(state.libraryRefresh===operation){state.libraryRefresh=null;if(valid()&&!state.library)renderLibrary();}});
    state.libraryRefresh=operation;return operation;
  }
  let historyRefresh=null;
  async function refreshSharedActivity(force=false){
    const account=libraryAccount(),dir=state.directory,context=contextGeneration;
    if(!account||!dir||state.vaultPermission!=='granted'||!providers.verified(state.scope,account)||state.currentContextPending)return;
    if(historyRefresh){await historyRefresh; if(force&&contextGeneration===context&&state.directory===dir)return refreshSharedActivity(false);return;}
    const p=syncCommand('CAE_UI_WORKSPACE_HISTORY',{accountId:account,display:state.scope.display,force}).then(r=>{
      if(contextGeneration!==context||libraryAccount()!==account||state.directory!==dir)return;
      state.sharedActivity=r?.account_id===account?r:null;uiRefresh();refreshLibraryControls();
    }).finally(()=>{if(historyRefresh===p)historyRefresh=null;});historyRefresh=p;return p;
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
        errorName:state.vaultErrorName||null,userActivation:navigator.userActivation?.isActive===true});
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
      picker.disabled=!canReselectVault();
      if(!dir){
        picker.textContent='Choose Vault\u2026';
        $('folderStatus').textContent=state.vaultCandidate?'A saved Vault is available. Connect it to the verified workspace.':'No directory handle selected. Choose the existing Vault to reconnect it.';
        state.vaultPermission='no_handle';button.textContent='Connect Vault';button.classList.toggle('hidden',!state.vaultCandidate);button.disabled=!providers.verified(state.scope)||state.currentContextPending;
        notifyPanelPermission('no_handle');return;
      }
      picker.textContent='Change Vault\u2026';
      let permission;try{permission=await deadline(ChatArchiveVault.permissionState(dir),'Vault permission check',8000);}catch(e){permission={state:'error',errorName:connectionCode(e)};}
      // Ignore a stale async result from a different workspace/directory.
      if(dir!==state.directory||account!==state.scope?.accountId)return;
      const previous=state.vaultPermission;
      state.vaultPermission=permission.state;state.vaultErrorName=permission.errorName||null;
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
      button.textContent=['error','unsupported'].includes(permission.state)||permission.state==='granted'&&vaultRepairNeeded()?'Reselect original Vault…':permission.state==='denied'?'Review Vault access…':'Restore Vault access…';
      const manualNeedsAccess=manualJob?.active&&manualJob.destination==='vault'&&manualJob.accountId===account;
      button.classList.toggle('hidden',permission.state==='granted'&&!vaultRepairNeeded());
      button.disabled=!providers.verified(state.scope)||state.currentContextPending;
      if(manualNeedsAccess&&providers.verified(state.scope)&&!state.currentContextPending)button.disabled=false;
      notifyPanelPermission(permission.state);
      if(permission.state==='granted'&&state.sync?.enabled){
        await retainGrantedVault(previous!=='granted').catch(error=>
          log('WARNING: Could not confirm Vault handle retention: '+error.message));
      }
    })().finally(()=>{
      if(vaultStatusRun===operation)vaultStatusRun=null;
      uiRefresh();
      if(state.mode==='all'&&uiView==='export'&&state.chats.length){renderChats();if(!state.currentContextPending)refreshChatVault().catch(()=>{});}
      if(dir!==state.directory||account!==state.scope?.accountId)refreshVaultStatus().catch(()=>{});
    });
    vaultStatusRun=operation;return operation;
  }
  async function restoreFolder() {
    try { const restored=await deadline(ChatArchiveVault.restoreDirectory(),'Saved Vault lookup',8000);if(!state.vaultCandidate)state.vaultCandidate=restored; }
    catch (e) { log('Vault directory handle could not be restored: ' + (e.message || e)); }
    await refreshVaultStatus();
  }
  async function selectFolder() {
    const active=vaultBindingActive(),previous=state.directory,account=providers.verified(state.scope)&&!state.currentContextPending?state.scope.accountId:null,context=contextGeneration;
    if(active&&!canReselectVault())throw Error('Pause active jobs before changing the Vault. Reselection is available when access needs repair.');
    if(SURFACE==='popup'){openPanel('settings');return;}
    if(typeof window.showDirectoryPicker!=='function')throw Error('Directory picker unavailable. Open persistent Settings in a tab.');
    const dir=await window.showDirectoryPicker({id:'chat-archive-exporter-vault',mode:'readwrite'});
    const stillHere=()=>context===contextGeneration&&(!account||providers.verified(state.scope,account)&&!state.currentContextPending);
    if(!stillHere())throw Error('Workspace changed during the folder picker. No binding was changed.');
    if(active||vaultBindingActive()){
      if(!account||!previous)throw Error('Verify the original workspace before repairing an active Vault.');
      await ChatArchiveVault.verifySameDirectory(previous,dir);
      const release=await ChatArchiveVault.acquireLock(true);
      if(!release)throw Error('A local writer is still active. Retry Vault recovery after its current operation.');
      try{
        if(!stillHere())throw Error('Workspace changed during Vault recovery.');
        const bound=await ChatArchiveVault.restoreWorkspaceDirectory(account);
        if(bound)await ChatArchiveVault.verifySameDirectory(bound,dir);
        else if(state.sync?.enabled)throw Error('Original monitoring Vault binding is missing. Pause monitoring before changing folders.');
        const m=manualJob?.active&&manualJob.destination==='vault'&&manualJob.accountId===account?manualJob:null;
        if(manualJob?.active&&manualJob.destination==='vault'&&!m)throw Error('Activate the workspace of the pending manual job first.');
        const library=state.libraryJob?.account_id===account&&(state.libraryJob.enabled||state.libraryJob.job?.active);
        if(m)await ChatArchiveVault.verifySameDirectory(await ChatArchiveManualStore.directory(m.id),dir);
        if(library)await ChatArchiveVault.verifySameDirectory(await ChatArchiveLibraryStore.directory(account),dir);
        const p=await ChatArchiveVault.permissionState(dir);
        if(p.state!=='granted')throw Error('Fresh directory access could not be verified ('+(p.errorName||p.state)+'). Try the picker in persistent Settings.');
        if(!stillHere())throw Error('Workspace changed during Vault recovery.');
        await ChatArchiveVault.rememberWorkspaceDirectory(account,dir);
        await ChatArchiveVault.rememberDirectory(dir);
        if(library)await ChatArchiveLibraryStore.bind(account,dir);
        if(m){await ChatArchiveManualStore.bind(m.id,dir);manualDirectory=dir;manualBindingId=m.id;}
        if(!stillHere())throw Error('Workspace changed after recovery. Activate the original workspace.');
        state.directory=dir;state.vaultCandidate=dir;state.vaultPermission='granted';state.vaultErrorName=null;holderReadyKey='';holderReadyAt=0;
      }finally{release();}
      await refreshVaultStatus();
      if(state.sync?.enabled)await retainGrantedVault(true);
      await syncCommand('CAE_MANUAL_WAKE',{accountId:account}).catch(()=>{});
      if(state.libraryJob?.job?.status==='permission_required')await syncCommand('CAE_LIBRARY_JOB_RESUME',{accountId:account}).catch(()=>{});
      await refreshLibraryState(true,state.mode==='library'&&uiView==='export').catch(()=>{});refreshSharedActivity(true).catch(()=>{});
      refreshLibraryControls();status('Original Vault reselected. Settings, enrollment date and accepted jobs retained.');return;
    }
    restored=null;restoreChecked=null;state.vaultCandidate=dir;
    if(account&&stillHere()){
      await ChatArchiveVault.rememberWorkspaceDirectory(account,dir);
      if(stillHere())state.directory=dir;
    }else if(!providers.verified(state.scope))state.directory=null;
    try{await ChatArchiveVault.rememberDirectory(dir);}
    catch(e){log('WARNING: Vault folder could not be remembered: '+e.message);}
    await refreshVaultStatus();refreshLibraryControls();await discoverPreferences();
    await refreshLibraryState(true,state.mode==='library'&&uiView==='export').catch(()=>{});refreshSharedActivity(true).catch(()=>{});
    status(state.directory===dir?'Vault selected. Existing files and indexes will be reused.':'Vault selected. Verify ChatGPT and connect it to this workspace.');
  }
  async function grantVaultAccess() {
    if(['error','unsupported'].includes(state.vaultPermission)||state.vaultPermission==='granted'&&vaultRepairNeeded())return selectFolder();
    if(!providers.verified(state.scope)||state.currentContextPending)throw Error('Reconnect ChatGPT and verify the workspace before reconnecting its Vault.');
    const dir=state.directory||state.vaultCandidate,account=state.scope.accountId,context=contextGeneration;
    if (!dir) throw new Error('Choose a Vault directory first.');
    if (!(await ChatArchiveVault.hasPermission(dir, true)))
      throw new Error('Vault write permission was not granted.');
    if(context!==contextGeneration||!providers.verified(state.scope,account)||state.currentContextPending)throw Error('Workspace changed during Vault connection. Reconnect from the intended workspace.');
    await ChatArchiveVault.rememberWorkspaceDirectory(account,dir);
    await ChatArchiveVault.rememberDirectory(dir);
    if(context!==contextGeneration||!providers.verified(state.scope,account)||state.currentContextPending)throw Error('Workspace changed during Vault connection.');
    state.directory=dir;state.vaultCandidate=dir;
    await refreshVaultStatus();
    if(state.sync?.enabled)await retainGrantedVault();
    await syncCommand('CAE_MANUAL_WAKE',{accountId:state.scope?.accountId}).catch(()=>{});
    if(libraryAccount())await syncCommand('CAE_LIBRARY_JOB_RESUME',{accountId:libraryAccount()}).catch(()=>{});
    refreshLibraryControls();await discoverPreferences();
    await refreshLibraryState(true,state.mode==='library'&&uiView==='export').catch(()=>{});refreshSharedActivity(true).catch(()=>{});
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
    if (!j||j.accountId!==libraryAccount()) {if(!state.listLoading)markBusy(!!j?.active);uiRefresh();return;}
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
      if(state.scope?.accountId!==boundScope.accountId||state.tab?.id!==boundTab||
        exportMode==='current'&&state.scope?.currentId!==items[0]?.id)throw Error('Workspace or conversation changed before acceptance. Start again in the intended workspace.');
      const j=await syncCommand('CAE_MANUAL_SUBMIT',{options:{requestId,
        accountId:boundScope.accountId,display:boundScope.display,tabId:boundTab,
        destination,mode:exportMode,items:items.map(x=>({...x})),projects:projectSnapshot,
        ...(options.exportSelection?{exportSelection:structuredClone(options.exportSelection)}:{}),
        selectedProjectIds:selectedProjects,
        ...(Number.isSafeInteger(options.selectionCount)?{selectionCount:options.selectionCount,listCount:totalChats}:{}),
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
    if (state.busy || destination==='download'&&$('exportCurrent').disabled||destination==='vault'&&$('quickVault').disabled) return;
    if (!state.scope?.currentId) { status('Open a ChatGPT conversation first.'); return; }
    setExportMenu(false);
    if(destination==='download'&&!exportPrefs.completeConversation){
      const binding=selectionBinding();
      if(SURFACE!=='panel'){openPanel('current',false,{selectMessages:true,...binding});return;}
      if(messageSelection&&sameSelectionBinding(messageSelection)){
        messageSelectorOpen=true;applyExportPreferences();$('messageSelector').scrollIntoView({block:'nearest'});
      }else await loadMessageSelection(binding);
      return;
    }
    const item=state.chats.find(c=>c.id===state.scope.currentId)||{id:state.scope.currentId,title:'Current chat',project:'',projectId:''};
    const exportSelection=destination==='download'?{...exportPrefs,completeConversation:true,conversationId:item.id}:null;
    if(destination==='download'){
      const bound=selectionBinding();
      const fresh=await call('CAE_STATUS',{force:true},null,25000);
      const active=sourceTabId?await chrome.tabs.get(sourceTabId):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
      if(!sameSelectionBinding(bound)||state.currentContextPending||active?.id!==bound.tabId||
        fresh.accountId!==bound.accountId||fresh.currentId!==bound.conversationId)
        throw Error('Conversation changed before export. Click Download MD in the intended chat.');
    }
    await exportChats([item],{mode:'current',destination,...(exportSelection?{exportSelection}:{})});
  }

  function connectionCode(error){
    const code=error?.code;if(code==='VAULT_BUSY')return code;
    if(['AUTH_REQUIRED','SESSION_TIMEOUT','NETWORK_ERROR','SESSION_INVALID_RESPONSE','WORKSPACE_UNVERIFIED','IDB_BLOCKED','TIMEOUT','BRIDGE_UNAVAILABLE'].includes(code))return code;
    const msg=String(error?.message||'');
    return /timed out|timeout/i.test(msg)?'TIMEOUT':/network|fetch/i.test(msg)?'NETWORK_ERROR':/channel closed|disconnected|receiving end|connection|no response/i.test(msg)?'CONNECTION_UNAVAILABLE':'UNAVAILABLE';
  }
  async function deadline(promise,label,ms){
    let timer;
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(label+' timed out.'),{code:'TIMEOUT'})),ms);})]);}
    finally{clearTimeout(timer);}
  }
  async function syncCommand(type, extra={}) {
    try{
      const pending=chrome.runtime.sendMessage({type,...extra});
      // Read requests can expire; never automatically retry a mutating command.
      const readOnly=['CAE_MANUAL_STATUS','CAE_SYNC_STATUS','CAE_LIBRARY_JOB_STATUS','CAE_LIBRARY_JOB_LOAD_VAULT','CAE_UI_WORKSPACE_HISTORY','CAE_EXPORT_PREFS_GET','CAE_UI_CHAT_CACHE','CAE_VAULT_DIAGNOSTICS'].includes(type);
      const response=readOnly?await deadline(pending,type,12000):await pending;
      if(!response?.ok)throw Object.assign(new Error(response?.error||'No response to '+type+' from the background controller.'),{code:response?.code});
      return response.result;
    }catch(e){state.lastControllerCode=connectionCode(e);state.lastControllerCommand=type;throw e;}
  }
  var restored=null,restoreLoading=null,restoreChecked=null,applyingRestored=false;
  function pendingRestore(){return restored&&restored.account===state.scope?.accountId&&restored.dir===state.directory;}
  async function discoverPreferences(){
    if(!globalThis.CAEPortablePreferences||!providers.verified(state.scope)||state.currentContextPending||!state.directory||state.vaultPermission!=='granted'||!state.syncLoaded)return;
    const dir=state.directory,account=state.scope.accountId,display=state.scope.display;
    if(restoreLoading||restoreChecked?.dir===dir&&restoreChecked?.account===account||pendingRestore())return;
    if(state.sync?.startedAt||state.sync?.enabled||state.libraryJob?.enabled)return;
    const p=(async()=>{
      const saved=await deadline(CAEPortablePreferences.read(dir,account,display),'Saved preferences',10000);
      if(state.directory!==dir||!providers.verified(state.scope,account)||state.currentContextPending)return;
      const key='cae.preferences.confirmed.'+account;
      const local=await chrome.storage.local.get(key);
      if(state.directory!==dir||!providers.verified(state.scope,account))return;
      restoreChecked={dir,account};
      if(local[key]||!saved.chat&&!saved.library&&!saved.export)return;
      restored={dir,account,saved};
      if(saved.chat){$('syncEnabled').checked=saved.chat.enabled;$('syncScope').value=saved.chat.scope;$('syncEnrollment').value=saved.chat.enrollment;$('syncSources').checked=saved.chat.sources;}
      if(saved.library){$('libraryMonitorOnStart').checked=saved.library.monitorOnStart;$('libraryMonitor').checked=saved.library.enabled&&saved.hasInventory;}
      $('restoreHint').textContent='Saved workspace settings restored. Confirm to activate monitoring in this browser. Stop other writers to the same Vault first.';
      $('restoreHint').classList.remove('hidden');updateSyncApply();refreshLibraryControls();
    })().catch(e=>log('WARNING: Saved preferences unavailable: '+e.message)).finally(()=>{if(restoreLoading===p)restoreLoading=null;});
    restoreLoading=p;return p;
  }
  async function persistPortable(patch){
    if(!globalThis.CAEPortablePreferences||!providers.verified(state.scope)||state.currentContextPending||!state.directory||state.vaultPermission!=='granted'||pendingRestore())return;
    const account=state.scope.accountId,dir=state.directory,display=state.scope.display;
    const saved=await CAEPortablePreferences.read(dir,account,display);
    if(!saved.chat&&!saved.hasInventory&&!state.sync?.startedAt)return;
    await CAEPortablePreferences.write(dir,account,display,patch);
  }
  function syncForm() {
    return {enabled:$('syncEnabled').checked,scope:$('syncScope').value,
      enrollment:$('syncEnrollment').value,sources:$('syncEnabled').checked&&$('syncSources').checked};
  }
  function syncSaved(c=state.sync) {
    return {enabled:!!c?.enabled,scope:c?.scope||'active',
      enrollment:c?.enrollment||'tracked',sources:!!c?.enabled&&!!c?.sources};
  }
  function isSyncDirty(c=state.sync) {
    if(!state.syncLoaded)return false;
    if(pendingRestore())return true;
    const desired=syncForm(), saved=syncSaved(c);
    if(desired.enabled!==saved.enabled)return true;
    if(!desired.enabled)return false;
    return desired.scope!==saved.scope||desired.enrollment!==saved.enrollment||desired.sources!==saved.sources;
  }
  function updateSyncApply() {
    const enabled=!!state.sync?.enabled;
    const editable=state.syncLoaded&&canEditSync(state.syncAccountId);
    const pending=pendingRestore();
    $('syncApply').textContent=pending?'Apply restored settings':enabled?'Apply changes':'Apply / enable';
    $('syncApply').classList.toggle('required-action',!!pending);
    $('syncApply').disabled=applyingRestored||state.busy||!editable||!isSyncDirty();
    if(!pending)$('restoreHint').classList.add('hidden');
    $('syncPause').disabled=!editable||!enabled;
    for(const id of ['syncEnabled','syncScope','syncEnrollment'])
      $(id).disabled=state.busy||!editable;
    // Project Sources are subordinate to chat/background monitoring, including
    // unsaved form changes and restored preferences.
    if(!$('syncEnabled').checked)$('syncSources').checked=false;
    $('syncSources').disabled=state.busy||!editable||!$('syncEnabled').checked;
  }
  async function refreshSync(force=false) {
    const workspace=syncWorkspace();
    if(!workspace?.accountId){
      state.syncLoaded=false;
      $('syncStatus').textContent='Connect to a verified ChatGPT workspace first.';
      updateSyncApply();return;
    }
    const accountId=workspace.accountId;
    let c;try{c=await syncCommand('CAE_SYNC_STATUS',{accountId});}
    catch(e){if(syncWorkspace()?.accountId===accountId){state.syncLoaded=false;$('syncStatus').textContent='Monitoring status unavailable in this browser. Refresh connection status.';updateSyncApply();uiRefresh();}throw e;}
    if(syncWorkspace()?.accountId!==accountId)return; // Ignore replies from previous tabs/workspaces.
    const preserveEdits=!force&&state.syncAccountId===accountId&&isSyncDirty();
    state.sync=c;
    state.syncAccountId=accountId;
    state.syncLoaded=true;
    // Preserve unsaved changes even if focus moved off the select/checkbox.
    if(!preserveEdits&&!pendingRestore()){
      $('syncEnabled').checked=!!c.enabled;
      $('syncScope').value=c.scope||'active';
      $('syncEnrollment').value=c.enrollment||'tracked';
      $('syncSources').checked=!!c.enabled&&!!c.sources;
    }
    $('syncStatus').textContent=c.enabled
      ? `${c.status} · ${c.trackedChats||0} archived chats · ${c.queue||0} queued · ${(c.buffer?.pending||0)} buffered · ${(c.buffer?.conflicts||0)} conflicts\nVault: ${c.vaultName||'unknown'}${c.since?' · Since: '+new Date(c.since).toLocaleString():''}\n${c.message||''}`
      : (c.startedAt?'Paused. The original enrollment date is retained.':'Off in this browser. Enable in Settings; an existing verified Vault archive is sufficient.');
    if(!canEditSync(accountId))
      $('syncStatus').textContent+='\nViewing '+workspace.display+' (status only). Activate its ChatGPT tab to change settings.';
    $('accessState').textContent=c.access
      ? `Last access check: writer ${c.access.worker}; holder ${c.access.offscreen}`+
        (c.access.retained?' (handle retained)':' (not retained)')
      : 'Permission checks run for enabled workspaces. No content is stored in the access log.';
    $('syncLog').textContent=(c.logs||[]).map(x=>`[${new Date(x.at).toLocaleTimeString()}] ${x.level}: ${x.message}`).join('\n');
    $('syncLog').classList.toggle('hidden',!(c.logs||[]).length);
    updateSyncApply();uiRefresh();
    refreshVaultStatus().then(()=>discoverPreferences()).catch(()=>{});
  }
  async function applySync() {
    if(state.busy)throw new Error('Finish the current export first.');
    if(!providers.verified(state.scope)||state.currentContextPending)throw new Error('Connect to a verified workspace first.');
    if(!isSyncDirty())return;
    $('syncApply').disabled=true;
    const pending=pendingRestore()?restored:null;
    const binding={account:state.scope.accountId,dir:state.directory,tabId:state.tab?.id,display:state.scope.display};
    const libraryDesired=$('libraryMonitor').checked,monitorOnStart=$('libraryMonitorOnStart').checked;
    applyingRestored=!!pending;
    try{
      if(!$('syncEnabled').checked){await syncCommand('CAE_SYNC_PAUSE',{accountId:state.scope.accountId});}
      else{
        const dir=state.directory,scope={...state.scope},tabId=state.tab?.id,context=contextGeneration,settings=syncForm();
        if(!dir)throw new Error('Connect an existing Vault or choose a new one.');
        if(!(await ChatArchiveVault.hasPermission(dir,true)))throw new Error('Vault write permission is required.');
        if(context!==contextGeneration||!providers.verified(state.scope,scope.accountId)||state.tab?.id!==tabId||state.currentContextPending)throw Error('Workspace changed before enabling monitoring.');
        await ChatArchiveVault.rememberWorkspaceDirectory(scope.accountId,dir);
        await ChatArchiveVault.rememberDirectory(dir);
        if(context!==contextGeneration||!providers.verified(state.scope,scope.accountId)||state.currentContextPending)throw Error('Workspace changed before enabling monitoring.');
        await syncCommand('CAE_SYNC_ENABLE',{options:{accountId:scope.accountId,display:scope.display,
          tabId,scope:settings.scope,enrollment:settings.enrollment,sources:settings.sources}});
      }
      if(pending){
        if(!providers.verified(state.scope,binding.account)||state.directory!==binding.dir||state.currentContextPending)throw Error('Workspace changed during confirmation.');
        if(pending.saved.hasInventory){
          await ChatArchiveLibraryStore.bind(binding.account,binding.dir);
          await syncCommand('CAE_LIBRARY_JOB_RESTORE',{options:{accountId:binding.account,display:binding.display,tabId:binding.tabId,enabled:libraryDesired}});
        }
        if(pending.saved.export)await patchExportPreferences(pending.saved.export);
        prefs=U.preferences({...prefs,monitorOnStart});
        await chrome.storage.local.set({[U.KEY]:prefs,['cae.preferences.confirmed.'+binding.account]:true});
        restored=null;
        await refreshLibraryState(true);
      }
      await refreshSync(true);
      await persistPortable({chat:syncSaved(),library:{enabled:!!state.libraryJob?.enabled,monitorOnStart:prefs.monitorOnStart},export:exportPrefs}).catch(e=>log('WARNING: Could not save portable settings: '+e.message));
    }finally{applyingRestored=false;updateSyncApply();}
  }
  let reviewedClaims=null,reviewedBinding=null;
  function resetClaimReview(){
    reviewedClaims=null;reviewedBinding=null;$('writerClaimsConfirmed').checked=false;
    $('writerClaimsConfirm').classList.add('hidden');$('clearWriterClaims').disabled=true;
  }
  function verifiedClaimDirectory(){
    if(!state.scope?.observed||state.currentContextPending||!state.directory||state.vaultPermission!=='granted')
      throw Error('Verify the Workspace and grant Vault access first.');
    return state.directory;
  }
  $('reviewWriterClaims').addEventListener('click',async()=>{
    resetClaimReview();const button=$('reviewWriterClaims');button.disabled=true;
    try{
      const dir=verifiedClaimDirectory(),account=state.scope.accountId,context=contextGeneration;
      const rows=await deadline(ChatArchiveVault.inspectWriterClaims(dir),'Writer claim review',10000);
      if(state.directory!==dir||state.scope?.accountId!==account||context!==contextGeneration)throw Error('Workspace changed; review again.');
      reviewedClaims=rows;reviewedBinding={dir,account,context};
      $('writerClaimsStatus').textContent=rows.length?rows.length+' writer claim(s): '+ChatArchiveVault.writerClaimSummary(rows,account).map(r=>r.owner+' / '+r.workspace+' workspace / '+r.operation+' / '+(r.ageSeconds==null?'age unknown':r.ageSeconds+' s old')).join('; ')+'. Age does not prove a writer has stopped.':'No writer claims found.';
      if(rows.length)$('writerClaimsConfirm').classList.remove('hidden');
    }catch(e){$('writerClaimsStatus').textContent=e.message;fail(e);}finally{button.disabled=false;}
  });
  $('writerClaimsConfirmed').addEventListener('change',()=>{$('clearWriterClaims').disabled=!reviewedClaims?.length||!$('writerClaimsConfirmed').checked;});
  $('clearWriterClaims').addEventListener('click',async()=>{
    const rows=reviewedClaims,binding=reviewedBinding,confirmed=$('writerClaimsConfirmed').checked;resetClaimReview();
    try{
      const dir=verifiedClaimDirectory();
      if(!binding||dir!==binding.dir||state.scope.accountId!==binding.account||contextGeneration!==binding.context)throw Error('Workspace changed; review again.');
      // Do not race a timeout against deletion; wait for the actual result.
      const count=await ChatArchiveVault.clearWriterClaims(dir,rows,confirmed);
      $('writerClaimsStatus').textContent=count+' reviewed writer claim(s) removed. No archive indexes were deleted.';
      await syncCommand('CAE_SYNC_WAKE',{accountId:binding.account}).catch(()=>{});
      await syncCommand('CAE_MANUAL_WAKE',{accountId:binding.account}).catch(()=>{});
      status('Writer claims cleared. Monitoring and queued jobs can retry.');
    }catch(e){$('writerClaimsStatus').textContent=e.message;fail(e);}
  });
  let integrityReport=null,integrityBinding=null,integrityScan=null;
  function integrityCurrent(b){return b&&state.directory===b.dir&&state.scope?.accountId===b.account&&
    contextGeneration===b.context&&!state.currentContextPending&&providers.verified(state.scope);}
  function exportDiagnosticJson(value,base){
    downloadBlob(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),base+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    status('Diagnostic download started. Verify the file in browser Downloads.');
  }
  $('scanVaultIntegrity')?.addEventListener('click',async()=>{
    if(integrityScan||migrationRun)return;
    const button=$('scanVaultIntegrity'),cancel=$('cancelVaultIntegrity'),download=$('downloadVaultIntegrity'),line=$('integrityStatus');
    integrityReport=null;integrityBinding=null;download.disabled=true;button.disabled=true;cancel.classList.remove('hidden');
    const token={cancelled:false};integrityScan=token;
    try{
      const dir=verifiedClaimDirectory(),account=state.scope.accountId,context=contextGeneration,b={dir,account,context};
      if(!integrityCurrent(b))throw Error('Verify the current Workspace first.');
      const check=()=>{if(token.cancelled)throw Error('Integrity scan cancelled. No files modified.');if(!integrityCurrent(b))throw Error('Workspace changed; scan again.');};
      const full=$('integrityFull').checked;
      line.textContent=full?'Scanning and hashing indexed files…':'Scanning file names and sizes…';
      const report=await ChatArchiveVaultIntegrity.scan(dir,{accountId:account,display:state.scope.display,
        preferredPrefix:ChatArchivePaths.createLayout(state.scope.display).prefix,full,check,progress:message=>{line.textContent=message;}});
      check();integrityReport=report;integrityBinding=b;
      const c=report.counts,flags=Object.values(report.issue_counts).reduce((n,x)=>n+x,0);
      line.textContent=(report.complete?'Scan finished':'Incomplete scan')+(report.provisional?' (provisional: writers, changed indexes or incomplete evidence)':'')+
        ': '+c.chat_files+' chat files; '+c.indexed_chats+' indexed chats; '+c.missing+' missing indexed files; '+c.misplaced_chats+' misplaced chats; '+c.duplicate_chats+' duplicate chat IDs; '+c.split_projects+' split projects; '+flags+' findings. '+(full?c.hash_verified+' hashes verified.':'Hashes not checked.');
      download.disabled=false;
    }catch(e){line.textContent=String(e.message||e);if(!token.cancelled)fail(e);}
    finally{integrityScan=null;button.disabled=false;cancel.classList.add('hidden');}
  });
  $('cancelVaultIntegrity')?.addEventListener('click',()=>{if(integrityScan)integrityScan.cancelled=true;});
  $('downloadVaultIntegrity')?.addEventListener('click',()=>{
    if(!integrityReport||!integrityCurrent(integrityBinding)){integrityReport=null;integrityBinding=null;$('downloadVaultIntegrity').disabled=true;status('Workspace changed; scan again.');return;}
    exportDiagnosticJson(integrityReport,'CAE-vault-integrity');
  });
  $('downloadManualAudit')?.addEventListener('click',async()=>{
    const button=$('downloadManualAudit');button.disabled=true;
    try{
      const scope=state.scope,account=scope?.accountId,context=contextGeneration;
      if(!providers.verified(scope)||state.currentContextPending)throw Error('Verify the current Workspace first.');
      const jobs=(await ChatArchiveManualStore.list()).filter(j=>j.account===account).sort((x,y)=>String(y.created_at).localeCompare(String(x.created_at))).map(j=>({
        operation_id:j.id,mode:j.mode,destination:j.destination,status:j.status,created_at:j.created_at,finished_at:j.finished_at||null,
        workspace_prefix:j.prefix,total_chats:j.total_chats??j.items?.length??0,chats_done:j.chat_index,counts:j.counts,
        selected_ids:j.audit?.selected_ids||j.items?.map(x=>x.id)||[],audit:j.audit||null,
        detail_available:!!j.audit,delivery:j.delivery_outcome||null
      }));
      if(context!==contextGeneration||state.scope?.accountId!==account||state.currentContextPending||!providers.verified(state.scope))throw Error('Workspace changed; export diagnostics again.');
      exportDiagnosticJson({schema:'cae.manual-job-diagnostics.v1',account_id:account,extension_version:chrome.runtime.getManifest().version,
        retained_jobs:jobs.length,exported_at:new Date().toISOString(),jobs},'CAE-manual-job-diagnostics');
    }catch(e){fail(e);}finally{button.disabled=false;}
  });
  let migrationPlan=null,migrationBinding=null,migrationRun=null;
  $('planVaultMigration')?.addEventListener('click',async()=>{
    if(migrationRun||integrityScan)return;
    const button=$('planVaultMigration'),cancel=$('cancelVaultMigration'),download=$('downloadVaultMigration'),line=$('migrationStatus');
    migrationPlan=null;migrationBinding=null;download.disabled=true;button.disabled=true;
    $('scanVaultIntegrity').disabled=true;cancel.classList.remove('hidden');
    const token={cancelled:false};migrationRun=token;
    try{
      const dir=verifiedClaimDirectory(),account=state.scope.accountId,context=contextGeneration,b={dir,account,context};
      const check=()=>{if(token.cancelled)throw Error('Migration planning cancelled. No files modified.');
        if(!integrityCurrent(b))throw Error('Workspace changed; generate a new plan.');};
      check();
      if(state.sync?.enabled||state.libraryJob?.enabled||manualJob?.active||state.libraryJob?.job?.active)
        throw Error('Pause chat and Library monitoring and finish manual jobs before migration planning.');
      const live=state.listSource==='live_api'&&state.listAccountId===account&&state.listLoadedAt?
        {source:'live_api',account_id:account,captured_at:new Date(state.listLoadedAt).toISOString(),
          projects:state.projects.map(p=>({id:p.id,name:p.name})),
          chats:state.chats.map(c=>({id:c.id,title:c.title,projectId:c.projectId,project:c.project,gptId:c.gptId,gptName:c.gptName,containerObserved:c.containerObserved===true}))}:null;
      line.textContent='Reading and hashing local files; no writes…';
      const report=await CAEVaultMigrationV2.plan(dir,{accountId:account,display:state.scope.display,
        preferredPrefix:ChatArchivePaths.createLayout(state.scope.display).prefix,live,check,progress:message=>{line.textContent=message;}});
      check();migrationPlan=report;migrationBinding=b;
      const c=report.counts;
      line.textContent=(report.status==='blocked'?'Review blocked items':'Plan ready for review')+
        ': '+c.files+' files, '+c.containers+' containers, '+c.blocked_files+' blocked files, '+c.blockers+' blocking findings. Target: '+(report.target_prefix||'unresolved')+
        '. No files changed.';
      download.disabled=false;
    }catch(e){line.textContent=String(e.message||e);if(!token.cancelled)fail(e);}
    finally{migrationRun=null;button.disabled=false;$('scanVaultIntegrity').disabled=false;cancel.classList.add('hidden');}
  });
  $('cancelVaultMigration')?.addEventListener('click',()=>{if(migrationRun)migrationRun.cancelled=true;});
  $('downloadVaultMigration')?.addEventListener('click',()=>{
    if(!migrationPlan||!integrityCurrent(migrationBinding)){migrationPlan=null;migrationBinding=null;$('downloadVaultMigration').disabled=true;status('Workspace changed; generate a new plan.');return;}
    exportDiagnosticJson(migrationPlan,'CAE-vault-migration-v2');
  });
  let diagnosticsText=null;
  async function collectAccessDiagnostics(){
    const local={schema:'cae.connection-diagnostics.v1',extensionVersion:chrome.runtime.getManifest?.().version||'unknown',
      exportedAt:new Date().toISOString(),surface:SURFACE,online:navigator.onLine!==false,
      workspaceVerified:providers.verified(state.scope)&&!state.currentContextPending,bridgeConnected:!!state.port,
      vaultSelected:!!(state.directory||state.vaultCandidate),vaultBound:!!state.directory,
      vaultPermission:state.vaultPermission,vaultErrorName:state.vaultErrorName||null,monitoringKnown:state.syncLoaded,
      monitoringEnabled:state.syncLoaded?!!state.sync?.enabled:null,connectionCode:state.lastConnectionCode,
      controllerCode:state.lastControllerCode,controllerCommand:state.lastControllerCommand,workerAvailable:false};
    try{local.workerReport=await syncCommand('CAE_VAULT_DIAGNOSTICS',{accountId:state.scope?.accountId});local.workerAvailable=true;}
    catch(e){local.controllerCode=connectionCode(e);local.controllerCommand='CAE_VAULT_DIAGNOSTICS';}
    if(state.directory&&state.vaultPermission==='granted'&&typeof ChatArchiveVault.inspectWriterClaims==='function'){
      try{local.writerClaims=ChatArchiveVault.writerClaimSummary(await deadline(ChatArchiveVault.inspectWriterClaims(state.directory),'Writer claim diagnostics',5000),state.scope?.accountId);}
      catch(e){local.writerClaimsError=connectionCode(e);}
    }
    diagnosticsText=JSON.stringify(local,null,2)+'\n';return diagnosticsText;
  }
  function showDiagnosticsText(text){
    const area=$('accessDiagnosticsText');area.value=text;area.classList.remove('hidden');area.focus();area.select();
  }
  $('exportAccessDiagnostics').addEventListener('click',async()=>{
    const button=$('exportAccessDiagnostics');button.disabled=true;
    try{
      const json=await collectAccessDiagnostics();
      const id=await chrome.downloads.download({url:'data:application/json;charset=utf-8,'+encodeURIComponent(json),
        filename:'CAE-access-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',saveAs:false,conflictAction:'uniquify'});
      status('Diagnostic download accepted; verifying completion…');
      const until=Date.now()+15000;
      while(Date.now()<until){
        const rows=await deadline(chrome.downloads.search({id}),'Diagnostic download status',3000);
        const item=rows?.[0];
        if(item?.state==='complete'){status('Access diagnostics saved.');return;}
        if(item?.state==='interrupted'){showDiagnosticsText(json);status('Diagnostic download interrupted ('+(item.error||'unknown')+'). Copy the report instead.');return;}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      status('Diagnostic download not yet confirmed. Check browser Downloads or copy the report.');
    }catch(error){if(diagnosticsText)showDiagnosticsText(diagnosticsText);fail(error);}finally{button.disabled=false;}
  });
  $('copyAccessDiagnostics').addEventListener('click',async()=>{
    const button=$('copyAccessDiagnostics');button.disabled=true;
    try{
      const json=diagnosticsText||await collectAccessDiagnostics();
      try{await navigator.clipboard.writeText(json);status('Access diagnostics copied.');}
      catch{showDiagnosticsText(json);status('Select and copy the diagnostic JSON (Ctrl+C).');}
    }catch(e){fail(e);}finally{button.disabled=false;}
  });
  $('syncApply').addEventListener('click',()=>applySync().catch(e=>{fail(e);refreshSync(true).catch(()=>{});}));
  $('syncPause').addEventListener('click',async()=>{
    if(!canEditSync(state.syncAccountId))return;
    try{await syncCommand('CAE_SYNC_PAUSE',{accountId:state.scope.accountId});await refreshSync(true);}catch(e){fail(e);}
  });
  for(const id of ['syncEnabled','syncScope','syncEnrollment','syncSources'])
    $(id).addEventListener('change',updateSyncApply);
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes['cae.background.v1']){refreshSync().catch(()=>{});if(state.mode==='all'&&uiView==='export')refreshChatVault().catch(()=>{});}
  });
  // Permission revalidation is passive and never opens a dialog on tab focus.
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      refreshVaultStatus().catch(()=>{});
      scheduleReconnect();
      if (state.scope){refreshSync().catch(()=>{});refreshSharedActivity().catch(()=>{});if(state.mode==='library'&&uiView==='export')refreshLibraryState(true,true).catch(()=>{});}
    }
  });
  window.addEventListener('focus',()=>{refreshVaultStatus().catch(()=>{});if(!providers.verified(state.scope)&&state.autoFailures>5){state.autoFailures=0;state.nextAutoAttempt=0;}scheduleReconnect();});
  // Remote profile writes do not emit chrome.storage.onChanged in this
  // browser. Visible panels re-read shared metadata, not the provider API.
  if(SURFACE!=='popup')setInterval(()=>{
    if(document.visibilityState!=='visible'||state.currentContextPending||!providers.verified(state.scope)||state.vaultPermission!=='granted')return;
    refreshSharedActivity().catch(()=>{});
    if(uiView==='export'&&state.mode==='library')refreshLibraryState(true,false).catch(()=>{});
    if(uiView==='export'&&state.mode==='all')refreshChatVault(true).catch(()=>{});
  },30000);
  window.addEventListener('online',()=>{state.autoFailures=0;state.nextAutoAttempt=0;scheduleReconnect(300,true);ensureExportPreferences().catch(()=>{});});
  chrome.tabs.onActivated?.addListener(info=>{
    const ownWindow=state.tab?.windowId??uiWindowId;
    if(sourceTabId||Number.isInteger(info?.windowId)&&Number.isInteger(ownWindow)&&info.windowId!==ownWindow)return;
    if(info?.tabId===state.tab?.id&&!state.currentContextPending)return;
    contextGeneration++;state.currentContextPending=true;
    const bound=messageSelection||messageLoadBinding;
    if(Number.isInteger(info?.tabId)&&(bound?info.tabId!==bound.tabId:messageAutoAccount&&selectorActive()))invalidateMessageSelection('Checking active conversation…',true);
    else clearMessageAutoTimer();
    refreshButtons();state.nextAutoAttempt=0;state.autoFailures=0;scheduleReconnect(250,true);
  });
  chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{
    const ownWindow=state.tab?.windowId??uiWindowId;
    if(sourceTabId&&tabId!==sourceTabId||Number.isInteger(tab?.windowId)&&Number.isInteger(ownWindow)&&tab.windowId!==ownWindow)return;
    const bound=messageSelection||messageLoadBinding;
    if (tab?.active&&(change.url||change.status==='complete')) {
      // The URL change already caused a recheck. Do not interrupt a verified
      // selector read on a redundant document-load completion event.
      if(!change.url&&bound&&tabId===state.tab?.id&&state.port&&!state.currentContextPending)return;
      contextGeneration++;state.currentContextPending=true;clearMessageAutoTimer();
      if(change.url&&(bound||messageAutoAccount&&selectorActive()))invalidateMessageSelection('Checking active conversation…',true);
      refreshButtons();
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
    if(intent.mode==='settings')route('settings');else if(intent.mode==='monitor')route('activity');else if(['all','current','library'].includes(intent.mode)){mode(intent.mode);if(intent.mode==='all'&&intent.refresh)ensureListLoaded(true).catch(fail);}
    if(intent.mode==='current'&&intent.selectMessages===true){
      // A stale intent must never select messages from whichever tab happened
      // to become active later. Scope and conversation are checked after load.
      if(Date.now()-Number(intent.at)>5*60_000)return;
      loadMessageSelection({accountId:intent.accountId,conversationId:intent.conversationId,tabId:intent.tabId}).catch(fail);
    }
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
    if(pendingRestore()){updateSyncApply();return;}
    try{await syncCommand('CAE_LIBRARY_JOB_MONITOR',{accountId:libraryAccount(),enabled:$('libraryMonitor').checked});await refreshLibraryState();await persistPortable({library:{enabled:!!state.libraryJob?.enabled,monitorOnStart:prefs.monitorOnStart}});}catch(e){fail(e);refreshLibraryControls();}
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
      clearTimeout(libraryStatusTimer);libraryStatusTimer=setTimeout(()=>{refreshLibraryState().catch(fail);refreshSharedActivity(true).catch(()=>{});},200);
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
  $('exportCurrent').addEventListener('click', () => currentChat().catch(fail));
  $('exportSelected').addEventListener('click', () => {
    const items=state.chats.filter(c=>state.selected.has(c.id));
    if(items.length!==state.selected.size){status('Selection contains chats missing from the current list. Refresh Chats and review the selection before exporting.');return;}
    exportChats(items,{selectionCount:state.selected.size});
  });
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
    if(area==='local'&&changes['cae.manual-status.v1']){refreshManual().catch(()=>{});refreshSharedActivity(true).catch(()=>{});if(state.mode==='all'&&uiView==='export')refreshChatVault().catch(()=>{});}
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
  $('quickVault').addEventListener('click',()=>currentChat('vault').catch(fail));
  $('currentSelect').addEventListener('change',()=>patchExportPreferences({completeConversation:$('currentSelect').checked}).catch(fail));
  $('exportMenuToggle').addEventListener('click',()=>setExportMenu($('exportContentMenu').classList.contains('hidden')));
  $('exportMenuToggle').addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();setExportMenu(true,true);}});
  $('exportAll').addEventListener('change',()=>patchExportPreferences(Object.fromEntries(EXPORT_FIELDS.map(k=>[k,$('exportAll').checked]))).catch(fail));
  for(const node of document.querySelectorAll('[data-export-field]'))node.addEventListener('change',()=>patchExportPreferences({[node.dataset.exportField]:node.checked}).catch(fail));
  document.addEventListener('click',event=>{if(!event.target.closest('.export-split'))setExportMenu(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('exportContentMenu').classList.contains('hidden')){setExportMenu(false);$('exportMenuToggle').focus();}});
  for(const node of document.querySelectorAll('[data-message-selection]'))node.addEventListener('click',()=>selectMessageRows(node.dataset.messageSelection));
  $('reloadMessages').addEventListener('click',()=>loadMessageSelection().catch(fail));
  $('downloadMessages').addEventListener('click',()=>downloadMessageSelection().catch(fail));
  $('openChats').addEventListener('click',()=>openPanel('all'));$('openFiles').addEventListener('click',()=>openPanel('library'));
  $('openMonitor').addEventListener('click',()=>openPanel('monitor'));$('modeMonitor').addEventListener('click',()=>route('activity'));
  $('openStableSettings').addEventListener('click',()=>openOptions('settings'));
  for(const id of ['headerReconnect','toolsReconnectVault'])$(id).addEventListener('click',()=>grantVaultAccess().catch(fail));
  for(const id of ['themeSelect','autoClosePanel','widgetEnabled','libraryMonitorOnStart'])$(id).addEventListener('change',()=>{if(id==='libraryMonitorOnStart'&&pendingRestore()){updateSyncApply();return;}savePreferences().then(()=>id==='libraryMonitorOnStart'?persistPortable({library:{enabled:!!state.libraryJob?.enabled,monitorOnStart:prefs.monitorOnStart}}):null).catch(fail);});
  for(const id of ['chatContainer','chatArchived'])$(id).addEventListener('change',renderChats);
  for(const id of ['libraryOrigin','libraryMedia','libraryArchiveFilter'])$(id).addEventListener('change',renderLibrary);
  $('keepPanelOpen').addEventListener('change',uiRefresh);
  $('refreshStatus').addEventListener('click',()=>Promise.all([refreshManual(),refreshSync(),refreshVaultStatus(),refreshLibraryState(true),refreshSharedActivity(true)]).then(()=>status('Cached job and Vault status refreshed. No inventory scan.')).catch(fail));
  $('showWidget').addEventListener('click',()=>syncCommand('CAE_UI_TOGGLE_WIDGET',{tabId:state.tab?.id})
    .then(r=>status(r?.shown?'Widget shown. Click again to hide it.':'Widget hidden.'))
    .catch(fail));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes[U.KEY]){prefs=U.preferences(changes[U.KEY].newValue);applyPreferences();}
    if(area==='local'&&changes[EXPORT_PREFS_KEY]){
      const value=changes[EXPORT_PREFS_KEY].newValue;
      if(value===undefined)exportStoredRevision=-1;
      if(acceptExportPreferences(value))applyExportPreferences();
    }
    if(area==='session'&&SURFACE==='panel'&&changes['cae.ui.intent.'+uiWindowId])consumeIntent(changes['cae.ui.intent.'+uiWindowId].newValue);
  });
  chrome.storage.local.get(U.KEY).then(r=>{prefs=U.preferences(r[U.KEY]);applyPreferences();}).catch(()=>{});
  ensureExportPreferences().catch(error=>fail(Error('Export settings unavailable: '+(error?.message||error))));
  if(['settings','tools','activity'].includes(location.hash.slice(1))&&SURFACE!=='panel')uiView=location.hash.slice(1);
  applyModeView(state.mode);
})();
