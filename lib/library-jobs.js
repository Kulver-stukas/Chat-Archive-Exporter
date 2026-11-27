/* Durable, workspace-bound Library inventory and explicit asset archival.
 * The panel is a view only. Alarms recover checkpoints after worker suspension.
 * Polling lists is not re-enrichment: old file descriptors are never polled.
 */
(function(root){
  'use strict';
  const S=root.ChatArchiveLibraryStore,V=root.ChatArchiveLibraryVault,I=root.ChatArchiveLibraryInventory,
    P=root.ChatArchiveLibraryPolicy,FS=root.ChatArchiveVault;
  const ALARM='cae-library-maintenance-v1', POLL_MS=5*60_000, MAX_NODES=15000, MAX_PAGES=120, MAX_FOLDERS=700;
  const MAX_FILE=512*1024*1024, MAX_BATCH=1024*1024*1024;
  const iso=()=>new Date().toISOString(),err=(code,message)=>Object.assign(Error(message),{code});
  const terminal=new Set(['complete','cancelled','error']);
  let chain=Promise.resolve(),run=null,rpc=null,activeAccount=null,timer=null;
  const stopped=new Set();
  const serial=fn=>{const p=chain.catch(()=>{}).then(fn);chain=p.catch(()=>{});return p;};
  function active(c){return !!c?.job&&!terminal.has(c.job.status);}
  function note(c,text){c.events=(c.events||[]).concat({at:iso(),text}).slice(-40);}
  async function save(c){
    c.revision=(c.revision||0)+1;await S.put(c);
    await chrome.storage.local.set({'cae.library-status.v1':{account_id:c.account_id,revision:c.revision,at:iso()}});
  }
  function view(c,includeCatalog=true){
    if(!c)return null;
    const j=c.job;
    return {account_id:c.account_id,display:c.display,enabled:!!c.enabled,baseline_at:c.baseline_at||null,
      inventory_path:c.prefix?V.paths(c).inventory:null,last_poll_at:c.last_poll_at||null,next_poll_at:c.next_poll_at||null,
      revision:c.revision,catalog_revision:c.catalog_revision||0,events:c.events||[],catalog:includeCatalog?(c.catalog||null):undefined,
      report:includeCatalog?(c.last_report||null):undefined,
      job:j?{id:j.id,kind:j.kind,status:j.status,phase:j.phase,detail:j.detail||'',active:active(c),
        nodes:j.nodes?.length||0,images:j.images?.length||0,checked:j.detail_index||0,total_details:j.targets?.length||0,
        files_done:j.archive_index||0,total_files:j.selected_ids?.length||0,next_at:j.next_at||null,
        error:j.error||null,started_at:j.started_at,finished_at:j.finished_at||null}:null};
  }
  async function inspect(account,withCatalog=true){return view(await S.get(account),withCatalog);}
  async function alarm(){
    const configs=await S.list();
    if(configs.some(c=>c.enabled||active(c))){
      if(!(await chrome.alarms.get(ALARM)))await chrome.alarms.create(ALARM,{periodInMinutes:1});
    }else await chrome.alarms.clear(ALARM);
  }
  function wake(delay=100){clearTimeout(timer);timer=setTimeout(()=>{timer=null;tick().catch(console.warn);},delay);}
  function checkpoint(c){if(stopped.has(c.account_id))throw err('CANCELLED','Stopped by the user.');}
  async function connect(c){
    const candidates=[];
    try {const t=await chrome.tabs.get(c.tab_id);if(t&&!t.discarded&&/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(t.url||''))candidates.push(t);}catch{}
    const list=await chrome.tabs.query({active:true,lastFocusedWindow:true}).catch(()=>[]);
    for(const t of list)if(!candidates.some(x=>x.id===t.id)&&!t.discarded&&/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(t.url||''))candidates.push(t);
    for(const t of candidates){
      checkpoint(c);await root.ChatArchiveTabBootstrap?.ensure?.(t.id).catch(()=>{});
      const r=root.ChatArchiveSyncRPC.connect(t.id,90000);
      try {const s=await r.call('CAE_STATUS',{force:true});
        if(s.observed&&s.accountId===c.account_id){c.tab_id=t.id;return r;}
      }catch(e){r.close();if(e.code==='API_COOLDOWN')throw e;continue;}r.close();
    }
    throw err('WAIT_TAB','Keep an authenticated ChatGPT tab open in the original workspace.');
  }
  async function call(c,type,args={}){
    checkpoint(c);
    const globalCooldown=root.ChatArchiveSync?._state?.()?.cooldown_until||0;
    if(globalCooldown>Date.now())throw Object.assign(err('API_COOLDOWN','ChatGPT API cooldown is active.'),{retryAfterMs:globalCooldown-Date.now()});
    if(!rpc)rpc=await connect(c);
    const result=await rpc.call(type,{...args,expectedAccountId:c.account_id});checkpoint(c);return result;
  }
  const page=(c,query)=>call(c,'CAE_LIBRARY_PAGE',{query});
  function job(kind){return {id:crypto.randomUUID(),kind,status:'queued',phase:'projects',started_at:iso(),next_at:0,
    cursor:null,seen_cursors:[],projects:[],refs:[],project_index:0,nodes:[],images:[],
    directories:[{id:null,depth:0,cursor:null,seen:[],pages:0}],directory_index:0,seen_directories:[],
    details:{},detail_errors:{},detail_index:0,targets:[],warnings:[],links_partial:false,
    counts:{library_pages:0,image_pages:0,project_pages:0,descriptors_cached:0,descriptors_excluded:0,descriptors_not_needed:0}};}
  function advanceCursor(j,next){
    if(next&&j.seen_cursors.includes(next))throw err('PAGINATION','Repeated pagination cursor; collection is incomplete.');
    if(next)j.seen_cursors.push(next);j.cursor=next;
  }
  async function start(o){return serial(async()=>{
    if(!S.validId(o?.accountId)||!Number.isInteger(o.tabId))throw Error('A verified ChatGPT workspace is required.');
    let c=await S.get(o.accountId);
    if(active(c))throw Error('A Library job is already active. Stop it before starting another.');
    if(c?.job?.pending_asset)await recoverAsset(c);
    stopped.delete(o.accountId);
    const dir=await S.directory(o.accountId);
    if(!dir)throw Error('Choose a Vault first.');
    if(!c)c={schema:'cae.library-state.v1',account_id:o.accountId,display:String(o.display||'Workspace '+o.accountId.slice(0,8)).slice(0,250),
      prefix:await FS.resolveWorkspacePrefix(dir,root.ChatArchivePaths.createLayout(o.display||'Workspace '+o.accountId.slice(0,8)).prefix,o.accountId),enabled:false};
    c.tab_id=o.tabId;
    await V.directory(c);
    const r=await connect(c);r.close();
    const existing=await V.load(c);
    if(existing){c.baseline_at=existing.baseline_at;c.catalog=existing.catalog;c.catalog_revision=(c.catalog_revision||0)+1;}
    // A missing snapshot never enables implicit backfill or automatic reseeding.
    else {c.baseline_at=null;c.catalog=null;c.enabled=false;c.catalog_revision=(c.catalog_revision||0)+1;}
    c.job=job('manual');c.job.expected_commit=existing?.commit_id??null;c.job.monitor_after_save=o.monitor===true;c.job.detail='Manual inventory accepted; the panel may be closed.';
    note(c,c.job.detail);await save(c);await alarm();wake();return view(c);
  });}
  async function stop(account){
    if(!S.validId(account))throw Error('Invalid workspace ID.');
    stopped.add(account);
    if(activeAccount===account){rpc?.close();rpc=null;}
    return serial(async()=>{const c=await S.get(account);if(!c)return null;
      c.enabled=false;if(active(c)){c.job.status='cancelled';c.job.finished_at=iso();c.job.detail='Stopped; previously committed files and inventory are preserved.';}
      note(c,'Library scan stopped; new-file monitoring is paused.');await save(c);await alarm();return view(c);});
  }
  // Import an existing inventory, without starting a scan or downloading originals.
  async function restore(o){return serial(async()=>{
    if(!S.validId(o?.accountId)||!Number.isInteger(o.tabId))throw Error('Verified workspace required.');
    const prior=await S.get(o.accountId);
    if(prior&&active(prior))throw Error('Finish the current Library job first.');
    const dir=await S.directory(o.accountId);
    if(!dir)throw Error('Connect the Library Vault first.');
    const prefix=await FS.resolveWorkspacePrefix(dir,root.ChatArchivePaths.createLayout(o.display).prefix,o.accountId);
    const c=prior||{schema:'cae.library-state.v1',account_id:o.accountId,display:String(o.display||'Workspace').slice(0,250),prefix,enabled:false};
    if(c.prefix!==prefix)throw Error('Library archive folder changed.');
    c.tab_id=o.tabId;
    const r=await connect(c);r.close();
    const saved=await V.load(c);
    if(!saved)throw Error('No existing Library inventory. Start a manual inventory first.');
    c.baseline_at=saved.baseline_at;c.catalog=saved.catalog;c.catalog_revision=(c.catalog_revision||0)+1;
    c.enabled=o.enabled===true;c.next_poll_at=Date.now()+POLL_MS;
    stopped.delete(c.account_id);note(c,'Existing Library inventory restored.');
    await save(c);await alarm();return view(c);
  });}
  async function monitor(account,enabled){return serial(async()=>{
    const c=await S.get(account);if(!c?.baseline_at)throw Error('Save a manually started inventory to Vault first.');
    if(active(c))throw Error('Stop or finish the current Library job before changing monitoring.');
    if(enabled){await V.directory(c);const saved=await V.load(c);if(!saved)throw Error('The Library snapshot is missing from Vault.');stopped.delete(account);}
    c.enabled=!!enabled;c.next_poll_at=Date.now()+POLL_MS;
    note(c,enabled?'New-file metadata monitoring enabled (five-minute list checks).':'New-file metadata monitoring paused.');
    await save(c);await alarm();return view(c);
  });}
  async function resume(account){return serial(async()=>{
    const c=await S.get(account);if(!c||!c.job||['complete','cancelled'].includes(c.job.status))return view(c);
    if(c.job.status==='cooldown'&&c.job.next_at>Date.now())return view(c);
    stopped.delete(account);c.job.status='queued';c.job.next_at=0;c.job.error=null;
    await save(c);await alarm();wake();return view(c);
  });}
  async function submitArchive(o){return serial(async()=>{
    const c=await S.get(o?.accountId);
    if(!c?.catalog||!c.baseline_at)throw Error('Save the Library inventory to Vault before archiving.');
    if(active(c))throw Error('A Library job is already active.');
    if(c.job?.pending_asset)await recoverAsset(c);
    if(!Array.isArray(o.ids)||!o.ids.length||o.ids.length>15000)throw Error('Select at least one eligible file.');
    const items=new Map(c.catalog.items.map(x=>[x.id,x]));
    const ids=[...new Set(o.ids)];
    const refs=c.catalog.project_references||[];
    const sets=P.sourceSets(refs,await V.sources(c,new Set(c.catalog.items.map(x=>x.file_id).filter(Boolean))));
    for(const id of ids){const x=items.get(id);if(!x||!P.eligible(x,sets).selectable)throw Error('Selection contains a Project Source or a file without an eligible original.');}
    c.tab_id=Number.isInteger(o.tabId)?o.tabId:c.tab_id;stopped.delete(c.account_id);
    const r=await connect(c);r.close();
    c.job={id:crypto.randomUUID(),kind:'archive',status:'queued',phase:'archive',started_at:iso(),next_at:0,
      selected_ids:ids,archive_index:0,results:[],received_bytes:0,detail:'Selected original files queued. No automatic downloads will follow.'};
    note(c,c.job.detail);await save(c);await alarm();wake();return view(c);
  });}
  async function collectStep(c){
    const j=c.job;j.status='running';j.error=null;
    if(j.phase==='projects'){
      if(j.counts.project_pages>=MAX_PAGES)throw err('LIMIT','Project list safety limit reached.');
      let r;
      try{r=await page(c,{kind:'projects',cursor:j.cursor,ownedOnly:!!j.owned_only});}
      catch(e){if(!j.cursor&&!j.owned_only&&[400,403,404].includes(e.httpStatus)){
        j.owned_only=true;j.links_partial=true;j.warnings.push('Only owned Projects could be listed; shared source links may be incomplete.');return;
      }throw e;}
      j.counts.project_pages++;
      const seen=new Set(j.projects.map(x=>x.id));for(const p of r.items)if(!seen.has(p.id)){seen.add(p.id);j.projects.push(p);}
      advanceCursor(j,r.cursor);j.detail=`Project references: ${j.projects.length} projects discovered`;
      if(!r.cursor){j.phase='project_refs';j.cursor=null;j.seen_cursors=[];}
    }else if(j.phase==='project_refs'){
      const project=j.projects[j.project_index];
      if(!project){j.phase='nodes';return;}
      try{const r=await page(c,{kind:'project_refs',projectId:project.id,projectName:project.name});j.refs=P.mergeRefs(j.refs,r.refs);}
      catch(e){if([401,429].includes(e.httpStatus)||['WORKSPACE_CHANGED','WAIT_TAB','API_COOLDOWN','CANCELLED'].includes(e.code))throw e;
        j.links_partial=true;j.warnings.push('Project references unavailable: '+project.name+' (HTTP '+(e.httpStatus||'network/schema')+').');}
      j.project_index++;j.detail=`Project references: ${j.project_index}/${j.projects.length}`;
    }else if(j.phase==='nodes'){
      const d=j.directories[j.directory_index];if(!d){j.phase='images';j.cursor=null;j.seen_cursors=[];return;}
      if(d.pages>=MAX_PAGES||j.nodes.length>=MAX_NODES)throw err('LIMIT','Library listing safety limit reached.');
      const r=await page(c,{kind:'nodes',parent:d.id,cursor:d.cursor});
      d.pages++;j.counts.library_pages++;
      const seen=new Set(j.nodes.map(x=>x.kind+':'+(x.library_id||x.file_id)));
      for(const node of r.items){
        const id=node.kind+':'+(node.library_id||node.file_id);if(seen.has(id))continue;seen.add(id);j.nodes.push(node);
        if(['directory','folder'].includes(node.kind)&&node.library_id&&!j.seen_directories.includes(node.library_id)&&
            !/mounted|external|connector/i.test(node.access_kind||'')){
          if(d.depth>=16||j.directories.length>=MAX_FOLDERS)throw err('LIMIT','Library folder safety limit reached.');
          j.seen_directories.push(node.library_id);j.directories.push({id:node.library_id,depth:d.depth+1,cursor:null,seen:[],pages:0});
        }
      }
      if(r.cursor&&d.seen.includes(r.cursor))throw err('PAGINATION','Repeated Library cursor.');
      if(r.cursor)d.seen.push(r.cursor);d.cursor=r.cursor;if(!r.cursor)j.directory_index++;
      j.detail=`Library list: ${j.nodes.length} nodes, ${j.counts.library_pages} pages`;
    }else if(j.phase==='images'){
      if(j.counts.image_pages>=MAX_PAGES||j.images.length>=MAX_NODES)throw err('LIMIT','Images listing safety limit reached.');
      const r=await page(c,{kind:'images',cursor:j.cursor});j.counts.image_pages++;
      const seen=new Set(j.images.map(x=>x.gallery_id||x.file_id));
      for(const x of r.items)if(!seen.has(x.gallery_id||x.file_id)){seen.add(x.gallery_id||x.file_id);j.images.push(x);}
      advanceCursor(j,r.cursor);j.detail=`Images list: ${j.images.length} entries`;
      if(!r.cursor){j.phase='prepare';j.cursor=null;j.seen_cursors=[];}
    }else if(j.phase==='prepare'){
      const catalog=I.linkCatalog(I.buildCatalog(j.nodes,j.images),j.refs);
      j.archived_sources=await V.sources(c,new Set(catalog.items.map(x=>x.file_id).filter(Boolean)));
      P.decorate(catalog,j.refs,j.archived_sources);
      const old=new Map((c.catalog?.items||[]).map(x=>[x.id,x])), known=new Set(old.keys());
      for(const item of catalog.items){
        if(item.managed_by_project_sources){j.counts.descriptors_excluded++;continue;}
        if(j.kind==='incremental'&&!P.newAfter(item,known,c.baseline_at))continue;
        if(item.sources.includes('images')){j.counts.descriptors_not_needed++;continue;}
        if(old.get(item.id)?.metadata_status==='available'){j.counts.descriptors_cached++;continue;}
        if(I.goodFile(item.file_id))j.targets.push(item.file_id);
      }
      j.targets=[...new Set(j.targets)];j.phase='details';j.detail=`Metadata: ${j.targets.length} files; ${j.counts.descriptors_excluded} Project Sources excluded`;
    }else if(j.phase==='details'){
      if(j.detail_index>=j.targets.length){j.phase='assemble';return;}
      const batch=j.targets.slice(j.detail_index,j.detail_index+2);
      const r=await page(c,{kind:'details',fileIds:batch});
      for(const x of r.items){if(x.detail)j.details[x.file_id]=x.detail;else j.detail_errors[x.file_id]=x.error;}
      j.detail_index+=batch.length;j.detail=`File metadata: ${j.detail_index}/${j.targets.length}; old files are not re-polled`;
    }else if(j.phase==='assemble'){
      const details=new Map(Object.entries(j.details));
      let result=I.linkCatalog(I.buildCatalog(j.nodes,j.images,details),j.refs);
      const old=new Map((c.catalog?.items||[]).map(x=>[x.id,x]));
      for(const item of result.items){
        const previous=old.get(item.id),d=details.get(item.file_id),failure=j.detail_errors[item.file_id];
        if(!d&&previous?.metadata_status==='available'){
          for(const key of ['origin','origin_status','origin_evidence','use_case'])item[key]=previous[key];
          item.metadata_status='available';
        }else item.metadata_status=d?'available':failure?'unavailable':item.sources.includes('images')?'not_needed_gallery':'not_requested';
        if(failure)item.metadata_error=failure;
        if(d&&item.origin==='unknown')item.origin_status='insufficient_evidence';
        item.first_seen_at=previous?.first_seen_at||iso();
        if(previous?.archive)item.archive=previous.archive;
      }
      P.decorate(result,j.refs,j.archived_sources);
      result.summary={...P.summarize(result.items),folders:result.folders.length,
        message_references:result.message_references.length};
      for(const item of result.items)if(item.managed_by_project_sources){
        if(item.metadata_status==='not_requested')item.metadata_status='not_requested_project_source';
        if(item.origin==='unknown' && item.origin_status==='unavailable')item.origin_status='not_requested_project_source';
      }
      const failures=Object.keys(j.detail_errors).length;
      const refs=result.project_source_refs;
      let catalog={schema:'cae.library-inventory.v3',captured_at:iso(),scan_started_at:j.started_at,
        active_scope:{account_id:c.account_id,workspace_name:c.display},status:'complete',
        classification_status:failures?'partial':'complete',links_status:j.links_partial?'partial':'complete',
        collections:{library:{status:'complete',pages:j.counts.library_pages,folders_scanned:j.directory_index,nodes:j.nodes.length,errors:0},
          images:{status:'complete',pages:j.counts.image_pages,images:j.images.length,errors:0},
          descriptors:{status:failures?'partial':'complete',attempted:j.detail_index,succeeded:Object.keys(j.details).length,
            failed:failures,skipped:0,excluded_project_sources:j.counts.descriptors_excluded,cached:j.counts.descriptors_cached},
          project_links:{status:j.links_partial?'partial':'complete',projects_found:j.projects.length,projects_checked:j.project_index,
            refs:j.refs.length,matched:refs.matched,unmatched:refs.unmatched.length}},
        items:result.items,folders:result.folders,unmatched_project_refs:refs.unmatched,
        project_references:j.refs,message_references:result.message_references,
        warnings:[...j.warnings,...Object.entries(j.detail_errors).map(([id,e])=>'Metadata unavailable ('+id.slice(-8)+'): HTTP '+(e.http_status||'network')+'.')]};
      if(j.kind==='incremental'){
        catalog=P.mergeIncremental(c.catalog,catalog,c.baseline_at);
        // Updating inexpensive references prevents double archival when an old
        // Library file becomes a Project Source. No descriptor is re-requested.
        const allRefs=P.mergeRefs(c.catalog?.project_references||[],j.refs);
        I.linkCatalog(catalog,allRefs);catalog.project_references=allRefs;
        P.decorate(catalog,allRefs,j.archived_sources);
        catalog.summary={...P.summarize(catalog.items),folders:catalog.folders.length,
          message_references:catalog.message_references.length};
      }
      catalog.summary={...P.summarize(catalog.items),folders:catalog.folders.length,
        message_references:catalog.message_references?.length||0};
      if(j.kind==='incremental'){
        // A newly linked Source or a verified Source becoming unavailable is a
        // persistent catalog change even when not a single new Library file was
        // created after the baseline. Compare stable identity/placement fields,
        // not captured_at or other changing scan timestamps.
        const identity=x=>JSON.stringify({
          items:(x?.items||[]).map(item=>({id:item.id,source_only:!!item.source_only,
            sources:item.sources,placements:item.placements,
            source_copy_verified:!!item.source_copy_verified,
            source_archive_status:item.source_archive_status,
            archive_eligibility:item.archive_eligibility})).sort((a,b)=>a.id.localeCompare(b.id)),
          // Source metadata (name, media, parent Project, message links) may
          // change even when Source IDs stay fixed. All fields are allowlisted
          // at collection time, so comparing the complete reference is safe.
          refs:(x?.project_references||[]).map(ref=>JSON.stringify(ref)).sort()
        });
        const catalogChanged=(catalog.incremental.added>0 ||
          identity(c.catalog)!==identity(catalog));
        if(!catalogChanged){
          c.last_poll_at=iso();c.next_poll_at=Date.now()+POLL_MS;
          j.status='complete';j.finished_at=iso();
          j.detail='List check complete: no new files or placement changes; no old descriptors requested.';
          // Cached metadata can update without changing the durable snapshot.
          c.catalog=catalog;c.catalog_revision=(c.catalog_revision||0)+1;note(c,j.detail);return;
        }
      }
      j.staged=V.packet(c,catalog,c.baseline_at||iso(),j.id);j.phase='commit';
      j.detail='Writing the file inventory to Vault';
      // The full packet is persisted before disk IO for idempotent recovery.
    }else if(j.phase==='commit'){
      checkpoint(c);await V.commit(c,j.staged,j.expected_commit);
      c.catalog=j.staged.catalog;c.catalog_revision=(c.catalog_revision||0)+1;c.baseline_at=j.staged.baseline_at;c.last_poll_at=iso();c.next_poll_at=Date.now()+POLL_MS;
      if(j.kind==='manual')c.enabled=j.monitor_after_save&&!j.links_partial;
      j.status='complete';j.finished_at=iso();j.detail=`Inventory saved: ${c.catalog.items.length} files. `+(c.enabled?'Monitoring new metadata only.':'Monitoring is off.');
      note(c,j.detail);delete j.staged;
    }
  }
  function mimeAllowed(item,actual){
    const mime=String(actual||'').split(';')[0].trim().toLowerCase();
    if(mime==='text/html'&&!['text/html','application/xhtml+xml'].includes(item.mime_type))return false;
    if(item.media_class==='image'&&mime&&!mime.startsWith('image/')&&!['application/octet-stream','binary/octet-stream'].includes(mime))return false;
    if(mime==='application/json'&&item.mime_type!=='application/json'&&!/\.jsonl?$/i.test(item.name))return false;
    return true;
  }
  async function recoverAsset(c){
    const receipt=c.job.pending_asset;if(!receipt)return false;
    const result=await V.withVault(c,async(v,dir)=>{
      const loc=await FS.lookupFile(dir,receipt.decision.path);
      if(!loc)return null;
      const file=await loc.handle.getFile();
      if(file.size===receipt.bytes&&await FS.digestStream(file)===receipt.sha256){
        await v.completeSource(receipt.job,receipt.decision,{handle:loc.handle},receipt.sha256,receipt.bytes);
        return {...receipt.result,status:'saved',recovered:true};
      }
      if(file.size===0){await v.abortSource({...loc,fresh:true});return null;}
      return {...receipt.result,status:'conflict',reason:'Interrupted target differs from the staged checksum; preserved.'};
    });
    delete c.job.pending_asset;
    if(result){c.job.results.push(result);c.job.archive_index++;}
    return !!result;
  }
  async function archiveStep(c){
    const j=c.job;j.status='running';j.error=null;
    if(j.pending_asset){if(await recoverAsset(c))return;}
    if(j.phase==='archive_report'){
      await V.writeReport(c,j.report);c.last_report=j.report;j.phase='archive_snapshot';return;
    }
    if(j.phase==='archive_snapshot'){
      if(!j.staged){const latest=await V.load(c);if(!latest)throw err('VAULT_SCHEMA','Saved Library inventory is missing.');
        const catalog=structuredClone(latest.catalog);j.expected_commit=latest.commit_id??null;c.baseline_at=latest.baseline_at;
        for(const r of j.results){const item=catalog.items.find(x=>x.id===r.id);if(item)item.archive={...r};}
        j.staged=V.packet(c,catalog,c.baseline_at,j.id);return;
      }
      await V.commit(c,j.staged,j.expected_commit);c.catalog=j.staged.catalog;c.catalog_revision=(c.catalog_revision||0)+1;j.status='complete';j.finished_at=iso();
      j.detail=`Archival finished: ${j.results.filter(x=>x.status==='saved').length} saved, ${j.results.filter(x=>x.status==='failed').length} failed.`;
      note(c,j.detail);delete j.staged;return;
    }
    const id=j.selected_ids[j.archive_index];
    if(!id){
      j.report={schema:'cae.library-download-report.v1',account_id:c.account_id,started_at:j.started_at,finished_at:iso(),
        results:j.results,received_bytes:j.received_bytes,limits:{max_file_bytes:MAX_FILE,max_batch_bytes:MAX_BATCH}};
      j.phase='archive_report';return;
    }
    const item=c.catalog.items.find(x=>x.id===id);
    if(!item)throw Error('Selected item no longer exists in the cached inventory.');
    j.detail=`Archiving ${j.archive_index+1}/${j.selected_ids.length}: ${item.name}`;
    const result={id:item.id,file_id:item.file_id,name:item.name,status:'failed',at:iso()};
    if(!P.eligible(item,P.sourceSets(c.catalog.project_references,await V.sources(c,new Set([item.file_id])))).selectable){
      j.results.push({...result,status:'ineligible',reason:'Original is ineligible or a verified Project Source copy exists in Vault.'});j.archive_index++;return;
    }
    let opened=false,bytes=0,charged=false;
    try{
      const outcome=await V.withVault(c,async v=>{
        const prior=await V.preflight(v,c,item);if(prior.skip)return prior.result;
        const cap=Math.min(MAX_FILE,MAX_BATCH-j.received_bytes);
        if(cap<=0||(Number.isFinite(item.file_size_bytes)&&item.file_size_bytes>cap))
          return {...result,status:'deferred_limit',reason:'Batch/file byte limit reached. Select remaining files in another run.'};
        const info=await call(c,'CAE_ASSET_START',{fileId:item.file_id,maxBytes:cap});opened=true;
        if(!mimeAllowed(item,info.contentType))throw err('CONTENT_TYPE','Unexpected HTTP content type; original not saved.');
        const prepared=await V.preflight(v,c,item,info.contentType);
        if(prepared.skip)return prepared.result;
        const target=await v.beginSource(prepared.decision,prepared.job),sha=new root.ChatArchiveHash.Sha256();
        let committed=false;
        const deadline=Date.now()+4*60_000;
        try{
          for(;;){
            checkpoint(c);if(Date.now()>deadline)throw err('TRANSFER_TIMEOUT','Original transfer exceeded its bounded runtime.');
            const part=await call(c,'CAE_SOURCE_READ');
            if(part.done){if(part.totalBytes!==bytes)throw err('BYTE_COUNT','Transfer byte count mismatch.');break;}
            const chunk=root.ChatArchiveSources.decode(part.base64,part.byteLength);
            bytes+=chunk.byteLength;
            if(bytes>cap)throw err('SOURCE_LIMIT','Original byte limit exceeded.');
            await target.stream.write(chunk);sha.update(chunk);
          }
          if(Number.isFinite(item.file_size_bytes)&&bytes!==item.file_size_bytes)throw err('SIZE_MISMATCH','Original size differs from the catalog; file not committed.');
          const scope=await call(c,'CAE_STATUS',{force:true});
          if(!scope.observed||scope.accountId!==c.account_id)throw err('WORKSPACE_CHANGED','Workspace changed during original transfer.');
          const hash=sha.hex();
          const saved={...result,status:'saved',local_path:prepared.decision.path,sha256:hash,bytes,content_type:info.contentType||null};
          j.pending_asset={job:prepared.job,decision:prepared.decision,result:saved,bytes,sha256:hash};
          j.received_bytes+=bytes;charged=true;await save(c);checkpoint(c);
          await v.stageSourceCommit(prepared.job,prepared.decision,hash,bytes);
          await target.stream.close();committed=true;
          const file=await target.handle.getFile();
          if(file.size!==bytes||await FS.digestStream(file)!==hash)throw err('DISK_VERIFY','Saved original did not pass checksum verification.');
          await v.completeSource(prepared.job,prepared.decision,target,hash,bytes);
          delete j.pending_asset;return saved;
        }catch(e){if(!committed){await v.abortSource(target);delete j.pending_asset;}throw e;}
      });
      j.results.push(outcome);j.archive_index++;
    }catch(e){
      if(j.pending_asset)throw e; // Recover a completed file before any new download.
      if(['CANCELLED','WORKSPACE_CHANGED','WAIT_TAB','WAIT_PERMISSION','VAULT_BUSY','API_COOLDOWN'].includes(e.code)||[401,403,429].includes(e.httpStatus))throw e;
      j.results.push({...result,error_code:e.code||'ARCHIVE_FAILED',http_status:e.httpStatus||null,
        reason:safeError(e),bytes_received:bytes});j.archive_index++;
    }finally{
      if(!charged)j.received_bytes+=bytes;
      if(opened&&rpc)await rpc.call('CAE_SOURCE_CLOSE').catch(()=>{});
    }
  }
  function safeError(e){
    // HTTP/native errors only. Never retain full request URLs or server bodies.
    return String(e?.message||'Operation failed.').replace(/https?:\/\/\S+/g,'[URL omitted]').replace(/Bearer\s+\S+/gi,'[auth omitted]').slice(0,300);
  }
  async function step(c){
    checkpoint(c);
    if(c.job.kind==='archive')return archiveStep(c);
    return collectStep(c);
  }
  async function handleError(c,e){
    const j=c.job;
    if(stopped.has(c.account_id)||e.code==='CANCELLED'){
      c.enabled=false;j.status='cancelled';j.finished_at=iso();j.detail='Stopped; completed files and last saved inventory are preserved.';
    }else if(['WAIT_TAB','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||e.httpStatus===401){
      j.status='waiting_for_tab';j.next_at=Date.now()+60_000;j.detail=safeError(e);
    }else if(e.code==='WAIT_PERMISSION'||['NotAllowedError','SecurityError'].includes(e.name)){
      j.status='permission_required';j.next_at=Date.now()+60_000;j.detail=safeError(e);
    }else if(e.code==='VAULT_BUSY'){
      j.status='queued';j.next_at=Date.now()+3000+Math.floor(Math.random()*3000);j.detail='Waiting for the shared Vault writer.';
    }else if(e.code==='VAULT_STALE'){
      if(j.kind==='archive'&&j.phase==='archive_snapshot'){delete j.staged;j.status='queued';j.next_at=Date.now()+3000;j.detail='Inventory changed; merging archive results with the latest saved inventory.';}
      else if(j.kind==='incremental'){j.status='cancelled';j.finished_at=iso();c.next_poll_at=Date.now()+POLL_MS;j.detail='Another browser updated the inventory; next check will reload it.';}
      else{j.status='error';j.finished_at=iso();j.error=safeError(e);j.detail=j.error;}

    }else if(e.code==='API_COOLDOWN'||e.httpStatus===429){
      j.status='cooldown';j.next_at=Date.now()+Math.max(60_000,e.retryAfterMs||0);j.detail='Paused for ChatGPT API rate limit.';
    }else{
      j.retries=(j.retries||0)+1;j.error=safeError(e);j.detail=j.error;
      if(j.retries<=2&&!['VAULT_CONFLICT','VAULT_SCHEMA','LIMIT','PAGINATION','VAULT_PATH'].includes(e.code)){
        j.status='retry_wait';j.next_at=Date.now()+30_000*j.retries;
      }else{j.status='error';j.finished_at=iso();c.enabled=false;}
    }
    note(c,j.detail);await save(c);
  }
  function compact(c){
    if(!c.job||!terminal.has(c.job.status)||c.job.status==='error')return;
    // Keep receipts if needed for explicit recovery, but retire scan buffers.
    for(const k of ['nodes','images','directories','seen_directories','details','detail_errors','targets','projects','refs','archived_sources','seen_cursors'])delete c.job[k];
  }
  async function tick(){
    if(run)return run;
    const p=serial(async()=>{
      const deadline=Date.now()+20_000;
      const configs=await S.list();
      for(let c of configs){
        if(!active(c)&&c.enabled&&c.baseline_at&&Date.now()>=(c.next_poll_at||0)&&!stopped.has(c.account_id)){
          // A removed/corrupted Vault snapshot cannot silently start a new baseline.
          let disk;
          try{disk=await V.load(c);if(!disk)throw err('VAULT_SCHEMA','Saved inventory is missing. Start a new inventory manually.');}
          catch(e){if(['VAULT_BUSY','WAIT_PERMISSION'].includes(e.code)){c.next_poll_at=Date.now()+60000;}else c.enabled=false;note(c,safeError(e));await save(c);continue;}
          c.catalog=disk.catalog;c.baseline_at=disk.baseline_at;
          c.job=job('incremental');c.job.expected_commit=disk.commit_id??null;c.job.detail='Checking lightweight lists for new files';await save(c);
        }
        if(!active(c)||(c.job.next_at||0)>Date.now())continue;
        activeAccount=c.account_id;
        try{
          do{
            try {await step(c);c.job.retries=0;c.job.next_at=0;compact(c);await save(c);}
            catch(e){await handleError(c,e);break;}
          }while(active(c)&&Date.now()<deadline&&!['waiting_for_tab','permission_required','cooldown','retry_wait'].includes(c.job.status));
        }finally{rpc?.close();rpc=null;activeAccount=null;}
        if(Date.now()>=deadline)break;
      }
      await alarm();
      if((await S.list()).some(c=>active(c)&&(c.job.next_at||0)<=Date.now()))wake(150);
    });
    run=p;try{return await p;}finally{if(run===p)run=null;}
  }
  async function startup(){await alarm();if((await S.list()).some(c=>active(c)))wake();}
  const api={ALARM,POLL_MS,start,stop,monitor,restore,resume,submitArchive,inspect,tick,startup,
    _step:step,_view:view,_job:job,_mimeAllowed:mimeAllowed};
  root.ChatArchiveLibraryJobs=api;
})(globalThis);
