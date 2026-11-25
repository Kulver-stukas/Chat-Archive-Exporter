importScripts('lib/export-selection.js','lib/export-preferences.js','lib/normalize.js','lib/config-inventory.js','lib/hash.js','lib/paths.js','lib/meta.js','lib/sources.js',
  'lib/vault.js','lib/vault-transfer.js','lib/sync-policy.js','lib/sync-spool.js','lib/sync-rpc.js','lib/vault-context.js','lib/vault-diagnostics.js','lib/sync.js','lib/tab-bootstrap.js','lib/manual-store.js','lib/manual-attachments.js','lib/manual-jobs.js',
  'lib/library-inventory.js','lib/library-policy.js','lib/library-store.js','lib/library-vault.js','lib/library-jobs.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type?.startsWith('CAE_EXPORT_PREFS_')){
    if(sender.id!==chrome.runtime.id||sender.tab||message.target)return false;
    const prefs=globalThis.ChatArchiveExportPreferences;
    const run=message.type==='CAE_EXPORT_PREFS_GET'?()=>prefs.get():
      message.type==='CAE_EXPORT_PREFS_PATCH'?()=>prefs.patch(message.patch):null;
    if(!run)return false;
    Promise.resolve().then(run).then(result=>sendResponse({ok:true,result}),
      e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;
  }
  if (message?.type?.startsWith('CAE_LIBRARY_JOB_')) {
    if(sender.id !== chrome.runtime.id || sender.tab || message.target)return false;
    const L=globalThis.ChatArchiveLibraryJobs;
    const actions={
      CAE_LIBRARY_JOB_START:()=>L.start(message.options||{}),
      CAE_LIBRARY_JOB_STATUS:()=>L.inspect(message.accountId,message.withCatalog!==false),
      CAE_LIBRARY_JOB_STOP:()=>L.stop(message.accountId),
      CAE_LIBRARY_JOB_MONITOR:()=>L.monitor(message.accountId,message.enabled===true),
      CAE_LIBRARY_JOB_RESUME:()=>L.resume(message.accountId),
      CAE_LIBRARY_JOB_ARCHIVE:()=>L.submitArchive(message.options||{})
    };
    if(!actions[message.type])return false;
    actions[message.type]().then(result=>sendResponse({ok:true,result}),e=>sendResponse({ok:false,error:String(e?.message||e)}));
    return true;
  }
  // The manual controller accepts commands only from extension UI pages.
  if (message?.type?.startsWith('CAE_MANUAL_')) {
    if (sender.id !== chrome.runtime.id || message.target) return false;
    if (sender.tab && message.type !== 'CAE_MANUAL_QUICK') return false;
    const commands = {
      CAE_MANUAL_QUICK: async () => {
        const tabId=sender.tab?.id ?? (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.id;
        return ChatArchiveManualJobs.quick(tabId);
      },
      CAE_MANUAL_SUBMIT: () => ChatArchiveManualJobs.submit(message.options),
      CAE_MANUAL_STATUS: () => ChatArchiveManualJobs.inspect(),
      CAE_MANUAL_CANCEL: () => ChatArchiveManualJobs.cancel(message.jobId),
      CAE_MANUAL_RETRY: () => ChatArchiveManualJobs.retry(message.jobId),
      CAE_MANUAL_WAKE: () => ChatArchiveManualJobs.resume(message.accountId)
    };
    if (!commands[message.type]) return false;
    commands[message.type]().then(result => sendResponse({ok:true,result}),
      e => sendResponse({ok:false,error:String(e?.message||e)}));
    return true;
  }
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'CAE_OPEN_PANEL') {
    const tabId=sender.tab?.id;
    if(!tabId){sendResponse({ok:false,error:'ChatGPT tab not found.'});return false;}
    const opened=chrome.sidePanel.open({tabId});
    chrome.storage.session.set({caeInitialMode:message.mode==='all'?'all':'current'}).catch(()=>{});
    opened.then(()=>sendResponse({ok:true}),e=>sendResponse({ok:false,error:e.message}));return true;
  }
  const commands=new Set(['CAE_SYNC_ENABLE','CAE_SYNC_PAUSE','CAE_SYNC_STATUS','CAE_SYNC_WAKE','CAE_SYNC_HELLO','CAE_SYNC_SIGNAL','CAE_VAULT_READY','CAE_VAULT_DIAGNOSTICS','CAE_ENSURE_TAB']);
  if(!commands.has(message?.type))return false;
  // A content script can report activity, never enable sync or change its Vault.
  if(sender.tab&&!['CAE_SYNC_HELLO','CAE_SYNC_SIGNAL'].includes(message.type))return false;
  const operation=async()=>{
    if(message.type==='CAE_SYNC_ENABLE'){
      const result=await ChatArchiveSync.enable(message.options||{});
      return result;
    }
    if(message.type==='CAE_SYNC_PAUSE'){
      const result=await ChatArchiveSync.pause(message.accountId);
      return result;
    }
    if(message.type==='CAE_VAULT_READY'){
      const result=await ChatArchiveSync.accessReady(message.accountId);
      await ChatArchiveManualJobs.resume(message.accountId);
      return result;
    }
    if(message.type==='CAE_VAULT_DIAGNOSTICS'){
      await ChatArchiveSync.probeAccess(message.accountId,'export_diagnostics').catch(()=>{});
      return await ChatArchiveVaultDiagnostics.report();
    }
    if(message.type==='CAE_SYNC_STATUS')return await ChatArchiveSync.inspect(message.accountId);
    if(message.type==='CAE_ENSURE_TAB'){
      // Only an extension UI may request a recovery, and the tab-bootstrap
      // module itself enforces the narrow ChatGPT host allowlist.
      if(!Number.isInteger(message.tabId))throw new Error('Invalid tab ID.');
      return await globalThis.ChatArchiveTabBootstrap.ensure(message.tabId,{force:true});
    }
    if(message.type==='CAE_SYNC_WAKE')return await ChatArchiveSync.resume(message.accountId);
    if(!sender.tab)return null;
    if(message.type==='CAE_SYNC_HELLO')return await ChatArchiveSync.armTab(sender.tab.id);
    return await ChatArchiveSync.signal(sender.tab.id,message);
  };
  operation().then(result=>sendResponse({ok:true,result}),e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{
  if(a.name===ChatArchiveSync.ALARM)ChatArchiveSync.tick().catch(console.warn);
  if(a.name===globalThis.ChatArchiveLibraryJobs?.ALARM)ChatArchiveLibraryJobs.tick().catch(console.warn);
  if(a.name===ChatArchiveManualJobs.ALARM)ChatArchiveManualJobs.tick().catch(console.warn);
});
chrome.downloads.onChanged.addListener(d=>ChatArchiveManualJobs.downloadChanged(d).catch(console.warn));
let lastAccessEvent=0;
function observeEnabledAccess(event){
  if(Date.now()-lastAccessEvent<15000)return;
  lastAccessEvent=Date.now();
  const list=Object.values(ChatArchiveSync._state()?.workspaces||{}).filter(c=>c.enabled);
  for(const c of list)ChatArchiveSync.probeAccess(c.account_id,event).catch(()=>{});
}
async function ensureAndArm(tabId) {
  // The tab may have been open across a Web Store update. A failed ping is
  // recovered by injection, not by reloading or navigating the user's page.
  await globalThis.ChatArchiveTabBootstrap?.ensure(tabId).catch(()=>{});
  await ChatArchiveSync.armTab(tabId).catch(()=>{});
  await ChatArchiveManualJobs.resume().catch(()=>{});
}
chrome.tabs.onActivated.addListener(x=>{
  ensureAndArm(x.tabId).catch(()=>{});observeEnabledAccess('tab_activated');
});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(tab.active && change.status==='complete') {
    // Let document_idle declarative injection complete on fresh navigation.
    setTimeout(()=>ensureAndArm(id).catch(()=>{}),700);
  } else if(tab.active&&change.url) ChatArchiveSync.armTab(id).catch(()=>{});
});
chrome.windows.onFocusChanged.addListener(async id=>{
  observeEnabledAccess(id===chrome.windows.WINDOW_ID_NONE?'window_blur':'window_focus');
  if(id===chrome.windows.WINDOW_ID_NONE)return;
  const tabs=await chrome.tabs.query({active:true,windowId:id}).catch(()=>[]);
  for(const t of tabs)ensureAndArm(t.id).catch(()=>{});
});
const startBackground=async()=>{
  await ChatArchiveSync.startup();
  await ChatArchiveManualJobs.startup();
  await globalThis.ChatArchiveLibraryJobs?.startup();
};
chrome.runtime.onStartup.addListener(()=>startBackground().catch(console.warn));
chrome.runtime.onInstalled.addListener(info=>{
  startBackground().catch(console.warn);
  if(['install','update'].includes(info?.reason))
    globalThis.ChatArchiveTabBootstrap?.eligibleOpenTabs().catch(()=>{});
});
// Recreate a missing alarm on every worker start, but only for enabled configs.
startBackground().catch(console.warn);

