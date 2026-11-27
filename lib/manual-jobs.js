/* v0.1.6.6: durable manual export controller. The UI submits intent, never owns
 * execution. One accepted job at a time, sequential item checkpoints, no tokens.
 * Same-origin content scripts perform ALL authenticated provider requests. */
(function(root){
  'use strict';
  const S=ChatArchiveManualStore,V=ChatArchiveVault,P=ChatArchivePaths;
  const ALARM='cae-manual-exports-v1',STATUS='cae.manual-status.v1';
  const TERMINAL=new Set(['completed','completed_with_warnings','completed_not_saved','cancelled','failed']);
  const WAIT_MS=60000,GAP=1400,MAX_CHAT=12*1024*1024;
  let running=false,current=null,rpc=null,timer=null,serial=Promise.resolve();
  const cancelledIds=new Set();
  const providers=root.ChatArchiveProviders, isUrl=providers.isLegacyUrl;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const validAccount=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(s);
  const error=(code,message)=>Object.assign(Error(message),{code});
  const clean=s=>String(s||'').replace(/https?:\/\/\S+/g,'[URL omitted]').slice(0,500);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const iso=()=>new Date().toISOString();
  function note(j,message,level='info'){
    j.logs ||= [];j.logs.push({at:iso(),level,message:clean(message)});j.logs=j.logs.slice(-100);j.message=clean(message);
    if(level==='warning'){j.warnings ||= [];const m=clean(message);if(!j.warnings.includes(m))j.warnings.push(m);j.warnings=j.warnings.slice(-400);}
  }
  function publicState(j){if(!j)return null;return {id:j.id,accountId:j.account,workspace:j.display,mode:j.mode,destination:j.destination,
    status:j.status,phase:j.phase,message:j.message||'',active:!TERMINAL.has(j.status),createdAt:j.created_at,updatedAt:j.updated_at,
    totalChats:j.total_chats??j.items.length,chatsDone:j.chat_index,counts:j.counts,metadata:j.metadataCounts,
    sources:j.attachmentReport?.counts||j.sourceReport?.counts||null,sourcesDone:j.attachment_index??j.source_index??0,totalSources:j.total_attachments??j.attachmentJobs?.length??j.total_sources??j.sourceJobs?.length??0,
    selection:j.exportSelection?{...j.exportSelection,messageIds:undefined}:null,
    nextAttempt:j.next_at||0,filename:j.filename||null,downloadId:j.download_id??null,
    logs:j.logs||[],cancelRequested:!!j.cancel_requested,stagedBytes:j.staged_bytes||0,
    deliveryOutcome:j.delivery_outcome||null};}
  async function save(j){j.updated_at=iso();await S.put(j);await chrome.storage.local.set({[STATUS]:publicState(j)});}
  function browserSaveCancelled(reason){return /USER_CANCELLED|USER_CANCELED|user[\s_-]+cancel(?:ed|led)|cancel(?:ed|led)\s+by\s+(?:the\s+)?user/i.test(String(reason||''));}
  function queue(fn){const p=serial.catch(()=>{}).then(fn);serial=p.catch(()=>{});return p;}
  async function active(){return (await S.list()).filter(j=>!TERMINAL.has(j.status));}
  async function hasActive(){return (await active()).length>0;}
  async function inspect(){if(current)return publicState(current);const list=await S.list();const j=list.find(x=>!TERMINAL.has(x.status))||list.sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];return publicState(j);}
  function wake(delay=300){if(timer)return;timer=setTimeout(()=>{timer=null;tick().catch(console.warn);},delay);}
  async function alarms(){if(await hasActive()){if(!(await chrome.alarms.get(ALARM)))await chrome.alarms.create(ALARM,{periodInMinutes:1});}
    else {await chrome.alarms.clear(ALARM);clearTimeout(timer);timer=null;}}
  function normalizedItem(x){
    if(!x||typeof x.id!=='string'||!/^[a-zA-Z0-9-]{10,100}$/.test(x.id))throw Error('Invalid selected chat ID.');
    const scalar=v=>typeof v==='string'||typeof v==='number'?v:null;
    const rawProject=P.canonical(x.projectId||'');
    const legacyGPT=P.isGPT(rawProject)?rawProject:'';
    return {id:x.id,title:String(x.title||'Untitled chat').slice(0,1000),project:String(x.project||'').slice(0,500),
      projectId:P.isProject(rawProject)?rawProject:'',gptId:P.gptId(x.gptId||legacyGPT),
      gptName:String(x.gptName||'').slice(0,250),archived:Boolean(x.archived),
      containerObserved:Boolean(x.containerObserved),created:scalar(x.created),updated:scalar(x.updated)};
  }
  function layout(j){
    // Paths are fixed after first allocation, even if later detail responses
    // discover more projects or a project is renamed while the job is running.
    const base=P.createLayout(j.display,j.projects,j.prefix),used=new Set(Object.values(j.folders||{}));j.folders ||= {};
    function projectPath(id,name){id=P.canonical(id);const k=id||'_Unassigned';if(j.folders[k])return j.folders[k];
      let path=base.projectPath(id,name),n=1;
      while(used.has(path))path=base.projectPath(id,name)+' ['+P.safe(String(id).slice(-12),12)+'-'+(++n)+']';
      used.add(path);j.folders[k]=path;return path;
    }
    for(const p of j.projects)projectPath(p.id,p.name);
    return {prefix:j.prefix,projectPath,chatPath:x=>
      (P.isGPT(x.gptId)?base.gptPath(x.gptId,x.gptName):projectPath(x.projectId,x.project))+
      '/'+P.safe(x.title||'Untitled chat',100)+' ['+P.safe(x.id,80)+'].md'};
  }
  async function submit(options){return queue(async()=>{
    const o=options||{};
    if(!S.validId(o.requestId)||!validAccount(o.accountId)||!Number.isInteger(o.tabId)||
       !['current','all','configuration'].includes(o.mode)||!['vault','download'].includes(o.destination))throw Error('Invalid manual export request.');
    const existing=await S.get(o.requestId);if(existing)return publicState(existing);
    if(await hasActive())throw Error('A manual export is already accepted. Reopen its progress or stop it before starting another.');
    if(!Array.isArray(o.items)||o.items.length>10000)throw Error('Too many selected conversations.');
    const items=[...new Map(o.items.map(x=>{const v=normalizedItem(x);return [v.id,v];})).values()];
    if(o.mode==='current'&&items.length!==1)throw Error('Current-chat export needs exactly one conversation.');
    let exportSelection=null;
    if(o.exportSelection!=null){
      if(o.mode!=='current'||o.destination!=='download')throw Error('Selective export is available for current-chat downloads only.');
      exportSelection=root.ChatArchiveExportSelection.normalize(o.exportSelection);
      if(exportSelection.conversationId!==items[0].id)throw Error('Export selection belongs to another conversation.');
      if(!['questions','answers','thinking','uploadedFiles','generatedFiles'].some(k=>exportSelection[k]))throw Error('Select at least one content category.');
    }
    const tab=await chrome.tabs.get(o.tabId);if(!isUrl(tab?.url)||tab.discarded)throw Error('A live ChatGPT tab is required to accept the export.');
    const projects=(Array.isArray(o.projects)?o.projects:[]).slice(0,2000).filter(x=>/^g-p-[a-f0-9]{32}/i.test(x?.id||''))
      .map(x=>({id:P.canonical(x.id),name:String(x.name||'').slice(0,500)}));
    const selectedProjectIds=(Array.isArray(o.selectedProjectIds)?o.selectedProjectIds:[])
      .map(P.canonical).filter(P.isProject).filter(id=>projects.some(p=>p.id===id));
    if(!items.length&&o.mode!=='configuration'&&!(o.mode==='all'&&selectedProjectIds.length))
      throw Error('Select at least one conversation or an empty Project.');
    const display=String(o.display||'Workspace '+o.accountId.slice(0,8)).slice(0,500),prefix=P.createLayout(display).prefix;
    const j={schema:'cae.manual-job.v1',id:o.requestId,account:o.accountId,display,prefix,
      tab_id:o.tabId,window_id:tab.windowId,mode:o.mode,destination:o.destination,
      fullWorkspace:o.mode==='configuration'||o.mode==='all'&&o.fullWorkspace===true,items,projects,folders:{},
      observedGpts:[...new Map(items.filter(x=>P.isGPT(x.gptId)).map(x=>[x.gptId,
        {id:x.gptId,name:x.gptName||''}])).values()],
      projectIds:[...new Set([...items.map(x=>x.projectId),...selectedProjectIds].filter(P.isProject))],
      phase:o.mode==='configuration'?'context':'chats',status:'queued',created_at:iso(),chat_index:0,source_index:0,metadata_index:0,
      counts:{saved:0,skipped:0,failed:0,conflict:0},metadataCounts:{saved:0,skipped:0,failed:0,conflict:0},
      warnings:[],logs:[],staged_bytes:0,source_budget_used:0,next_at:0,
      ...(exportSelection?{exportSelection}: {})};
    if(j.destination==='vault'){
      const dir=await S.directory(j.id);if(!dir)throw Error('Select a Vault before submitting.');
      j.vault_name=dir.name;const a=await V.permissionState(dir);
      if(a.state!=='granted')throw Error('Vault write permission is required to accept a manual job.');
      j.prefix=await V.resolveWorkspacePrefix(dir,j.prefix,j.account);
      // Freeze the directory by job ID. Never use a later global picker value.
      await root.ChatArchiveVaultContext?.ensure?.();
    }
    layout(j);note(j,'Manual export accepted. The panel may be closed.');
    await save(j);
    if(j.destination==='vault'){
      try {const h=await chrome.runtime.sendMessage({target:'cae-manual-output',type:'CAE_MANUAL_HOLD',jobId:j.id});
        if(!h?.ok)note(j,'Vault handle retention was not confirmed; permission will be rechecked before writing.','warning');
      }catch(e){note(j,'Vault holder unavailable; accepted job retained.','warning');}
      await save(j);
    }
    await alarms();wake();return publicState(j);
  });}
  async function quick(tabId){
    if(!Number.isInteger(tabId))throw Error('Activate a ChatGPT conversation.');
    const tab=await chrome.tabs.get(tabId);
    if(!isUrl(tab?.url)||tab.discarded)throw Error('A live ChatGPT conversation is required.');
    await root.ChatArchiveTabBootstrap?.ensure?.(tabId).catch(()=>{});
    const r=ChatArchiveSyncRPC.connect(tabId,25000);
    try {
      const scope=await r.call('CAE_STATUS',{force:true});
      if(!providers.verified(scope)||!validAccount(scope.accountId)||!scope.currentId)throw Error('Open a conversation in a verified ChatGPT workspace.');
      const prefs=await root.ChatArchiveExportPreferences?.get?.();
      if(prefs?.completeConversation===false)throw Error('Choose messages in the side panel using Download MD.');
      return await submit({requestId:crypto.randomUUID(),accountId:scope.accountId,display:scope.display,tabId,
        mode:'current',destination:'download',items:[{id:scope.currentId,title:'Current chat'}],projects:[],
        ...(prefs?{exportSelection:{...prefs,conversationId:scope.currentId}}:{})});
    }finally{r.close();}
  }
  async function finish(j,status){j.status=status;j.finished_at=iso();j.next_at=0;await save(j);
    // Never touch the v0.1.6.5 background-capture buffer.
    await S.clearPayload(j.id);cancelledIds.delete(j.id);j.staged_bytes=0;
    j.total_chats=j.items.length;j.total_sources=j.sourceJobs?.length||0;j.items=[];
    delete j.context;delete j.sourceJobs;delete j.object_url;delete j.folders;delete j.projects;delete j.projectIds;
    j.total_attachments=j.attachmentJobs?.length??j.total_attachments;
    delete j.attachmentJobs;delete j.selection_snapshot;
    if(j.attachmentReport)j.attachmentReport={counts:j.attachmentReport.counts,received_bytes:j.attachmentReport.received_bytes,stored_bytes:j.attachmentReport.stored_bytes};
    if(j.exportSelection)j.exportSelection={...j.exportSelection,messageIds:undefined};
    if(j.sourceReport)j.sourceReport={counts:j.sourceReport.counts,received_bytes:j.sourceReport.received_bytes,stored_bytes:j.sourceReport.stored_bytes};
    await save(j);
    await chrome.runtime.sendMessage({target:'cae-manual-output',type:'CAE_MANUAL_RELEASE',jobId:j.id}).catch(()=>{});
    const old=(await S.list()).filter(x=>TERMINAL.has(x.status)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
    for(const x of old.slice(8))await S.remove(x.id);
    const enabled=Object.values(root.ChatArchiveSync?._state?.()?.workspaces||{}).filter(x=>x.enabled).map(x=>x.account_id);
    await root.ChatArchiveVaultContext?.reconcile?.(enabled).catch(()=>{});
  }
  async function completeUnsavedBrowserDownload(j){
    // The selected chat(s) were prepared, but Chrome did not write a file.
    // This is terminal, unlike an external transfer error or uncertain state.
    j.delivery_outcome='user_cancelled_save';
    note(j,'Browser Save was canceled by the user. No download saved; temporary export data discarded.');
    await finish(j,'completed_not_saved');
  }
  async function cancel(id){if(!S.validId(id))throw Error('Invalid job ID.');cancelledIds.add(id);await S.requestCancel(id);const j=current?.id===id?current:await S.get(id);if(!j||TERMINAL.has(j.status))return publicState(j);
    j.cancel_requested=true;note(j,'Stop requested; completed Vault files are preserved.');await save(j);
    if(j.download_id!=null)await chrome.downloads.cancel(j.download_id).catch(()=>{});
    // Abort a source read via its port, not the panel's former transport.
    if(rpc)rpc.call('CAE_SOURCE_CLOSE').catch(()=>{});
    wake(100);return publicState(j);
  }
  async function resume(account){const jobs=await active();for(const j of jobs){
    if(account&&j.account!==account)continue;
    // Passive tab/permission recovery does not override deliberate retry waits,
    // storage errors, authorization backoff or an uncertain browser delivery.
    if(['queued','waiting_for_tab','permission_required'].includes(j.status)&&!(j.blocked_until>Date.now())){j.next_at=0;await save(j);}
  }wake(100);return inspect();}
  async function retry(id){const j=await S.get(id);if(!j||TERMINAL.has(j.status))throw Error('No pending manual job.');
    if(j.status==='delivery_uncertain'||j.status==='download_failed'){
      j.download_id=null;j.object_url=null;j.delivery_attempt=(j.delivery_attempt||0)+1;j.status='queued';j.phase='deliver';
    }else if(['storage_error','error'].includes(j.status)){j.status='queued';}
    if(j.status!=='cooldown')j.next_at=0;await save(j);wake();return publicState(j);
  }
  async function connect(j){
    let candidates=[];try{const t=await chrome.tabs.get(j.tab_id);if(isUrl(t.url)&&!t.discarded)candidates.push(t);}catch{}
    const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true}).catch(()=>[]);
    for(const t of tabs)if(isUrl(t.url)&&!t.discarded&&!candidates.some(x=>x.id===t.id))candidates.push(t);
    for(const t of candidates){
      await root.ChatArchiveTabBootstrap?.ensure?.(t.id).catch(()=>{});
      const r=ChatArchiveSyncRPC.connect(t.id,150000);
      try{const scope=await r.call('CAE_STATUS',{force:true});
        if(providers.verified(scope,j.account)){j.tab_id=t.id;return r;}
      }catch(e){r.close();if(e.code==='API_COOLDOWN'||e.httpStatus===429)throw e;continue;}
      r.close();
    }
    throw error('WAIT_TAB','Waiting for a live, authenticated ChatGPT tab in the original workspace.');
  }
  async function call(j,type,params={}){
    const d=root.ChatArchiveSync?._state?.();if(d?.cooldown_until>Date.now())throw Object.assign(error('API_COOLDOWN','Background API cooldown is active.'),{retryAfterMs:d.cooldown_until-Date.now()});
    const delta=Date.now()-(j.last_request_at||0);if(delta<GAP)await sleep(GAP-delta);
    if(j.cancel_requested)throw error('CANCELLED','Stopped by the user.');
    if(!rpc)rpc=await connect(j);
    j.last_request_at=Date.now();return rpc.call(type,{...params,expectedAccountId:j.account});
  }
  async function openVault(j,dir){const a=await V.permissionState(dir);
    if(a.state!=='granted')throw error('WAIT_PERMISSION','Vault access is '+a.state+'. Restore access; the accepted job is retained.');
    await root.ChatArchiveVaultContext?.ensure?.();
    await chrome.runtime.sendMessage({target:'cae-manual-output',type:'CAE_MANUAL_HOLD',jobId:j.id}).catch(()=>{});
    const v=await V.openStore(dir);await v.useWorkspace(j.prefix,j.account);return v;
  }
  function addProject(j,id,name){if(!/^g-p-/.test(id||''))return;if(!j.projectIds.includes(id))j.projectIds.push(id);
    if(!j.projects.some(x=>x.id===id))j.projects.push({id,name:name||'Project_'+id.slice(-12)});}
  async function stepSelectedChat(j){
    const item=j.items[0];
    j.message='Preparing the selected conversation.';await save(j);
    const chat=await call(j,'CAE_GET_CHAT',{chat:item});
    if(chat.id!==item.id)throw error('SELECTION_INVALID','Conversation identity changed. Reopen the message selector.');
    j.exportSelection=root.ChatArchiveExportSelection.validate(chat,j.exportSelection);
    const snapshot=new Blob([JSON.stringify(chat)],{type:'application/json'});
    if(snapshot.size>MAX_CHAT)throw error('CHAT_LIMIT','Conversation exceeds the 12 MiB selection staging limit.');
    j.attachmentJobs=root.ChatArchiveManualAttachments.plan(chat,j.exportSelection);
    j.attachment_index=0;j.attachment_budget_used=0;
    j.attachmentReport={counts:{saved:0,unavailable:0,failed:0,skipped:0,cancelled:0},received_bytes:0,stored_bytes:0,results:[]};
    j.selection_path=P.safe(chat.title||'Untitled chat',100)+' ['+P.safe(chat.id,80)+'].md';
    j.selection_snapshot=true;j.phase='attachments';
    // This internal checkpoint is never an output member. It fixes the selected
    // branch and content before a worker suspension or a global setting change.
    await S.stage(j,'selection-snapshot',j.prefix+'/_selection_snapshot.json',snapshot,{internal:true,store:false,
      sha256:ChatArchiveHash.hex(new Uint8Array(await snapshot.arrayBuffer()))});
  }
  async function stepAttachment(j){
    const a=j.attachmentJobs[j.attachment_index];
    if(!a){j.phase='selected_markdown';return;}
    const A=root.ChatArchiveManualAttachments,key='attachment:'+j.attachment_index;
    const cached=await S.entry(j.id,key);let result;
    if(cached){
      if(ChatArchiveHash.hex(new Uint8Array(await cached.blob.arrayBuffer()))!==cached.sha256)
        throw error('STAGED_CHECKSUM','Prepared attachment checksum mismatch. Stop and export again.');
      result=cached.attachmentResult;
      if(!result||result.key!==a.key)throw error('STAGED_CHECKSUM','Prepared attachment identity mismatch.');
    }else{
      const cap=Math.max(0,Math.min(A.LIMITS.maxFileBytes,A.LIMITS.maxTotalBytes-(j.attachment_budget_used||0),
        S.MAX_BYTES-S.REPORT_RESERVE-(j.staged_bytes||0)-1024*1024));
      const reservation=(a.fileId||a.sandboxPath)&&(!Number.isFinite(a.sizeBytes)||a.sizeBytes<=cap)?cap:0;
      j.attachment_budget_used+=reservation;
      j.message='Attachments '+(j.attachment_index+1)+'/'+j.attachmentJobs.length+': '+a.name;await save(j);
      const transport={start:opts=>call(j,'CAE_ATTACHMENT_START',opts),read:()=>rpc.call('CAE_SOURCE_READ'),
        close:()=>rpc?rpc.call('CAE_SOURCE_CLOSE'):Promise.resolve()};
      let received=0,downloaded=null;
      try{
        downloaded=await A.receive(a,{transport,maxBytes:cap,cancelled:()=>!!j.cancel_requested||cancelledIds.has(j.id),
          reservedPaths:[...j.attachmentJobs.map(x=>x.localPath),...j.attachmentReport.results.map(x=>x.localPath).filter(Boolean)]});
        received=downloaded.result.bytes;result=downloaded.result;
      }catch(e){
        received=Number(e.receivedBytes)||0;
        // A disconnected tab or authorization wait keeps this exact file pending.
        // Bytes spent on failed attempts still consume the durable transfer budget.
        j.attachment_budget_used=Math.max(0,j.attachment_budget_used-reservation+received);
        j.attachmentReport.received_bytes+=received;
        const unavailable=['ATTACHMENT_UNAVAILABLE','ATTACHMENT_NOT_FOUND'].includes(e.code);
        if(!unavailable&&(['API_COOLDOWN','AUTH_REQUIRED','WORKSPACE_CHANGED','WAIT_TAB'].includes(e.code)||
          [401,403,429,502,503,504].includes(e.httpStatus)||
          /disconnected|connection closed|receiving end|context invalidated/i.test(e.message||''))){
          if(e.code==='WORKSPACE_CHANGED')e=error('WAIT_TAB','Return to the original workspace to continue the selected export.');
          throw e;
        }
        const status=e.code==='CANCELLED'?'cancelled':['ATTACHMENT_LIMIT','SOURCE_LIMIT','ZIP_LIMIT'].includes(e.code)?'skipped':
          ['ATTACHMENT_UNAVAILABLE','ATTACHMENT_NOT_FOUND'].includes(e.code)||[404,410].includes(e.httpStatus)?'unavailable':'failed';
        result=A.result(a,{status,error:clean(e.message),errorCode:typeof e.code==='string'?e.code:'ATTACHMENT_ERROR',
          httpStatus:e.httpStatus||null,receivedBytes:received});
      }
      if(downloaded){
        j.attachment_budget_used=Math.max(0,j.attachment_budget_used-reservation+received);
        j.attachmentReport.received_bytes+=received;
        await S.stage(j,key,j.prefix+'/'+result.localPath,downloaded.blob,{sha256:result.sha256,attachmentResult:result,store:true});
      }
    }
    j.attachmentReport.results.push(result);
    j.attachmentReport.counts[result.status]=(j.attachmentReport.counts[result.status]||0)+1;
    if(result.status==='saved')j.attachmentReport.stored_bytes+=result.bytes;
    if(result.status!=='saved'||result.warning)note(j,'ATTACHMENT '+result.status+': '+a.name+' - '+(result.error||result.warning||'Original unavailable.'),'warning');
    j.attachment_index++;
  }
  async function stepSelectedMarkdown(j){
    const snapshot=await S.entry(j.id,'selection-snapshot');
    if(!snapshot?.internal)throw error('SELECTION_INVALID','Selected conversation checkpoint is missing. Start the export again.');
    if(ChatArchiveHash.hex(new Uint8Array(await snapshot.blob.arrayBuffer()))!==snapshot.sha256)
      throw error('STAGED_CHECKSUM','Selected conversation checkpoint checksum mismatch. Start the export again.');
    const chat=JSON.parse(await snapshot.blob.text()),A=root.ChatArchiveManualAttachments;
    root.ChatArchiveExportSelection.validate(chat,j.exportSelection);
    const results=[...j.attachmentReport.results];
    for(const a of j.attachmentJobs.slice(j.attachment_index))results.push(A.result(a,{status:'cancelled',error:'Stopped before this original was prepared.'}));
    const text=ChatArchiveNormalize.renderMarkdown(chat,{workspace:j.display,exportedAt:j.created_at,
      exportSelection:j.exportSelection,attachmentResults:results});
    const blob=new Blob([text],{type:'text/markdown;charset=utf-8'});
    if(blob.size>MAX_CHAT)throw error('CHAT_LIMIT','Selected Markdown exceeds the 12 MiB export limit.');
    await S.stage(j,'chat:'+chat.id,j.prefix+'/'+j.selection_path,blob,{store:false,sha256:ChatArchiveHash.hex(new Uint8Array(await blob.arrayBuffer()))});
    if(j.attachmentJobs.length||j.selection_partial){
      const report={schema:'cae.selected-export-report.v1',provider:'chatgpt',conversation_id:chat.id,
        branch_node:chat.branchNode||null,workspace:j.display,created_at:j.created_at,
        selection:j.exportSelection,partial:!!j.selection_partial,limits:A.LIMITS,
        counts:results.reduce((out,r)=>(out[r.status]=(out[r.status]||0)+1,out),{}),
        received_bytes:j.attachmentReport.received_bytes,stored_bytes:j.attachmentReport.stored_bytes,files:results};
      const reportBlob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
      await S.stage(j,'selection-report',j.prefix+'/export-report.json',reportBlob,{store:false,
        sha256:ChatArchiveHash.hex(new Uint8Array(await reportBlob.arrayBuffer()))});
    }
    for(const warning of chat.warnings||[])note(j,warning,'warning');
    j.selection_finalized=true;if(j.cancel_requested)j.cancel_report_written=true;
    j.chat_index=1;j.counts.saved=1;j.phase='deliver';
  }
  async function stepChat(j,v){
    if(j.exportSelection)return stepSelectedChat(j);
    const item=j.items[j.chat_index];if(!item){
      j.phase=j.mode==='all'||j.destination==='vault'?'context':'deliver';return;
    }
    const key='chat:'+item.id;let staged=await S.entry(j.id,key);
    const l=layout(j);if(v&&!staged){
      const remoteMeta=j.mode==='current'?{...item,updated:null}:item;
      const pre=await v.decideChat(remoteMeta,{key:j.account+'|'+item.id,path:l.chatPath(item)});
      if(pre.action==='skip'){j.counts.skipped++;if(pre.status==='conflict'){j.counts.conflict++;note(j,'Local chat edit preserved: '+item.title,'warning');}
        j.chat_index++;return;}
    }
    if(!staged){
      j.message='Receiving chat '+(j.chat_index+1)+'/'+j.items.length+': '+item.title;await save(j);
      const chat=await call(j,'CAE_GET_CHAT',{chat:item});
      if(chat.id!==item.id)throw Error('Conversation identity mismatch.');
      const rawPid=P.canonical(item.projectId||chat.projectId);
      const projectId=P.isProject(rawPid)?rawPid:'',project=projectId?(item.project||chat.projectName||'Project_'+projectId.slice(-12)):'';
      const gptId=P.gptId(item.gptId||chat.gptId),gptName=item.gptName||chat.gptName||'';
      addProject(j,projectId,project);
      const out={...item,title:chat.title,project,projectId,gptId,gptName,
        ...(j.mode==='current'?{created:chat.created,updated:chat.updated}:{})};const path=layout(j).chatPath(out);
      const text=ChatArchiveNormalize.renderMarkdown({...chat,projectId,archived:item.archived},
        {workspace:j.display,project,gptId,gptName});
      const blob=new Blob([text],{type:'text/markdown;charset=utf-8'});
      if(blob.size>MAX_CHAT)throw error('CHAT_LIMIT','Chat exceeds 12 MiB manual staging limit.');
      for(const w of chat.warnings||[])note(j,item.title+' - '+w,'warning');
      staged=await S.stage(j,key,path,blob,{remoteChat:out,sha256:ChatArchiveHash.hex(new Uint8Array(await blob.arrayBuffer())),store:false});
    }
    if(v){
      const body=await staged.blob.text();
      const header=await V.readChatHeader(staged.blob),ledger=await v.useWorkspace(j.prefix,j.account);
      const previous=ledger.chats[item.id],incomingVersion=V.chatTimestamp(header?.updated);
      if(previous&&Number.isFinite(previous.updated_ms)&&Number.isFinite(incomingVersion)&&previous.updated_ms>incomingVersion){
        j.counts.skipped++;j.chat_index++;note(j,'Newer Vault revision preserved: '+item.title);
        await save(j);await S.dropEntry(j,key);return;
      }
      if(ChatArchiveHash.hex(new TextEncoder().encode(body))!==staged.sha256)throw Error('Staged chat checksum mismatch.');
      // recovery=true may adopt ONLY an identical independently staged payload.
      const r=await v.writeText(staged.path,body,{kind:'chats',key:j.account+'|'+item.id,remoteChat:staged.remoteChat,recovery:true});
      const status=r.status==='recovered'?'skipped':r.status==='conflict'?'skipped':r.status;
      j.counts[status]=(j.counts[status]||0)+1;
      if(r.status==='conflict'){j.counts.conflict++;note(j,'Local chat edit preserved: '+item.title,'warning');}
    }else j.counts.saved++;
    j.chat_index++;await save(j);
    if(v)await S.dropEntry(j,key); // after disk/index + durable item acknowledgement
  }
  async function stepContext(j){
    // All manual Vault/ZIP jobs take the configuration of the *current* scope,
    // even when only one chat (or an empty project) was selected. This does not
    // authorize copying the bytes of Sources outside the selected projects.
    const fullConfiguration=j.mode==='configuration'||j.mode==='all'||j.destination==='vault';
    if(fullConfiguration||j.projectIds.length){
      j.message='Reading current workspace configuration.';await save(j);
      j.context=await call(j,'CAE_CONTEXT',{projectIds:fullConfiguration?null:j.projectIds,
        includePersonalization:fullConfiguration,includeConfiguration:fullConfiguration,
        observedGpts:j.observedGpts});
    }else j.context={captured_at:iso(),projects:[],projects_complete:true,personalization:null,
      personalization_requested:false,selection:'selected_projects',gpts:j.observedGpts||[]};
    j.context.gpts=[...new Map([...(j.observedGpts||[]),...(j.context.gpts||[])]
      .filter(x=>P.isGPT(x?.id)).map(x=>[x.id,x])).values()];
    for(const w of j.context.warnings||[])note(j,w,'warning');
    const projects=(j.context.projects||[]).map(ChatArchiveMeta.normalizeProject);
    const selectedProjects=new Set(j.projectIds);
    for(const p of projects)addProject(j,p.id,p.name);
    if(j.mode==='configuration'){
      // No conversation bodies or Source bytes: this is a metadata-only snapshot.
      j.sourceJobs=[];j.sourceReport=null;j.phase='metadata';return;
    }
    j.sourceJobs=ChatArchiveSources.plan(projects.filter(p=>j.fullWorkspace||
      selectedProjects.has(p.id)),layout(j));
    j.sourceReport={limits:j.destination==='vault'?ChatArchiveVaultTransfer.LIMITS:ChatArchiveSources.LIMITS,
      counts:{saved:0,skipped:0,changed:0,conflict:0,failed:0,cancelled:0},received_bytes:0,stored_bytes:0,results:[]};
    j.phase='sources';
  }
  async function stepSource(j,v){
    const job=j.sourceJobs[j.source_index];if(!job){j.phase='metadata';return;}
    const key='source:'+j.source_index;const cached=await S.entry(j.id,key);
    let result,received=0,stored=0;
    if(cached){result={key:job.key,project_id:job.projectId,file_id:job.fileId,name:job.name,status:'saved',local_path:job.localPath,
      sha256:cached.sha256,downloaded_bytes:cached.blob.size,expected_bytes:job.expectedBytes??null,
      size_matches:Number.isFinite(job.expectedBytes)?job.expectedBytes===cached.blob.size:null};stored=cached.blob.size;
    }else{
      const limits={...(v?ChatArchiveVaultTransfer.LIMITS:ChatArchiveSources.LIMITS)};
      const remaining=Math.max(0,limits.maxTotalBytes-(j.source_budget_used||0));
      limits.maxTotalBytes=remaining;
      const cap=Math.min(limits.maxFileBytes,remaining);
      const reservation=job.fileId&&(!Number.isFinite(job.expectedBytes)||job.expectedBytes<=cap)?cap:0;
      // Reserve the worst case before the network call, so a worker crash cannot
      // reset a repeated source transfer's operation-wide budget.
      j.source_budget_used+=reservation;j.message='Sources '+(j.source_index+1)+'/'+j.sourceJobs.length+': '+job.name;await save(j);
      const transport={start:opts=>call(j,'CAE_SOURCE_START',{...opts,vaultTransfer:!!v}),
        read:()=>rpc.call('CAE_SOURCE_READ'),close:()=>rpc?rpc.call('CAE_SOURCE_CLOSE'):Promise.resolve()};
      let lastProgress=0;
      const progress=p=>{j.message='Sources '+(j.source_index+1)+'/'+j.sourceJobs.length+': '+job.name+(p.bytes!=null?' ('+p.bytes+' bytes)':'');
        if(Date.now()-lastProgress>2000){lastProgress=Date.now();chrome.storage.local.set({[STATUS]:publicState(j)}).catch(()=>{});}
      };
      const sink={get remainingBytes(){return Math.max(0,S.MAX_BYTES-S.REPORT_RESERVE-(j.staged_bytes||0));},
        async add(f){const blob=new Blob([f.bytes??f.content]);
          await S.stage(j,key,f.path,blob,{sha256:ChatArchiveHash.hex(new Uint8Array(await blob.arrayBuffer())),store:true});}};
      const opts={transport,expectedAccountId:j.account,cancelled:()=>!!j.cancel_requested,progress,limits};
      const report=v?await ChatArchiveVaultTransfer.run([job],{...opts,vault:v}):await ChatArchiveSources.run([job],{...opts,sink});
      received=report.received_bytes;stored=report.stored_bytes;result=report.results[0];
      j.source_budget_used=Math.max(0,j.source_budget_used-reservation+received);
      if(['NotAllowedError','SecurityError'].includes(result?.error_name))throw Object.assign(Error(result.reason),{name:result.error_name});
      if(result?.status==='failed'&&/disconnected|connection closed|receiving end|context invalidated/i.test(result.reason||''))throw error('WAIT_TAB','ChatGPT connection interrupted; the source will restart after reconnection.');
      if(result?.error_code==='API_COOLDOWN'||[401,403,429,502,503,504].includes(result?.http_status))
        throw Object.assign(Error(result.reason),{code:result.error_code,httpStatus:result.http_status,retryAfterMs:result.retry_after_ms});
    }
    j.sourceReport.received_bytes+=received;j.sourceReport.stored_bytes+=stored;
    j.sourceReport.results.push(result);j.sourceReport.counts[result.status]=(j.sourceReport.counts[result.status]||0)+1;
    if(['failed','changed','conflict'].includes(result.status)||(result.status==='skipped'&&!result.local_path)||result.warning)
      note(j,'SOURCE '+result.status+': '+job.name+' - '+(result.reason||result.warning||''),'warning');
    j.source_index++;
  }
  function metadataEntries(j){
    const context=j.context||{captured_at:j.created_at,projects:[],projects_complete:false,personalization:null,
      personalization_requested:false,selection:j.fullWorkspace?'all_projects':'selected_projects'};
    return ChatArchiveMeta.entries({...context,active_scope:{account_id:j.account},warnings:[...new Set(j.warnings)],chat_counts:{...j.counts,deferred:Math.max(0,j.items.length-j.chat_index)},
      source_downloads:j.sourceReport||null},j.display,{layout:layout(j)});
  }
  async function stepMetadata(j,v){const list=metadataEntries(j),entry=list[j.metadata_index];
    if(!entry){j.phase='deliver';return;}
    const key='meta:'+j.metadata_index;let staged=await S.entry(j.id,key);
    if(!staged){
      let text=entry.content;
      if(v&&entry.path.endsWith('/_workspace_configuration.json')){
        const dir=await S.directory(j.id);
        const prior=await V.readJson(dir,entry.path);
        text=ChatArchiveMeta.mergeWorkspaceConfiguration(prior,text,j.account);
      }
      staged=await S.stage(j,key,entry.path,new Blob([text],{type:entry.path.endsWith('.json')?'application/json':'text/markdown;charset=utf-8'}),{store:false});
    }
    if(v){const r=await v.writeText(staged.path,await staged.blob.text(),{kind:'metadata',key:j.account+'|'+staged.path,recovery:true});
      const status=r.status==='recovered'?'skipped':r.status==='conflict'?'skipped':r.status;j.metadataCounts[status]++;
      if(r.status==='conflict'){j.metadataCounts.conflict++;note(j,'Local metadata edit preserved: '+staged.path,'warning');}
    }else j.metadataCounts.saved++;
    j.metadata_index++;await save(j);if(v)await S.dropEntry(j,key);
  }
  async function observeDownload(j){
    if(j.status==='delivery_uncertain'||j.status==='download_failed')return;
    let rows=[];
    if(j.download_id!=null)rows=await chrome.downloads.search({id:j.download_id});
    else if(j.object_url)rows=await chrome.downloads.search({url:j.object_url});
    const d=rows[0];
    if(!d){j.status='delivery_uncertain';note(j,'Download delivery could not be verified. Use Retry delivery only after checking browser downloads.','warning');await save(j);return;}
    j.download_id=d.id;
    if(d.state==='complete'){
      if(!j.cancel_requested)j.delivery_outcome='download_completed';
      note(j,j.cancel_requested?'Partial download completed after Stop.':'Download completed.');
      await finish(j,j.cancel_requested?'cancelled':j.warnings.length||j.counts.failed||j.sourceReport?.counts?.failed?'completed_with_warnings':'completed');
    }else if(d.state==='interrupted'){
      if(j.cancel_requested){await finish(j,'cancelled');return;}
      if(j.destination==='download'&&browserSaveCancelled(d.error)){await completeUnsavedBrowserDownload(j);return;}
      j.status='download_failed';note(j,'Browser download interrupted: '+(d.error||'unknown')+'. Staged bytes retained; use Retry delivery.','warning');await save(j);
    }else {j.status='download_pending';j.next_at=Date.now()+WAIT_MS;await save(j);}
  }
  async function deliver(j){
    if(j.destination==='vault'){
      note(j,j.cancel_requested?'Stopped. Completed Vault files retained.':'Manual Vault export completed.');
      await finish(j,j.cancel_requested?'cancelled':j.warnings.length||j.counts.failed||j.sourceReport?.counts?.failed?'completed_with_warnings':'completed');
      root.ChatArchiveSync?.wake?.(500);return;
    }
    if(j.download_id!=null||j.status==='download_starting'||j.status==='download_pending')return observeDownload(j);
    if(!j.staged_bytes){note(j,'No file was prepared for download.');await finish(j,j.cancel_requested?'cancelled':'failed');return;}
    await ChatArchiveVaultContext.ensure();
    const reply=await chrome.runtime.sendMessage({target:'cae-manual-output',type:'CAE_MANUAL_PREPARE',jobId:j.id});
    if(!reply?.ok)throw Error(reply?.error||'Offscreen download preparation failed.');
    const u=new URL(reply.result.url);if(u.protocol!=='blob:'||!u.href.startsWith('blob:'+chrome.runtime.getURL('')))throw Error('Unexpected download object URL.');
    j.object_url=reply.result.url;j.filename=reply.result.filename;j.status='download_starting';await save(j);
    // Persist intent BEFORE Chrome accepts the download. Startup reconciles the
    // recorded URL with download history instead of blindly creating a duplicate.
    try{j.download_id=await chrome.downloads.download({url:j.object_url,filename:j.filename,saveAs:false,conflictAction:'uniquify'});}
    catch(e){
      if(j.cancel_requested){await finish(j,'cancelled');return;}
      if(browserSaveCancelled(e?.message||e)){await completeUnsavedBrowserDownload(j);return;}
      j.status='download_failed';note(j,'Browser did not accept the download: '+e.message,'warning');await save(j);return;
    }
    j.status='download_pending';j.next_at=Date.now()+WAIT_MS;await save(j);await observeDownload(j);
  }
  async function onError(j,e){
    if(j.exportSelection&&(['INVALID_SELECTION','EMPTY_SELECTION','SELECTION_CHANGED','SELECTION_INVALID','SELECTION_STALE','SELECTION_EMPTY','CHAT_LIMIT','STAGED_CHECKSUM'].includes(e.code)||String(e.code||'').startsWith('EXPORT_SELECTION'))){
      note(j,clean(e.message),'warning');await finish(j,j.cancel_requested?'cancelled':'failed');return;
    }
    if(j.cancel_requested||e.code==='CANCELLED'){
      if(j.phase==='deliver'){note(j,'Stopped; partial delivery did not finish: '+clean(e.message),'warning');await finish(j,'cancelled');}
      else {j.status='queued';j.next_at=0;await save(j);}
      return;
    }
    const recoverable=['WAIT_TAB','WAIT_PERMISSION','VAULT_BUSY','API_COOLDOWN','AUTH_REQUIRED'].includes(e.code)||
      ['NotAllowedError','SecurityError'].includes(e.name)||[401,403,429,502,503,504].includes(e.httpStatus)||
      /disconnected|connection closed|receiving end|context invalidated/i.test(e.message||'');
    if(!recoverable)j.attempts=(j.attempts||0)+1;
    if(e.code==='WAIT_TAB'||/disconnected|connection closed|receiving end|context invalidated/i.test(e.message||'')){j.status='waiting_for_tab';j.next_at=Date.now()+WAIT_MS;j.message=e.message;}
    else if(e.code==='VAULT_BUSY'){j.status='queued';j.next_at=Date.now()+3000+Math.floor(Math.random()*3000);j.message=clean(e.message);}
    else if(e.code==='WAIT_PERMISSION'||['NotAllowedError','SecurityError'].includes(e.name)){j.status='permission_required';j.next_at=Date.now()+WAIT_MS;j.message=clean(e.message);}
    else if(e.code==='API_COOLDOWN'||[429,502,503,504].includes(e.httpStatus)){
      const delay=Math.max(60000,Number(e.retryAfterMs)||60000)+1500;
      j.status='cooldown';j.blocked_until=Date.now()+delay;j.next_at=j.blocked_until;
      note(j,'API cooldown; this job will resume after '+new Date(j.next_at).toISOString()+'.','warning');
      await root.ChatArchiveSync?.deferNetwork?.(j.next_at);
    }else if(e.code==='AUTH_REQUIRED'||[401,403].includes(e.httpStatus)){
      j.status='authorization_required';j.next_at=Date.now()+5*WAIT_MS;note(j,'ChatGPT authorization is required; job retained.','warning');
    }else if(e.code==='CHAT_LIMIT'){
      note(j,clean(e.message)+'; this chat was not exported.','warning');j.counts.failed++;j.chat_index++;j.status='queued';j.next_at=0;j.attempts=0;
    }else if(e.name==='QuotaExceededError'||e.code==='ZIP_LIMIT'){
      j.status='storage_error';j.next_at=Number.MAX_SAFE_INTEGER;note(j,'Staging storage limit/error; no background captures removed. Stop or retry a smaller selection.','warning');
    }else if(j.attempts<3){j.status='retry_wait';j.next_at=Date.now()+Math.min(300000,10000*2**j.attempts);note(j,clean(e.message)+'; step retained for retry.','warning');}
    else {
      note(j,clean(e.message)+'; item failed.','warning');
      if(j.exportSelection&&j.phase==='chats'){
        j.counts.failed++;await finish(j,'failed');return;
      }
      if(j.phase==='chats'){j.counts.failed++;j.chat_index++;j.status='queued';j.next_at=0;j.attempts=0;}
      else if(j.phase==='metadata'){j.metadataCounts.failed++;j.metadata_index++;j.status='queued';j.next_at=0;j.attempts=0;}
      else {j.status='error';j.next_at=Number.MAX_SAFE_INTEGER;}
    }
    await save(j);
  }
  async function tick(){
    if(running)return;
    if(root.ChatArchiveSync?.isRunning?.()){wake(2000);return;}
    running=true;let unlock=null,shared=null;
    try{
      const jobs=await active();const j=jobs[0];if(!j)return;current=j;
      j.cancel_requested ||= cancelledIds.has(j.id)||!!(await S.cancelled(j.id));
      if(j.cancel_requested&&['delivery_uncertain','download_failed'].includes(j.status)){
        note(j,'Stopped after uncertain/interrupted delivery. No additional download was started.');
        await finish(j,'cancelled');return;
      }
      if(j.status==='download_starting'||j.status==='download_pending'){await observeDownload(j);return;}
      if(['download_failed','delivery_uncertain','storage_error','error'].includes(j.status)&&!j.cancel_requested)return;
      if(j.next_at>Date.now()&&!j.cancel_requested)return;
      if(j.blocked_until>Date.now()&&!j.cancel_requested){j.status='cooldown';j.next_at=j.blocked_until;await save(j);return;}
      unlock=await V.acquireLock(true);if(!unlock){wake(2000);return;}
      let v=null;
      if(j.destination==='vault'&&!j.cancel_requested&&j.phase!=='deliver'){
        const dir=await S.directory(j.id);
        if((await V.permissionState(dir)).state!=='granted')throw error('WAIT_PERMISSION','Vault access unavailable; accepted job retained.');
        shared=await V.acquireVaultGuard(dir,unlock,{workspaceId:j.account,jobId:j.id,operation:'manual_export'});v=await openVault(j,dir);
      }
      j.status='running';j.next_at=0;await save(j);
      const start=Date.now();let n=0;
      while(n++<4&&Date.now()-start<22000&&!TERMINAL.has(j.status)){
        j.cancel_requested ||= cancelledIds.has(j.id);
        if(j.cancel_requested){
          if(j.destination==='vault'){await finish(j,'cancelled');break;}
          note(j,'Stopped by the user; delivering the prepared subset only.','warning');
          if(j.exportSelection){
            if(!j.selection_snapshot){await finish(j,'cancelled');break;}
            j.selection_partial=true;j.phase=j.selection_finalized&&j.cancel_report_written?'deliver':'selected_markdown';
          }else{
          // No more provider calls after Stop. A partial ZIP includes an explicit report.
          if(j.mode==='all'&&!j.cancel_report_written){
            const text='# Partial export\n\nStopped by the user. This is not a full workspace archive.\n\n'+
              '- Chats selected: '+j.items.length+'\n- Chats prepared: '+j.counts.saved+
              '\n- Chats not processed: '+Math.max(0,j.items.length-j.chat_index)+
              '\n- Chat failures: '+j.counts.failed+
              '\n- Sources prepared: '+(j.sourceReport?.counts?.saved||0)+
              '\n- Sources not processed: '+Math.max(0,(j.sourceJobs?.length||0)-j.source_index)+
              '\n\nOnly files already prepared are included. Unreceived Sources and project metadata may be absent.\n';
            try{await S.stage(j,'partial-report',j.prefix+'/_archive_report.md',new Blob([text]),{store:false});}
            catch(e){note(j,'Partial report could not be staged; the partial filename still identifies this subset.','warning');}
            j.cancel_report_written=true;
          }
          j.phase='deliver';
          }
        }
        const phase=j.phase;
        try{
          if(phase==='chats')await stepChat(j,v);
          else if(phase==='attachments')await stepAttachment(j);
          else if(phase==='selected_markdown')await stepSelectedMarkdown(j);
          else if(phase==='context')await stepContext(j);
          else if(phase==='sources')await stepSource(j,v);
          else if(phase==='metadata')await stepMetadata(j,v);
          else if(phase==='deliver'){await deliver(j);break;}
          else throw Error('Unknown manual export phase.');
          j.attempts=0;await save(j);
        }catch(e){await onError(j,e);break;}
      }
    }catch(e){if(current)await onError(current,e).catch(console.warn);else console.warn(e);}
    finally{
      rpc?.close();rpc=null;try{await shared?.();}catch(e){console.warn(e.message);}finally{unlock?.();}current=null;running=false;
      await alarms();const jobs=await active();if(jobs.some(j=>j.next_at<=Date.now()&&!['error','storage_error','download_failed','delivery_uncertain','download_pending','download_starting'].includes(j.status)))wake(500);
    }
  }
  async function startup(){
    for(const j of await S.list()){
      if(TERMINAL.has(j.status)){await S.clearPayload(j.id);continue;}
      // Migrate rev.4 pending Save-dialog cancellations after extension update.
      // Match the CURRENT failure text, not old log entries from a prior retry.
      if(j.destination==='download'&&j.status==='download_failed'&&browserSaveCancelled(j.message)){
        if(j.cancel_requested)await finish(j,'cancelled');
        else await completeUnsavedBrowserDownload(j);
      }
    }
    await alarms();const jobs=await active();
    if(jobs.length){
      await root.ChatArchiveVaultContext?.ensure?.();
      for(const j of jobs)if(j.destination==='vault')
        await chrome.runtime.sendMessage({target:'cae-manual-output',type:'CAE_MANUAL_HOLD',jobId:j.id}).catch(()=>{});
      wake(300);
    }
  }
  async function downloadChanged(delta){if(!delta?.state)return;for(const j of await active())if(j.download_id===delta.id){
    if(running){wake(300);return;}await tick();
  }}
  root.ChatArchiveManualJobs={ALARM,STATUS,submit,quick,inspect,cancel,resume,retry,tick,startup,wake,hasActive,downloadChanged,
    isRunning:()=>running,publicState};
})(globalThis);
