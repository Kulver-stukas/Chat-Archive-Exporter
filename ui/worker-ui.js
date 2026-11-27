/* UI routing and cached-state observer only. Frozen archive engines are never modified. */
(function(root){
  'use strict';
  const U=root.CAEUIState,host=/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i;
  const bindings=new Map(),verification=new Map();let iconTimer=null,iconBusy=false,iconAgain=false;
  // Standalone tests load this module separately; keep the same strict boundary
  // as worker.js, including options pages that have a sender.tab.
  function contextOf(sender){
    if(sender?.id!==chrome.runtime.id)return '';
    const url=String(sender.url||'').split(/[?#]/)[0];
    if(['panel.html','popup.html','options.html'].some(p=>url===chrome.runtime.getURL(p)))return 'ui';
    if(Number.isInteger(sender.tab?.id)&&sender.frameId===0&&host.test(url)&&host.test(sender.tab.url||''))return 'chat';
    return '';
  }
  async function bounded(stage,work,ms=6000){
    let timer;
    try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error(stage+' timed out.')),ms);
    })]);}
    catch(e){throw Object.assign(Error(stage+' unavailable.'),{code:e?.code||(/timed out/i.test(e?.message||'')?'TIMEOUT':'UNAVAILABLE')});}
    finally{clearTimeout(timer);}
  }
  const safeLine=v=>String(v??'').replace(/https?:\/\/\S+/gi,'[URL]').replace(/\bBearer\s+\S+/gi,'[credential]')
    .replace(/\b(?:sig|token|access_token)=[^&\s]+/gi,'[signature]').replace(/[\u0000-\u0008\u000b-\u001f]/g,' ').slice(0,360);
  const formatLogs=(entries,n=12)=>Array.isArray(entries)?entries.slice(-n).map(x=>{
    const time=x?.at?new Date(x.at).toLocaleTimeString():'';
    return (time?'['+time+'] ':'')+(x?.level?x.level+': ':'')+safeLine(x?.message??x?.text??'');
  }).filter(Boolean):[];
  async function bindTab(tabId){
    const tab=await chrome.tabs.get(tabId);if(!host.test(tab?.url||'')||tab.discarded)throw Error('Open an authenticated ChatGPT tab.');
    const bridge=await bounded('ChatGPT bridge',()=>root.ChatArchiveTabBootstrap.ensure(tabId),8000);
    if(bridge?.ok===false)throw Object.assign(Error('ChatGPT bridge unavailable.'),{code:'BRIDGE_UNAVAILABLE'});
    const rpc=root.ChatArchiveSyncRPC.connect(tabId,25000);
    try{
      const s=await rpc.call('CAE_STATUS',{force:true});
      if(!s.observed||!s.accountId)throw Object.assign(Error('Workspace could not be verified.'),{code:'WORKSPACE_UNVERIFIED'});
      const current=await chrome.tabs.get(tabId);if(current.url!==tab.url)throw Error('Tab changed during verification.');
      const b={accountId:s.accountId,display:String(s.display||'Workspace').slice(0,150),url:tab.url,at:Date.now()};
      bindings.set(tabId,b);return b;
    }finally{rpc.close();}
  }
  async function ensureBound(sender){
    const tabId=sender.tab?.id;
    if(!Number.isInteger(tabId))throw Error('A verified ChatGPT tab is required.');
    const b=bindings.get(tabId);
    if(b?.url===sender.tab.url&&Date.now()-b.at<5*60_000)return b;
    // MV3 workers lose Map state when suspended. Recheck account identity on
    // demand rather than requiring Popup/Side Panel to wake and rebind it.
    if(!verification.has(tabId)){
      const pending=bindTab(tabId).finally(()=>verification.delete(tabId));
      verification.set(tabId,pending);
    }
    return verification.get(tabId);
  }
  const historyRetries=new Map();
  async function workspaceHistory(accountId,display,force=false){
    const A=root.ChatArchiveWorkspaceActivity;if(!A||!root.ChatArchiveLibraryStore.validId(accountId))return null;
    // Backfill terminal local receipts from older versions as well as retries
    // after contention. Active jobs/queues are never published or imported.
    if(!historyRetries.has(accountId)||Date.now()-historyRetries.get(accountId)>30000){
      historyRetries.set(accountId,Date.now());
      await root.ChatArchiveManualJobs.shareLatest?.(accountId).catch(()=>{});
      await root.ChatArchiveLibraryJobs.shareLatest?.(accountId).catch(()=>{});
    }
    const r=await A.read(accountId,display,force);
    return r?{account_id:accountId,manual:r.manual?{finished_at:r.manual.finished_at,summary:A.summary(r.manual)}:null,
      library:r.library?{finished_at:r.library.finished_at,summary:A.summary(r.library)}:null}:null;
  }
  function preferSaved(local,receipt,finished){return !!receipt&&!local?.active&&(!local||!finished||Date.parse(receipt.finished_at)>Date.parse(finished));}
  async function widgetState(sender){
    let b;
    try {b=await ensureBound(sender);}catch(e){return {verified:false,label:'Reconnecting',busy:false,
      monitoringSummary:'Workspace verification temporarily unavailable. Retrying automatically.',
      connectionCode:['AUTH_REQUIRED','SESSION_TIMEOUT','NETWORK_ERROR','SESSION_INVALID_RESPONSE','WORKSPACE_UNVERIFIED','BRIDGE_UNAVAILABLE'].includes(e?.code)?e.code:'CONNECTION_UNAVAILABLE',reconnecting:true};}
    if(b.url!==sender.tab.url)return {verified:false,label:'Workspace changed',busy:false};
    const results=await Promise.allSettled([
      bounded('Manual job status',()=>root.ChatArchiveManualJobs.inspect()),
      bounded('Library status',()=>root.ChatArchiveLibraryJobs.inspect(b.accountId,false)),
      bounded('Monitoring status',()=>root.ChatArchiveSync.inspect(b.accountId)),
      bounded('Saved workspace activity',()=>workspaceHistory(b.accountId,b.display)).catch(()=>null)]);
    const [manual,library,sync,history]=results.map(r=>r.status==='fulfilled'?r.value:null);
    const known=results.map(r=>r.status==='fulfilled');
    const m=manual?.accountId===b.accountId?manual:null;
    const a=U.activity(m,library,sync);
    const task=U.running(m)?{kind:'Chat export',done:m.chatsDone||0,total:m.totalChats||0}:U.running(library?.job)?
      {kind:library.job.kind==='archive'?'File archive':'Library inventory',done:library.job.files_done||library.job.checked||0,total:library.job.total_files||library.job.total_details||0}:null;
    let vault='Not connected',vaultPermission='no_handle';
    let vaultError=null;
    try{
      // Reuse the writer's failure observation instead of querying another handle on every widget poll.
      if(sync?.enabled&&sync.access?.checkedAt&&sync.access.worker==='error'){
        vaultPermission='error';vault=String(sync.vaultName||'Vault')+' - Permission check failed';vaultError=sync.access.workerErrorName||sync.access.errorName||'PermissionError';
      }else{
      const dir=await bounded('Vault handle lookup',()=>root.ChatArchiveVault.restoreWorkspaceDirectory(b.accountId));
      if(dir){
        const p=await bounded('Vault permission check',()=>root.ChatArchiveVault.permissionState(dir));vaultPermission=p.state;
        const bgGranted=sync?.enabled&&sync?.access?.worker==='granted'&&sync?.access?.offscreen==='granted';
        const label={granted:'Connected',prompt:bgGranted?'Background connected (confirm here)':'Confirmation required',denied:'Access denied',error:'Permission check failed',unsupported:'Permission check unsupported'};
        vault=String(dir.name||'Vault')+' - '+(label[p.state]||'Access unknown');
        if(p.state==='error')vaultError=p.errorName||'PermissionError';
      }
      }
    }catch(e){vault='Access status unavailable';vaultPermission='unknown';vaultError=e.code||'UNAVAILABLE';}
    const warning=vaultError?'Vault access check: '+vaultError:!known.slice(0,3).every(Boolean)?'One or more controller statuses unavailable.':'';
    const savedManual=preferSaved(m,history?.manual,m?.finishedAt||m?.updatedAt);
    const savedLibrary=preferSaved(library?.job,history?.library,library?.job?.finished_at);
    const manualSummary=savedManual?history.manual.summary:!known[0]?'Unknown':m?`${U.humanStatus(m)} - ${safeLine(m.message||'')}. Chats: ${m.chatsDone||0}/${m.totalChats||0}, ${m.counts?.failed||0} failed.`:'No manual export recorded.';
    const librarySummary=savedLibrary?history.library.summary:!known[1]?'Unknown':library?.job?`${U.humanStatus(library.job)}: ${safeLine(library.job.detail||'')}`:'No Library task recorded.';
    const syncSummary=!known[2]?'Unknown':sync?.enabled?`${safeLine(sync.status||'idle')} · ${sync.trackedChats||0} archived chats · ${sync.queue||0} queued · ${sync.buffer?.pending||0} buffered · ${sync.buffer?.conflicts||0} conflicts`:'Off';
    return {verified:true,scope_stale:false,canExport:/\/c\/[0-9a-f-]{36}/i.test(sender.tab.url||''),
      workspace:b.display,label:a.busy?a.label:warning?'Needs attention':a.label,icon:a.icon,busy:a.busy,monitoring:known[1]&&known[2]?a.monitoring:null,vault,vaultPermission,task,warning,
      monitoringSummary:!known[1]||!known[2]?'Monitoring status partially unavailable':a.monitoring?'Monitoring enabled; waiting for changes':'Monitoring disabled',
      manualSummary,librarySummary,syncSummary,
      syncVault:sync?.vaultName||'',syncSince:sync?.since||null,syncMessage:safeLine(sync?.message||''),
      logs:{manual:savedManual?[history.manual.summary]:formatLogs(m?.logs,12),inventory:savedLibrary?[history.library.summary]:formatLogs(library?.events,12),monitoring:formatLogs(sync?.logs,16)}};
  }
  async function vaultChatList(accountId,display){
    const C=root.CAEUIChatListCache;
    if(!C||!root.ChatArchiveLibraryStore.validId(accountId))throw Error('Invalid workspace.');
    const cfg=root.ChatArchiveSync._state?.()?.workspaces?.[accountId]||null;
    let prefix=cfg?.prefix||root.ChatArchivePaths.createLayout(display).prefix;
    let ledger=null,mirror=null;
    // No permission prompt, migration or write. If this UI context cannot read
    // the user's Vault, try the already verified background mirror instead.
    try{
      const dir=await root.ChatArchiveVault.restoreWorkspaceDirectory(accountId);
      if(dir&&(await root.ChatArchiveVault.permissionState(dir))?.state==='granted'){
        if(!cfg?.prefix)prefix=await root.ChatArchiveVault.resolveWorkspacePrefix(dir,prefix,accountId);
        ledger=await root.ChatArchiveVault.readJson(dir,root.ChatArchiveVault.workspaceIndexPath(prefix));
      }
    }catch(_e){}
    try{mirror=await root.ChatArchiveSyncSpool.readMirror(accountId,prefix);}catch(_e){}
    return C.fromIndex(ledger,mirror,accountId,prefix);
  }
  async function ensureWidget(tabId){
    const t=await chrome.tabs.get(tabId);if(!host.test(t?.url||'')||t.discarded)throw Error('Activate a ChatGPT tab first.');
    await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:['ui/widget.js'],world:'ISOLATED'});
    return t;
  }
  async function openExtensionSettings(tabId,section){
    const base=chrome.runtime.getURL('options.html');const target=base+'?tab='+tabId+'#'+section;
    const existing=(await chrome.tabs.query({})).find(t=>(t.url||'').startsWith(base));
    if(existing?.id){await chrome.tabs.update(existing.id,{url:target,active:true});
      if(existing.windowId&&chrome.windows?.update)await chrome.windows.update(existing.windowId,{focused:true});
      return {opened:true,reused:true};
    }
    await chrome.tabs.create({url:target});return {opened:true,reused:false};
  }
  async function icon(){
    if(iconBusy){iconAgain=true;return;}iconBusy=true;
    try{
      const [m,records,local]=await Promise.all([root.ChatArchiveManualJobs.inspect(),root.ChatArchiveLibraryStore.list(),chrome.storage.local.get('cae.background.v1')]);
      const sync=Object.values(local['cae.background.v1']?.workspaces||{});
      const states=[U.activity(m,null,null),...records.map(c=>U.activity(null,c,null)),...sync.map(c=>U.activity(null,null,c))];
      const busy=states.some(a=>a.busy),blocked=states.some(a=>a.blocked),monitoring=states.some(a=>a.monitoring);
      const label=busy?'REC':blocked?'WARN':'IDLE';
      const title=busy?'Recording':blocked?'Needs attention':monitoring?'Idle - monitoring enabled':'Idle';
      // The browser's own action badge remains legible at toolbar sizes; it is
      // deliberately larger than a small glyph baked into a 16px bitmap.
      if(chrome.action?.setIcon)await chrome.action.setIcon({path:{16:'icons/cae-base-16.png',32:'icons/cae-base-32.png'}});
      if(chrome.action?.setBadgeBackgroundColor)await chrome.action.setBadgeBackgroundColor({color:busy?'#bd3030':blocked?'#687583':'#227e49'});
      if(chrome.action?.setBadgeTextColor)await chrome.action.setBadgeTextColor({color:'#ffffff'});
      if(chrome.action?.setBadgeText)await chrome.action.setBadgeText({text:label});
      if(chrome.action?.setTitle)await chrome.action.setTitle({title:'Chat Archive Exporter - '+title});
    }catch(e){console.warn('CAE status icon:',e?.message||e);}finally{iconBusy=false;if(iconAgain){iconAgain=false;scheduleIcon();}}
  }
  function scheduleIcon(){clearTimeout(iconTimer);iconTimer=setTimeout(icon,180);}
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&['cae.manual-status.v1','cae.library-status.v1','cae.background.v1'].some(k=>changes[k]))scheduleIcon();
    if(area==='local'&&changes[U.KEY]?.newValue?.widgetEnabled){
      chrome.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*']}).then(async tabs=>{
        for(const tab of tabs)if(tab.id&&!tab.discarded)await ensureWidget(tab.id).catch(()=>{});
      }).catch(()=>{});
    }
  });
  chrome.tabs.onRemoved?.addListener(id=>{bindings.delete(id);verification.delete(id);});
  chrome.tabs.onUpdated?.addListener((id,change)=>{if(change.url||change.status==='loading'){bindings.delete(id);verification.delete(id);}});
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!message?.type?.startsWith('CAE_UI_')||sender.id!==chrome.runtime.id)return false;
    const context=contextOf(sender);
    if(!context||message.target)return false;
    const fromPage=context==='chat';
    let work;
    try{
      if(message.type==='CAE_UI_BIND'&&!fromPage){
        work=chrome.tabs.get(message.tabId).then(t=>{
          if(host.test(t.url||'')&&message.observed&&root.ChatArchiveLibraryStore.validId(message.accountId))
            bindings.set(t.id,{accountId:message.accountId,display:String(message.display||'Workspace').slice(0,150),url:t.url,at:Date.now()});
          return {ok:true};
        });
      }else if(message.type==='CAE_UI_WIDGET_BIND'&&fromPage){work=widgetState(sender);}
      else if(message.type==='CAE_UI_WIDGET_STATUS'&&fromPage){work=widgetState(sender);}
      else if(message.type==='CAE_UI_CHAT_CACHE'&&!fromPage){work=vaultChatList(message.accountId,message.display);}
      else if(message.type==='CAE_UI_WORKSPACE_HISTORY'&&!fromPage){work=workspaceHistory(message.accountId,message.display,message.force===true);}
      else if(['CAE_UI_SHOW_WIDGET','CAE_UI_TOGGLE_WIDGET'].includes(message.type)&&!fromPage){
        work=ensureWidget(message.tabId).then(()=>chrome.tabs.sendMessage(message.tabId,
          {type:message.type==='CAE_UI_TOGGLE_WIDGET'?'CAE_UI_WIDGET_TOGGLE':'CAE_UI_WIDGET_SHOW'},{frameId:0}));
      }else if(message.type==='CAE_UI_OPEN_SETTINGS'&&fromPage){
        const section=['settings','activity','tools'].includes(message.section)?message.section:'settings';
        work=openExtensionSettings(sender.tab.id,section);
      }else if(message.type==='CAE_UI_OPEN_PANEL'&&fromPage){
        const mode=['all','library','monitor','settings'].includes(message.mode)?message.mode:'all',windowId=sender.tab.windowId;
        // Opening remains directly tied to the user's click; no async provider call.
        const saving=chrome.storage.session.set({['cae.ui.intent.'+windowId]:{mode,at:Date.now(),nonce:crypto.randomUUID()}});
        const opening=chrome.sidePanel.open({windowId});
        work=Promise.all([saving,opening]).then(()=>({opened:true}));
      }else return false;
      Promise.resolve(work).then(result=>sendResponse({ok:true,result}),e=>sendResponse({ok:false,error:String(e?.message||e)}));
    }catch(e){sendResponse({ok:false,error:String(e?.message||e)});}
    return true;
  });
  scheduleIcon();
})(globalThis);
