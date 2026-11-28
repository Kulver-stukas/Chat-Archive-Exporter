/* Durable, workspace-bound Library inventory and explicit asset archival.
 * The panel is a view only. Alarms recover checkpoints after worker suspension.
 * Polling lists is not re-enrichment: old file descriptors are never polled.
 */
(function(root){
  'use strict';
  const providers=root.ChatArchiveProviders;
  const S=root.ChatArchiveLibraryStore,V=root.ChatArchiveLibraryVault,I=root.ChatArchiveLibraryInventory,
    P=root.ChatArchiveLibraryPolicy,FS=root.ChatArchiveVault;
  const ALARM='cae-library-maintenance-v1', POLL_MS=5*60_000;
  const MAX_FILE=512*1024*1024, MAX_BATCH=1024*1024*1024;
  const iso=()=>new Date().toISOString(),err=(code,message)=>Object.assign(Error(message),{code});
  const terminal=new Set(['complete','cancelled','error']);
  let chain=Promise.resolve(),run=null,rpc=null,activeAccount=null,timer=null;
  const stopped=new Set();
  const serial=fn=>{const p=chain.catch(()=>{}).then(fn);chain=p.catch(()=>{});return p;};
  function active(c){return !!c?.job&&!terminal.has(c.job.status);}
  function note(c,text){c.events=(c.events||[]).concat({at:iso(),text}).slice(-40);}
  async function save(c){
    const A=root.ChatArchiveWorkspaceActivity;
    if(A){const last=A.newer(c.last_activity_receipt,A.library(c));if(last)c.last_activity_receipt=last;}
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
    const found=await root.ChatArchiveJobTransport.legacy().findVerified({tabId:c.tab_id,accountId:c.account_id,timeout:90000,requirePath:true,
      checkpoint:()=>checkpoint(c),message:'Keep an authenticated ChatGPT tab open in the original workspace.'});
    c.tab_id=found.tabId;return found.rpc;
  }
  async function call(c,type,args={}){
    checkpoint(c);
    const globalCooldown=root.ChatArchiveSync?._state?.()?.cooldown_until||0;
    if(globalCooldown>Date.now())throw Object.assign(err('API_COOLDOWN','ChatGPT API cooldown is active.'),{retryAfterMs:globalCooldown-Date.now()});
    if(!rpc)rpc=await connect(c);
    const result=await rpc.call(type,{...args,expectedAccountId:c.account_id});checkpoint(c);return result;
  }
  const page=(c,query)=>call(c,'libraryPage',{query});
  const job=kind=>root.ChatArchiveLibraryScan.job(kind);
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
    if(existing){c.baseline_at=existing.baseline_at;c.catalog=existing.catalog;c.vault_commit_id=existing.commit_id;c.vault_saved_at=existing.saved_at;c.catalog_revision=(c.catalog_revision||0)+1;}
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
      note(c,'Library scan stopped; new-file monitoring is paused.');await save(c);await publishHistory(c);await alarm();return view(c);});
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
    c.baseline_at=saved.baseline_at;c.catalog=saved.catalog;c.vault_commit_id=saved.commit_id;c.vault_saved_at=saved.saved_at;c.catalog_revision=(c.catalog_revision||0)+1;
    c.enabled=o.enabled===true;c.next_poll_at=Date.now()+POLL_MS;
    stopped.delete(c.account_id);note(c,'Existing Library inventory restored.');
    await save(c);await alarm();return view(c);
  });}
  // A verified workspace can adopt its existing Vault catalog independently
  // of the monitoring policy. Local active jobs/receipts are never imported.
  async function hydrate(o){return serial(async()=>{
    if(!S.validId(o?.accountId)||!Number.isInteger(o.tabId))throw Error('Verified workspace required.');
    const prior=await S.get(o.accountId);
    if(active(prior)||prior?.job?.pending_asset||prior?.job?.status==='error')return view(prior);
    const dir=await FS.restoreWorkspaceDirectory(o.accountId);
    if(!dir)throw err('WAIT_PERMISSION','Workspace Vault binding is unavailable.');
    const permission=await FS.permissionState(dir);if(permission.state!=='granted')throw err('WAIT_PERMISSION','Cannot read saved Library inventory: Vault access '+permission.state+'.');
    const display=String(o.display||'Workspace '+o.accountId.slice(0,8)).slice(0,250);
    const prefix=await FS.resolveWorkspacePrefix(dir,root.ChatArchivePaths.createLayout(display).prefix,o.accountId);
    const c=prior||{schema:'cae.library-state.v1',account_id:o.accountId,display,prefix,enabled:false};
    const bound=await S.directory(o.accountId);
    if(prior?.enabled){if(!bound||c.prefix!==prefix)throw Error('Library monitor is bound to a different Vault.');await FS.verifySameDirectory(bound,dir);}
    const same=bound&&typeof dir.isSameEntry==='function'&&await FS.deadline(dir.isSameEntry(bound),5000,'Library Vault identity').catch(()=>false);
    const saved=await V.readSnapshot({...c,prefix},dir);
    const A=root.ChatArchiveWorkspaceActivity;if(A&&prior&&!c.last_activity_receipt)c.last_activity_receipt=A.library(c);
    if(!saved){
      if(!prior||same)return view(prior);
      // An explicitly changed Vault must not retain another folder's catalog
      // or a resumable job. Active/error/pending-asset states returned above.
      await S.bind(o.accountId,dir);c.prefix=prefix;c.display=display;c.tab_id=o.tabId;
      c.catalog=null;c.baseline_at=null;c.enabled=false;c.job=null;c.catalog_revision=(c.catalog_revision||0)+1;
      delete c.vault_commit_id;delete c.vault_saved_at;delete c.last_poll_at;delete c.last_view_refresh_at;
      await save(c);return view(c);
    }
    const unchanged=same&&c.prefix===prefix&&c.baseline_at===saved.baseline_at&&c.vault_commit_id===saved.commit_id&&c.vault_saved_at===saved.saved_at&&c.catalog;
    if(unchanged)return view(c);
    // Read has no network effects; future explicit refresh/monitor uses the
    // original cutoff and latest on-disk catalog, not a new baseline.
    if(!same)await S.bind(o.accountId,dir);
    c.prefix=prefix;c.display=display;c.tab_id=o.tabId;c.baseline_at=saved.baseline_at;
    c.catalog=saved.catalog;c.vault_commit_id=saved.commit_id;c.vault_saved_at=saved.saved_at;c.catalog_revision=(c.catalog_revision||0)+1;
    note(c,'Saved Library inventory loaded from Vault.');await save(c);return view(c);
  });}
  // One lightweight refresh after the user opens Files, only with an
  // existing baseline. It does not opt this profile into background monitoring.
  async function refreshOnce(o){return serial(async()=>{
    if(!S.validId(o?.accountId)||!Number.isInteger(o.tabId))throw Error('Verified workspace required.');
    const c=await S.get(o.accountId);
    if(!c?.baseline_at||!c.catalog||active(c)||c.job?.pending_asset||c.job?.status==='error')return view(c);
    const last=Math.max(Date.parse(c.last_poll_at||'')||0,Date.parse(c.vault_saved_at||'')||0,c.last_view_refresh_at||0);
    if(last&&Date.now()-last<POLL_MS)return view(c);
    const dir=await FS.restoreWorkspaceDirectory(o.accountId),bound=await S.directory(o.accountId);
    if(!dir||!bound||(await FS.permissionState(dir)).state!=='granted')return view(c);
    await FS.verifySameDirectory(bound,dir);
    const saved=await V.readSnapshot(c,dir);if(!saved)return view(c);
    if(Date.now()-Date.parse(saved.saved_at||'')<POLL_MS)return view(c);
    const next={...c,tab_id:o.tabId};stopped.delete(c.account_id);
    const rpc=await connect(next);rpc.close();
    c.tab_id=next.tab_id;c.catalog=saved.catalog;c.baseline_at=saved.baseline_at;c.vault_commit_id=saved.commit_id;c.vault_saved_at=saved.saved_at;
    c.catalog_revision=(c.catalog_revision||0)+1;c.last_view_refresh_at=Date.now();
    c.job=job('incremental');c.job.expected_commit=saved.commit_id??null;c.job.detail='Checking saved inventory for new files and placements';
    await save(c);await alarm();wake();return view(c);
  });}
  async function publishHistory(c){
    const A=root.ChatArchiveWorkspaceActivity;if(!A)return;
    try{await A.publish(c.last_activity_receipt||A.library(c),c.display);}catch(e){/* receipt remains local; next view retries */}
  }
  async function shareLatest(account){const c=await S.get(account);if(c)await publishHistory(c);}
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
    if(j.phase!=='commit'){
      const result=await root.ChatArchiveLibraryScan.collectStep(c,{page,readArchivedSources:(config,ids)=>V.sources(config,ids)});
      if(!result)return;
      const {catalog,changed}=result;
      if(!changed){
        c.last_poll_at=iso();c.next_poll_at=Date.now()+POLL_MS;
        j.status='complete';j.finished_at=iso();
        j.detail='List check complete: no new files or placement changes; no old descriptors requested.';
        c.catalog=catalog;c.catalog_revision=(c.catalog_revision||0)+1;note(c,j.detail);return;
      }
      j.staged=V.packet(c,catalog,c.baseline_at||iso(),j.id);j.phase='commit';j.detail='Writing the file inventory to Vault';
      // The full packet is persisted before disk IO for idempotent recovery.
    }else if(j.phase==='commit'){
      checkpoint(c);await V.commit(c,j.staged,j.expected_commit);
      c.catalog=j.staged.catalog;c.vault_commit_id=j.staged.commit_id;c.vault_saved_at=j.staged.saved_at;c.catalog_revision=(c.catalog_revision||0)+1;c.baseline_at=j.staged.baseline_at;c.last_poll_at=iso();c.next_poll_at=Date.now()+POLL_MS;
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
      await V.commit(c,j.staged,j.expected_commit);c.catalog=j.staged.catalog;c.vault_commit_id=j.staged.commit_id;c.vault_saved_at=j.staged.saved_at;c.catalog_revision=(c.catalog_revision||0)+1;j.status='complete';j.finished_at=iso();
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
        const info=await call(c,'assetStart',{fileId:item.file_id,maxBytes:cap});opened=true;
        if(!mimeAllowed(item,info.contentType))throw err('CONTENT_TYPE','Unexpected HTTP content type; original not saved.');
        const prepared=await V.preflight(v,c,item,info.contentType);
        if(prepared.skip)return prepared.result;
        const target=await v.beginSource(prepared.decision,prepared.job),sha=new root.ChatArchiveHash.Sha256();
        let committed=false;
        const deadline=Date.now()+4*60_000;
        try{
          for(;;){
            checkpoint(c);if(Date.now()>deadline)throw err('TRANSFER_TIMEOUT','Original transfer exceeded its bounded runtime.');
            const part=await call(c,'sourceRead');
            if(part.done){if(part.totalBytes!==bytes)throw err('BYTE_COUNT','Transfer byte count mismatch.');break;}
            const chunk=root.ChatArchiveSources.decode(part.base64,part.byteLength);
            bytes+=chunk.byteLength;
            if(bytes>cap)throw err('SOURCE_LIMIT','Original byte limit exceeded.');
            await target.stream.write(chunk);sha.update(chunk);
          }
          if(Number.isFinite(item.file_size_bytes)&&bytes!==item.file_size_bytes)throw err('SIZE_MISMATCH','Original size differs from the catalog; file not committed.');
          const scope=await call(c,'status',{force:true});
          if(!providers.verified(scope,c.account_id))throw err('WORKSPACE_CHANGED','Workspace changed during original transfer.');
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
      if(opened&&rpc)await rpc.call('sourceClose').catch(()=>{});
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
          c.catalog=disk.catalog;c.baseline_at=disk.baseline_at;c.vault_commit_id=disk.commit_id;c.vault_saved_at=disk.saved_at;
          c.job=job('incremental');c.job.expected_commit=disk.commit_id??null;c.job.detail='Checking lightweight lists for new files';await save(c);
        }
        if(!active(c)||(c.job.next_at||0)>Date.now())continue;
        activeAccount=c.account_id;
        try{
          do{
            try {await step(c);c.job.retries=0;c.job.next_at=0;compact(c);await save(c);}
            catch(e){await handleError(c,e);break;}
          }while(active(c)&&Date.now()<deadline&&!['waiting_for_tab','permission_required','cooldown','retry_wait'].includes(c.job.status));
        }finally{rpc?.close();rpc=null;activeAccount=null;if(!active(c))await publishHistory(c); }
        if(Date.now()>=deadline)break;
      }
      await alarm();
      if((await S.list()).some(c=>active(c)&&(c.job.next_at||0)<=Date.now()))wake(150);
    });
    run=p;try{return await p;}finally{if(run===p)run=null;}
  }
  async function startup(){await alarm();if((await S.list()).some(c=>active(c)))wake();}
  const api={ALARM,POLL_MS,start,stop,monitor,restore,hydrate,refreshOnce,shareLatest,resume,submitArchive,inspect,tick,startup,
    _step:step,_view:view,_job:job,_mimeAllowed:mimeAllowed};
  root.ChatArchiveLibraryJobs=api;
})(globalThis);