// Passive panel lifecycle observation only. An open Port is not used as an
// artificial keepalive; there are no heartbeats. A dormant worker can restart.
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='cae-panel-lifecycle'||port.sender?.id!==chrome.runtime.id||
    String(port.sender?.url||'').split('?')[0]!==chrome.runtime.getURL('panel.html'))return;
  let account=null,lastSignature='',lastAt=0;
  port.onMessage.addListener(msg=>{
    if(msg?.type!=='bind'||typeof msg.accountId!=='string'||!/^[a-zA-Z0-9_-]{3,120}$/.test(msg.accountId))return;
    const signature=msg.accountId+'|'+String(msg.permission);
    if(signature===lastSignature&&Date.now()-lastAt<15000)return;
    const event=account===msg.accountId?'panel_state':'panel_open';
    account=msg.accountId;lastSignature=signature;lastAt=Date.now();
    ChatArchiveSync.probeAccess(account,event,{panelState:msg.permission,
      userActivation:msg.userActivation===true}).catch(()=>{});
  });
  port.onDisconnect.addListener(()=>{
    const ignored=chrome.runtime.lastError?.message; // acknowledge expected close
    if(account)ChatArchiveSync.probeAccess(account,'panel_disconnect').catch(()=>{});
  });
});

// v0.1.7: UI-only observer/routing; archive engines remain unchanged.
importScripts('ui/state.js','ui/chat-list-cache.js','ui/worker-ui.js');
