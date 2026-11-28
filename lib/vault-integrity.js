/* Read-only Vault integrity audit. No provider calls, mutation, repair, or permission requests. */
(function(root){
const create=function integrityModule(V){
  'use strict';
  const MAX_FILES=30000, MAX_ISSUES=10000, MAX_DEPTH=20;
  const dict=x=>x&&typeof x==='object'&&!Array.isArray(x);
  const validId=x=>typeof x==='string'&&/^[a-z0-9_-]{8,240}$/i.test(x);
  const projectId=x=>V.storage.isProject(x)?V.storage.canonical(x):'';
  const chatIdFromName=n=>/\[([a-z0-9-]{10,100})\]\.md$/i.exec(n)?.[1]||'';
  const safeError=e=>String(e?.name||'Error').replace(/[^a-z0-9_]/gi,'').slice(0,80)||'Error';
  function top(path,prefix){return path.slice(prefix.length+1).split('/')[0];}
  function chatDirectory(path,prefix){
    const p=path.slice(prefix.length+1).split('/');
    return p.length===2||p.length===3&&p[0]==='_GPTs';
  }
  function isResource(path,prefix){
    const p=path.slice(prefix.length+1).split('/');
    return p.length>2&&(p[1]==='Sources'||p[1]==='deleted'||p[0]==='_Library'&&p[1]!=='_inventory.json'&&p[1]!=='_download_report.json');
  }
  async function scan(dir,opts={}){
    const {accountId,display,full=false,check=()=>{},progress=()=>{}}=opts;
    if(!V.storage.validAccount(accountId))throw Error('A verified workspace is required.');
    check();
    const report={schema:'cae.vault-integrity.v1',account_id:accountId,mode:full?'full':'quick',
      started_at:new Date().toISOString(),prefix:null,complete:true,provisional:false,
      counts:{files:0,chat_files:0,indexed_chats:0,indexed_resources:0,indexed_metadata:0,legacy_shadowed:0,
        size_verified:0,hash_verified:0,missing:0,size_mismatch:0,hash_mismatch:0,read_errors:0,
        unindexed_chats:0,unindexed_resources:0,duplicate_chats:0,split_projects:0,misplaced_chats:0,pending_sources:0},
      issue_counts:{},issues:[],records:[],writer_claims:{before:[],after:[]}};
    function issue(code,details={}){
      report.issue_counts[code]=(report.issue_counts[code]||0)+1;
      if(report.issues.length<MAX_ISSUES)report.issues.push({code,...details});
    }
    const finish=()=>{report.finished_at=new Date().toISOString();report.issues_truncated=Object.values(report.issue_counts).reduce((a,b)=>a+b,0)>report.issues.length;return report;};
    const P=V.storage, pref=opts.preferredPrefix||('ChatGPT/'+String(display||'Workspace '+accountId.slice(0,8)));
    try{report.prefix=await V.resolveWorkspacePrefix(dir,pref,accountId);}
    catch(e){check();report.complete=false;report.provisional=true;issue('workspace_resolution_failed',{error:safeError(e)});return finish();}
    const prefix=report.prefix, inside=p=>typeof p==='string'&&V.validPath(p)&&p.startsWith(prefix+'/');
    if(!P.validPrefix(prefix)||!inside(prefix+'/.workspace.json'))throw Error('Invalid workspace prefix.');
    check();
    async function readSnapshot(){
      return {global:await V.readJson(dir,P.indexPath),local:await V.readJson(dir,P.resourcePath(prefix,'chats')),
        configuration:await V.readJson(dir,P.resourcePath(prefix,'configuration'))};
    }
    async function claims(when){
      try{const rows=await V.inspectWriterClaims(dir);report.writer_claims[when]=V.writerClaimSummary(rows,accountId);
        if(rows.length)report.provisional=true;}
      catch(e){report.provisional=true;issue('writer_claims_unavailable',{when,error:safeError(e)});}
    }
    await claims('before');
    let initial;
    try{initial=await readSnapshot();}
    catch(e){check();report.complete=false;report.provisional=true;issue('index_read_failed',{error:safeError(e)});return finish();}
    check();
    const g=initial.global,l=initial.local,config=initial.configuration;
    if(!g)issue('global_index_absent');
    if(!l)issue('workspace_index_absent');
    if(g&&(g.schema!==P.indexSchema||!['chats','sources','metadata'].every(k=>dict(g[k])))){
      report.complete=false;report.provisional=true;issue('invalid_global_index');return finish();
    }
    if(l&&(l.schema!==P.workspaceSchema||l.account_id!==accountId||!dict(l.chats))){
      report.complete=false;report.provisional=true;issue('invalid_workspace_index');return finish();
    }
    const configOwned=config?.active_scope?.account_id===accountId||config?.identity?.account_id===accountId;
    if(config&&!configOwned)issue('configuration_scope_mismatch');
    const projectNames=new Map((configOwned&&Array.isArray(config?.projects?.items)?config.projects.items:[])
      .filter(x=>projectId(x?.id)).map(x=>[projectId(x.id),String(x.name||'')]));
    const files=new Map(), seen=new Map(), projectPaths=new Map(), metadataPaths=new Map(), claimed=new Set(), managedChats=new Map();
    function addProject(map,id,folder){
      id=projectId(id);if(!id||!folder||['_Unassigned','_GPTs','_Library','Deleted'].includes(folder))return;
      if(!map.has(id))map.set(id,new Set());map.get(id).add(folder);
    }
    function addSeen(id,path){
      if(!validId(id))return;
      if(!seen.has(id))seen.set(id,new Set());seen.get(id).add(path);
    }
    let truncated=false;
    async function walk(handle,path,depth){
      check();
      if(depth>MAX_DEPTH){report.complete=false;issue('directory_depth_limit',{path});return;}
      try{
        for await(const [name,h] of handle.entries()){
          check();
          if(truncated)break;
          const next=path+'/'+name;
          if(!inside(next)){report.complete=false;issue('unsafe_filesystem_path',{parent:path});continue;}
          if(h.kind==='directory')await walk(h,next,depth+1);
          else if(h.kind==='file'){
            if(files.size>=MAX_FILES){report.complete=false;truncated=true;issue('file_count_limit');break;}
            files.set(next,h);
            if(files.size%100===0)progress('Enumerated '+files.size+' files');
          }
        }
      }catch(e){check();report.complete=false;report.counts.read_errors++;issue('directory_read_failed',{path,error:safeError(e)});}
    }
    try{
      const [provider,workspace]=prefix.split('/');
      const providerHandle=await dir.getDirectoryHandle(provider,{create:false});
      const workspaceHandle=await providerHandle.getDirectoryHandle(workspace,{create:false});
      await walk(workspaceHandle,prefix,0);
    }catch(e){check();report.complete=false;issue('workspace_directory_unavailable',{error:safeError(e)});return finish();}
    report.counts.files=files.size;
    // Project metadata is diagnostic evidence, not a path authority. Read only
    // the small leading section, never copy project instructions into the report.
    for(const [path,h] of files){
      check();
      if(!/\/_project\.md$/i.test(path)||path.slice(prefix.length+1).split('/').length!==2)continue;
      try{
        const t=await (await h.getFile()).slice(0,32768).text();
        const id=projectId(/^\| Project ID \| `([^`]+)` \|/m.exec(t)?.[1]||/^project_id:\s*"?([^"\r\n]+)"?$/m.exec(t)?.[1]);
        if(id){addProject(metadataPaths,id,top(path,prefix));addProject(projectPaths,id,top(path,prefix));}
        else issue('project_metadata_id_unknown',{path});
      }catch(e){report.counts.read_errors++;issue('project_metadata_read_failed',{path,error:safeError(e)});}
    }
    const accountPrefix=accountId+'|';
    const globalRows=kind=>Object.entries(g?.[kind]||{}).filter(([key])=>key.startsWith(accountPrefix));
    const chatRows=new Map(Object.entries(l?.chats||{}).map(([id,rec])=>[id,{rec,legacy:false}]));
    for(const [key,rec] of globalRows('chats')){
      const id=key.slice(accountPrefix.length);
      if(chatRows.has(id)){
        report.counts.legacy_shadowed++;
        if(rec?.path!==chatRows.get(id).rec?.path)issue('legacy_chat_path_differs',{id});
      }else chatRows.set(id,{rec,legacy:true});
    }
    async function verify(kind,id,rec,legacy=false){
      check();
      const out={kind,id,legacy,status:'unknown'};
      if(report.records.length<MAX_FILES)report.records.push(out);else{report.complete=false;issue('record_count_limit');return;}
      if(!dict(rec)||!inside(rec.path)){out.status='invalid_record';issue('invalid_index_record',{kind,id});return;}
      const path=rec.path;out.path=path;claimed.add(path);
      if(kind==='chat'){
        managedChats.set(path,{id,rec,legacy});
        if(!validId(id)||!legacy&&rec.conversation_id!==id)issue('chat_index_identity_mismatch',{id,path});
      }
      if(rec.pending){report.counts.pending_sources++;issue('pending_source_commit',{id,path});}
      const h=files.get(path);
      if(!h){
        if(report.complete){out.status='missing';report.counts.missing++;issue('missing_indexed_file',{kind,id,path});}
        else{out.status='unverified';issue('file_not_observed_in_incomplete_scan',{kind,id,path});}
        return;
      }
      try{
        const file=await h.getFile();out.actual_bytes=file.size;out.expected_bytes=Number.isSafeInteger(rec.bytes)?rec.bytes:null;
        if(out.expected_bytes===null||out.expected_bytes<0||!/^[a-f0-9]{64}$/i.test(rec.sha256||'')){
          out.status='invalid_record';issue('invalid_index_size_or_hash',{kind,id,path});return;
        }
        if(file.size!==rec.bytes){out.status='size_mismatch';report.counts.size_mismatch++;issue('size_mismatch',{kind,id,path,expected:rec.bytes,actual:file.size});return;}
        report.counts.size_verified++;out.status='size_verified';
        if(full){
          const hash=await V.digestStream(file);
          if(hash.toLowerCase()!==rec.sha256.toLowerCase()){
            out.status='hash_mismatch';report.counts.hash_mismatch++;issue('hash_mismatch',{kind,id,path});}
          else{out.status='hash_verified';report.counts.hash_verified++;}
        }
      }catch(e){out.status='read_error';report.counts.read_errors++;issue('file_read_failed',{kind,id,path,error:safeError(e)});}
    }
    report.counts.indexed_chats=chatRows.size;
    for(const [id,{rec,legacy}] of chatRows){
      await verify('chat',id,rec,legacy);
      if(!inside(rec?.path))continue;
      const folder=top(rec.path,prefix);
      let pid=projectId(rec.project_id);
      if(!pid&&legacy){try{pid=projectId(JSON.parse(rec.remote_fingerprint||'{}').project_id);}catch{}}
      if(pid){
        addProject(projectPaths,pid,folder);
        if(folder==='_Unassigned'||folder==='_GPTs'||folder==='_Library')issue('project_chat_in_special_container',{id,path:rec.path,project_id:pid});
      }
    }
    for(const [key,rec] of globalRows('sources')){
      report.counts.indexed_resources++;
      await verify('resource',key.slice(accountPrefix.length),rec);
      if(inside(rec?.path))addProject(projectPaths,rec.project_id,top(rec.path,prefix));
    }
    for(const [key,rec] of globalRows('metadata')){
      report.counts.indexed_metadata++;
      // metadata keys in the old format include the path; do not export
      // an out-of-workspace key supplied by an untrusted index.
      await verify('metadata',inside(rec?.path)?rec.path.slice(prefix.length+1):'invalid',rec);
    }
    // Identify conversation files by their exported filename and optionally
    // their YAML header. Never treat Markdown in Sources/Library as a chat.
    for(const [path,h] of files){
      check();
      const indexed=managedChats.get(path), name=path.split('/').at(-1);
      if(!chatDirectory(path,prefix)||!name.endsWith('.md')||name.startsWith('_')&&!indexed&&!chatIdFromName(name)){
        if(isResource(path,prefix)&&!claimed.has(path)){
          report.counts.unindexed_resources++;issue('unindexed_resource',{path});
        }
        continue;
      }
      if(name==='_project.md'||name==='_sources.md')continue;
      const fromName=chatIdFromName(name);
      let header=null;
      if(full||!fromName&&!indexed){
        try{header=await V.readChatHeader(await h.getFile());}
        catch(e){report.counts.read_errors++;issue('chat_header_read_failed',{path,error:safeError(e)});}
      }
      const id=header?.conversation_id||fromName||indexed?.id;
      if(!validId(id))continue;
      report.counts.chat_files++;addSeen(id,path);
      if(full&&!header)issue('chat_header_unverified',{id,path});
      if(indexed&&id!==indexed.id)issue('chat_file_identity_mismatch',{id,index_id:indexed.id,path});
      if(fromName&&header&&fromName!==header.conversation_id)issue('filename_header_identity_mismatch',{id,path});
      if(!indexed){report.counts.unindexed_chats++;issue('unindexed_chat',{id,path});}
      const pid=projectId(indexed?.rec?.project_id||header?.project_id);
      if(pid)addProject(projectPaths,pid,top(path,prefix));
    }
    for(const [id,paths] of seen)if(paths.size>1){report.counts.duplicate_chats++;issue('duplicate_chat_id',{id,paths:[...paths]});}
    for(const [id,dirs] of projectPaths)if(dirs.size>1){
      report.counts.split_projects++;issue('split_project',{project_id:id,display_name:projectNames.get(id)||null,directories:[...dirs].sort()});
    }
    for(const [id,{rec,legacy}] of chatRows){
      if(!inside(rec?.path))continue;
      let pid=projectId(rec.project_id);
      if(!pid&&legacy){try{pid=projectId(JSON.parse(rec.remote_fingerprint||'{}').project_id);}catch{}}
      const folder=top(rec.path,prefix), known=metadataPaths.get(pid),gpt=V.storage.gptId(rec.gpt_id);
      if(pid&&(folder==='_Unassigned'||folder==='_GPTs'||folder==='_Library'||known?.size===1&&!known.has(folder)||
        /^Project_[a-z0-9]+$/i.test(folder)&&projectNames.has(pid))||gpt&&folder!=='_GPTs'){
        report.counts.misplaced_chats++;issue('chat_container_mismatch',{id,path:rec.path,project_id:pid||null,gpt_id:gpt||null,
          expected_directories:known?[...known]:[]});
      }
    }
    await claims('after');
    try{const after=await readSnapshot();if(JSON.stringify(initial)!==JSON.stringify(after)){report.provisional=true;issue('indexes_changed_during_scan');}}
    catch(e){report.complete=false;report.provisional=true;issue('final_snapshot_failed',{error:safeError(e)});}
    check();return finish();
  }
  return {scan,chatIdFromName};
};
if(typeof module!=='undefined'&&module.exports)module.exports={create};
if(root.ChatArchiveVault)root.ChatArchiveVaultIntegrity=create(root.ChatArchiveVault);
})(globalThis);
