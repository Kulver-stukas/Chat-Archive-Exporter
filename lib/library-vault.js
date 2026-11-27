/* The same Vault writer lock/index as chat export. No network calls here. */
(function(root){
  'use strict';
  const V=root.ChatArchiveVault, P=root.ChatArchivePaths, S=root.ChatArchiveLibraryStore, I=root.ChatArchiveLibraryInventory;
  const error=(code,message)=>Object.assign(Error(message),{code});
  function paths(c){
    const base=c.prefix+'/_Library';
    const result={inventory:base+'/_inventory.json',report:base+'/_download_report.json',base};
    if(!V.validPath(result.inventory)||c.prefix.split('/').length!==2)throw error('VAULT_PATH','Invalid workspace folder.');
    return result;
  }
  async function directory(c){
    const dir=await S.directory(c.account_id);
    const state=await V.permissionState(dir);
    if(state.state!=='granted')throw error('WAIT_PERMISSION','Library Vault access: '+state.state+'. Restore access from the panel.');
    return dir;
  }
  async function withVault(c,fn){
    const release=await V.acquireLock(true);
    if(!release)throw error('VAULT_BUSY','Another export is writing to this Vault.');
    let shared;
    try {const dir=await directory(c);shared=await V.acquireVaultGuard(dir);const v=await V.openStore(dir);await v.useWorkspace(c.prefix,c.account_id);return await fn(v,dir);}
    finally{try{await shared?.();}finally{release();}}
  }
  async function load(c){return withVault(c,async(v,dir)=>{
    const saved=await V.readJson(dir,paths(c).inventory);
    if(!saved)return null;
    if(saved.schema!=='cae.library-vault.v1'||saved.account_id!==c.account_id||
        !Array.isArray(saved.catalog?.items)||saved.catalog.items.length>15000||!Number.isFinite(Date.parse(saved.baseline_at||'')))
      throw error('VAULT_SCHEMA','Existing Library inventory is not a valid snapshot of this workspace.');
    return saved;
  });}
  function packet(c,catalog,baselineAt,commitId){return {
    schema:'cae.library-vault.v1',account_id:c.account_id,baseline_at:baselineAt,
    saved_at:new Date().toISOString(),commit_id:commitId,catalog
  };}
  const FSlookup=(v,path)=>V.lookupFile(v.rootHandle,path);
  async function commit(c,staged,expected){return withVault(c,async v=>{
    const latest=await V.readJson(v.rootHandle,paths(c).inventory);
    if(latest?.commit_id!==staged.commit_id){
      const actual=latest?.commit_id??null;
      if(expected!==undefined?actual!==expected:!!latest&&latest.catalog?.captured_at!==c.catalog?.captured_at)
        throw error('VAULT_STALE','Library inventory changed in another browser. Existing inventory was preserved.');
    }
    const text=JSON.stringify(staged,null,2)+'\n';
    const prior=v.index.metadata[c.account_id+'|library:inventory'];
    const loc=await FSlookup(v,paths(c).inventory);
    if(loc&&prior){const hash=await V.digestStream(await loc.handle.getFile());
      if(hash!==prior.sha256&&hash!==root.ChatArchiveHash.hex(new TextEncoder().encode(text)))
        throw error('VAULT_CONFLICT','Library inventory was edited locally; not overwritten.');
    }
    const res=await v.writeText(paths(c).inventory,text,
      {kind:'metadata',key:c.account_id+'|library:inventory',recovery:true});
    if(res.status==='conflict'||(res.status==='skipped'&&res.reason!=='Unchanged.'))
      throw error('VAULT_CONFLICT',res.reason||'Library inventory was not written.');
    return res;
  });}
  async function sources(c,onlyFileIds=null){
    const dir=await directory(c),index=await V.readIndex(dir);
    const wanted=onlyFileIds ? new Set([...onlyFileIds].filter(x=>typeof x==='string')) : null;
    const result=[];
    for(const [key,r]of Object.entries(index.sources)){
      if(!key.startsWith(c.account_id+'|')||!r?.project_id||r.deleted_at||r.pending||!I.goodFile(r.file_id) ||
         (wanted&&!wanted.has(r.file_id)))continue;
      const item={file_id:r.file_id,project_id:r.project_id,path:r.path,verified:false,verification:'unavailable'};
      try {
        if(V.validPath(r.path)&&r.path.startsWith(c.prefix+'/')&&
            /^[a-f0-9]{64}$/i.test(r.sha256||'')&&Number.isSafeInteger(r.bytes)&&r.bytes>=0){
          const loc=await V.lookupFile(dir,r.path);
          if(!loc)item.verification='missing';
          else {
            const file=await loc.handle.getFile();
            item.verified=file.size===r.bytes && await V.digestStream(file)===r.sha256;
            item.verification=item.verified?'sha256_verified':'modified_or_corrupt';
          }
        }else item.verification='invalid_index_record';
      }catch(_e){item.verification='inaccessible';}
      result.push(item);
    }
    return result;
  }
  function jobFor(c,item,contentType){
    const group={uploaded:'Uploaded',generated:'Generated',unknown:'Unknown'}[item.origin]||'Unknown';
    const type=item.media_class==='image'?'Images':'Files';
    let name=P.sourceFilename(item.name,item.file_id,contentType||item.mime_type);
    const m=/^(.*?)(\.[^./\\\s]{1,20})$/.exec(name);
    name=(m?m[1]:name)+' ['+P.safe(item.file_id.slice(-32),40)+']'+(m?m[2]:'');
    const path=paths(c).base+'/'+group+'/'+type+'/'+name;
    if(!V.validPath(path))throw error('VAULT_PATH','Unsafe file name.');
    return {key:'library:'+item.file_id,fileId:item.file_id,projectId:null,path,name:item.name,
      expectedBytes:item.file_size_bytes??null,sourceModifiedMs:null,sourceLocation:'library',category:type,
      sourceIdentity:'file:'+item.file_id};
  }
  // Stronger than mtime checks for originals: same-length local edits are protected.
  async function preflight(v,c,item,contentType){
    for(const [key,record]of Object.entries(v.index.sources)){
      if(!key.startsWith(c.account_id+'|')||record.file_id!==item.file_id||record.deleted_at)continue;
      if(!V.validPath(record.path)||!record.path.startsWith(c.prefix+'/'))continue;
      if(record.pending)return {skip:true,result:{id:item.id,file_id:item.file_id,name:item.name,
        status:'pending_recovery',local_path:record.path,
        reason:'Interrupted Project Source requires checksum recovery before other exports can duplicate it.'}};
      const loc=await V.lookupFile(v.rootHandle,record.path);if(!loc)continue;
      const hash=await V.digestStream(await loc.handle.getFile());
      return {skip:true,result:{id:item.id,file_id:item.file_id,name:item.name,status:hash===record.sha256?'already_archived':'conflict',
        local_path:record.path,sha256:record.sha256,bytes:record.bytes,
        reason:hash===record.sha256?'Verified existing archive; not duplicated.':'Locally modified file preserved.'}};
    }
    const job=jobFor(c,item,contentType),decision=await v.decideSource(job,c.account_id);
    if(decision.action!=='download')return {skip:true,result:{id:item.id,file_id:item.file_id,name:item.name,
      status:decision.status||'skipped',local_path:decision.path,reason:decision.reason}};
    return {job,decision};
  }
  async function writeReport(c,report){return withVault(c,async v=>{
    const text=JSON.stringify(report,null,2)+'\n';
    const prior=v.index.metadata[c.account_id+'|library:download-report'];
    const loc=await FSlookup(v,paths(c).report);
    if(loc&&prior){const hash=await V.digestStream(await loc.handle.getFile());
      if(hash!==prior.sha256&&hash!==root.ChatArchiveHash.hex(new TextEncoder().encode(text)))
        throw error('VAULT_CONFLICT','Download report was edited locally; not overwritten.');
    }
    const res=await v.writeText(paths(c).report,text,
      {kind:'metadata',key:c.account_id+'|library:download-report',recovery:true});
    if(res.status==='conflict'||(res.status==='skipped'&&res.reason!=='Unchanged.'))throw error('VAULT_CONFLICT','Download report was edited locally; it was not overwritten.');
    return res;
  });}
  root.ChatArchiveLibraryVault={paths,directory,withVault,load,packet,commit,sources,jobFor,preflight,writeReport};
})(globalThis);
