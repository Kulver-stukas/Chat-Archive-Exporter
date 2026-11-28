/* Read-only v1 -> v2 migration planning. No write or execution API. */
(function(root){
const create=function createPlanner(V,S,I){
  'use strict';
  const P=V.storage, cmp=(a,b)=>a<b?-1:a>b?1:0;
  const pid=x=>P.isProject(x)?P.canonical(x):'';
  const gid=x=>P.gptId(x);
  const idOK=x=>typeof x==='string'&&/^[a-z0-9_-]{8,128}$/i.test(x);
  const hashOK=x=>typeof x==='string'&&/^[a-f0-9]{64}$/i.test(x);
  const hash=x=>hashOK(x)?x.toLowerCase():null;
  const bytes=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const text=(x,n=500)=>typeof x==='string'?x.slice(0,n):null;
  const array=x=>Array.isArray(x)?x:[];
  const mapAdd=(m,k,v)=>{if(!m.has(k))m.set(k,new Set());m.get(k).add(v);};
  function fingerprint(r){try{return JSON.parse(r?.remote_fingerprint||'null')||{};}catch{return {};}}
  function chatIdentity(row,h,live){
    const r=row.rec||{},fp=fingerprint(r);
    const ledgerProject=pid(r.project_id)||pid(fp.project_id),
      ledgerGPT=gid(r.gpt_id)||gid(fp.gpt_id)||gid(fp.project_id);
    const headerProject=pid(h?.project_id)||pid(P.projectFromHeader?.(h)),
      headerGPT=gid(h?.container_id);
    // A modern ledger's explicit empty project/gpt fields are meaningful.
    // Legacy records may have only a source URL or list fingerprint.
    const stored=ledgerProject?{type:'project',id:ledgerProject}:
      ledgerGPT?{type:'gpt',id:ledgerGPT}:
      !row.legacy&&(Object.hasOwn(r,'project_id')||Object.hasOwn(r,'gpt_id'))?{type:'unassigned',id:null}:
      headerProject?{type:'project',id:headerProject}:headerGPT?{type:'gpt',id:headerGPT}:
      {type:'unknown',id:null};
    let target=stored,source='archive_ledger';
    if(row.legacy)source=ledgerProject||ledgerGPT?'legacy_list_marker':headerProject||headerGPT?'legacy_header':'unknown';
    if(live){
      const p=pid(live.projectId),g=gid(live.gptId);
      if(p||g||live.containerObserved===true){target=p?{type:'project',id:p}:g?{type:'gpt',id:g}:{type:'unassigned',id:null};source='verified_chats_list';}
    }
    return {...target,source,stored,header_project_id:headerProject||null,header_gpt_id:headerGPT||null,
      ambiguous:Boolean(ledgerProject&&ledgerGPT||live&&pid(live.projectId)&&gid(live.gptId))};
  }
  function logicalSource(key,r){
    const p=pid(r?.project_id)||pid(key.split(':')[0]);
    return p?{type:'project',id:p}:key.startsWith('library:')?{type:'library',id:null}:{type:'unknown',id:null};
  }
  function physicalFolder(rel){const p=rel.split('/');return p[0]==='_GPTs'&&p.length>2?p.slice(0,2).join('/'):p.length>1?p[0]:null;}
  async function inventory(e,options){
    const {prefix,accountId,config,files,directories,headers,projectHeaders,chatRows,sourceRows,metadataRows,providerHandle,report,check,progress}=e;
    const rel=p=>p.slice(prefix.length+1);
    const inside=p=>typeof p==='string'&&V.validPath(p)&&p.startsWith(prefix+'/');
    const findings=[],seen=new Set();
    function finding(code,details={},severity='blocker'){
      const k=code+'|'+JSON.stringify(details);if(seen.has(k))return;seen.add(k);
      findings.push({code,severity,...details});
    }
    const occupied=[];
    for await(const [name] of providerHandle.entries()){check();if(name!==prefix.split('/')[1])occupied.push(name);if(occupied.length>30000)throw Error('Workspace directory limit exceeded.');}
    const ci=config?.identity?.account_id===accountId?config.identity:null;
    const ident={account_id:accountId,scope_type:ci?.scope_type||config?.active_scope?.scope_type||'unknown',
      user_name:text(ci?.user_name,200),workspace_name:text(ci?.workspace_name,200),display_name:text(ci?.display_name,200),
      plan_type:text(ci?.plan_type,40)};
    const live=options.live?.account_id===accountId&&options.live.source==='live_api'?options.live:null;
    const ws=S.workspace({id:accountId,display:options.display,identity:ident,occupied});
    if(ws.name_source==='unknown'||ws.type==='Unknown')finding('workspace_name_or_type_unavailable',{},'review');
    if(!ws.plan_type&&ws.scope_type==='workspace')finding('workspace_plan_not_exposed',{fallback:ws.type},'review');
    const registry=new Map(),folderEvidence=new Map(),inferredFolders=new Map();
    function add(type,id,name,origin,rank=0){
      if(!id)return;
      const k=S.key(type,id);let r=registry.get(k);
      if(!r){r={type,id,name:null,name_source:'unknown',rank:-1,previous_directories:[],observed:false};registry.set(k,r);}
      if(name&&rank>r.rank){r.name=text(name,250);r.name_source=origin;r.rank=rank;}
      if(rank>=4)r.observed=true;
      return r;
    }
    function bind(folder,type,id,strong=true){
      if(!folder||!id||['_Unassigned','_Library','_GPTs','Deleted','.cae'].includes(folder))return;
      const k=S.key(type,id);
      mapAdd(strong?folderEvidence:inferredFolders,folder,k);
    }
    for(const x of array(config?.projects?.items))add('project',pid(x?.id),x.name,'workspace_configuration',3);
    for(const x of array(config?.custom_gpts?.items))add('gpt',gid(x?.id),x.name,'workspace_configuration',3);
    for(const x of array(live?.projects))add('project',pid(x?.id),x.name,'verified_chats_list',5);
    const liveChats=new Map(array(live?.chats).filter(x=>idOK(x?.id)).map(x=>[x.id,x]));
    for(const x of liveChats.values()){
      add('project',pid(x.projectId),x.project,'verified_chats_list',4);
      add('gpt',gid(x.gptId),x.gptName,'verified_chats_list',4);
    }
    for(const [path,h] of projectHeaders){
      if(!inside(path)||!pid(h.id))continue;
      if(h.workspace_id&&h.workspace_id!==accountId){finding('project_metadata_workspace_mismatch',{path});continue;}
      add('project',pid(h.id),h.name,'project_metadata',2);bind(physicalFolder(rel(path)),'project',pid(h.id));
    }
    for(const [key,r] of sourceRows){
      if(!inside(r?.path))continue;
      const k=key.slice(accountId.length+1),o=logicalSource(k,r);
      if(o.type==='project'){add('project',o.id,null,'source_index');bind(physicalFolder(rel(r.path)),'project',o.id);}
    }
    const chats=new Map();
    for(const [id,row] of chatRows){
      const r=row.rec||{};if(!idOK(id)||!inside(r.path)){finding('invalid_chat_index_entry',{id:idOK(id)?id:null});continue;}
      const h=headers.get(r.path),current=liveChats.get(id),o=chatIdentity(row,h,current);
      if(o.ambiguous)finding('ambiguous_chat_container',{id,path:r.path});
      if(o.type==='unknown')finding('unresolved_chat_container',{id,path:r.path});
      const old=o.stored,folder=physicalFolder(rel(r.path));
      if(old.id){
        const name=old.type==='gpt'?r.gpt_name||h?.gpt:pid(h?.project_id)===old.id?h?.project:null;
        add(old.type,old.id,name,'archived_chat',1);
        // A chat can have been moved. Never let its ledger reassign a folder
        // already identified by project metadata or resource placement.
        bind(folder,old.type,old.id,false);
      }
      if(o.id)add(o.type,o.id,o.type==='gpt'?current?.gptName||r.gpt_name:current?.project,'chat_identity',1);
      chats.set(id,{row,o,header:h,current});
    }
    for(const [folder,keys] of inferredFolders){
      if(folderEvidence.has(folder))continue;
      // Exact fallback ID suffix and typed GPT paths are useful only when
      // matched to a full ID, never interpreted as the ID itself.
      const suffix=/(?:^Project_| \[)([a-z0-9]{8,32})(?:\])?$/i.exec(folder)?.[1];
      const matching=[...keys].filter(k=>suffix&&k.toLowerCase().endsWith(suffix.toLowerCase()));
      if(matching.length===1)folderEvidence.set(folder,new Set(matching));
      else if(keys.size===1)folderEvidence.set(folder,keys);
      else finding('ambiguous_legacy_directory',{directory:folder,container_keys:[...keys]});
    }
    for(const [folder,keys] of folderEvidence){
      if(keys.size!==1){finding('ambiguous_legacy_directory',{directory:folder,container_keys:[...keys]});continue;}
      const k=[...keys][0],r=registry.get(k);if(!r)continue;
      r.previous_directories.push(folder);
      if(!r.name){
        const oldLabel=folder.split('/').at(-1);
        // Keep an old human-readable label only if the folder is tied to ID
        // evidence. Do not repeat generated GPT/fallback suffixes.
        if(!/^Project_[a-z0-9]+$/i.test(oldLabel)&&!/^GPT(?: \[[a-z0-9]+\])+$/i.test(oldLabel))
          add(r.type,r.id,oldLabel,'legacy_directory_label',0);
      }
    }
    const containers=S.containers([...registry.values()]).map(c=>{
      const r=registry.get(S.key(c.type,c.id));return {...c,remote_state:r.observed?'observed':'unknown',
        local_state:c.previous_directories.length?'retained':'not_observed'};
    });
    const layout=S.layout(P.folderName||'ChatGPT',ws,containers),containerByKey=new Map(containers.map(x=>[S.key(x.type,x.id),x]));
    const folderMap=new Map();
    for(const c of containers)for(const d of c.previous_directories)folderMap.set(d,c);
    const legacyControls={'.workspace.json':'chats.json','.sync.json':'sync.json','.preferences.json':'preferences.json',
      '.activity-manual.json':'activity-manual.json','.activity-library.json':'activity-library.json'};
    const targetsByPath=new Map(),claims=new Map(),recordsByPath=new Map();
    for(const r of report.records)if(inside(r.path)){if(!recordsByPath.has(r.path))recordsByPath.set(r.path,[]);recordsByPath.get(r.path).push(r);}
    function addClaim(path,claim){if(!claims.has(path))claims.set(path,[]);claims.get(path).push(claim);}
    const recordProjection=(r)=>({recorded_bytes:bytes(r?.bytes),recorded_sha256:hash(r?.sha256),pending:Boolean(r?.pending),
      ready_to_commit:r?.ready_to_commit===true,deleted_at:text(r?.deleted_at,80),saved_at:text(r?.saved_at,80)});
    for(const [id,c] of chats){
      const r=c.row.rec;addClaim(r.path,{kind:'chat',id,legacy:c.row.legacy,...recordProjection(r),container_type:c.o.type,
        container_id:c.o.id,placement_evidence:c.o.source,title:text(c.current?.title||r.title||c.header?.title,500),
        revision:{updated:text(r.updated||c.header?.updated,80),exported:text(r.exported||c.header?.exported,80),archived:Boolean(r.archived??c.header?.archived)}});
    }
    for(const [key,r] of sourceRows){
      if(!inside(r?.path)){finding('invalid_resource_index_entry');continue;}
      const k=key.slice(accountId.length+1),o=logicalSource(k,r);
      addClaim(r.path,{kind:'resource',id:text(k,500),file_id:text(r.file_id,150),container_type:o.type,container_id:o.id,...recordProjection(r)});
    }
    for(const [key,r] of metadataRows){
      if(!inside(r?.path)){finding('invalid_metadata_index_entry');continue;}
      addClaim(r.path,{kind:'metadata',id:text(key.slice(accountId.length+1),1000),...recordProjection(r)});
    }
    function folderDestination(relative){
      const p=relative.split('/');
      if(['_Unassigned','_Library','Deleted'].includes(p[0]))return layout.prefix+'/'+relative;
      if(p[0]==='_GPTs'){
        if(p.length===1)return layout.prefix+'/_GPTs';
        const c=folderMap.get(p.slice(0,2).join('/'));
        if(c)return layout.path(c.type,c.id)+(p.length>2?'/'+p.slice(2).join('/'):'');
        return null;
      }
      const c=folderMap.get(p[0]);if(!c)return null;
      if(p[1]==='deleted')return layout.prefix+'/Deleted/'+(c.type==='project'?'Projects/':'GPTs/')+c.directory_name+'/Sources'+(p.length>2?'/'+p.slice(2).join('/'):'');
      return layout.path(c.type,c.id)+(p.length>1?'/'+p.slice(1).join('/'):'');
    }
    function destination(path,rows){
      const relative=rel(path),p=relative.split('/'),name=p.at(-1),c=rows.find(x=>x.kind==='chat'),r=rows.find(x=>x.kind==='resource');
      if(c){
        if(c.container_type==='unknown')return null;
        return layout.path(c.container_type,c.container_id)+'/'+name;
      }
      if(r&&r.container_type==='project'){
        const folder=containerByKey.get(S.key('project',r.container_id));
        if(!folder)return null;
        const rest=p.slice(1); // preserve the stored relative Source filename
        if(r.deleted_at||rest[0]==='deleted'){
          if(!r.deleted_at)finding('legacy_deleted_location_without_status',{path},'review');
          return layout.prefix+'/Deleted/Projects/'+folder.directory_name+'/Sources/'+(rest[0]==='Sources'||rest[0]==='deleted'?rest.slice(1):rest).join('/');
        }
        if(rest[0]!=='Sources'){finding('unexpected_project_resource_path',{path});return null;}
        return layout.path('project',r.container_id)+'/'+rest.join('/');
      }
      if(r&&r.container_type==='library'&&p[0]!=='_Library'){finding('unexpected_library_path',{path});return null;}
      if(p.length===1){
        if(Object.hasOwn(legacyControls,name))return layout.control(legacyControls[name]);
        // Keep readable exports in the workspace. No path inference for other
        // control files (including pre-existing v2 data).
        return layout.prefix+'/'+name;
      }
      return folderDestination(relative);
    }
    const entries=[];
    let i=0;
    for(const [path,h] of [...files].sort(([a],[b])=>cmp(a,b))){
      check();if(++i%20===0)progress('Planning '+i+'/'+files.size+' files');
      const rows=claims.get(path)||[],auditRecords=recordsByPath.get(path)||[],target=destination(path,rows);
      const relative=rel(path),control=Object.hasOwn(legacyControls,relative);
      const x={source:path,target,action:control?'convert_control':rows.length?'copy_verified':'preserve_unindexed',
        status:'ready_for_review',claims:rows,observed_bytes:null,observed_sha256:null,observed_last_modified:null};
      const block=(code,extra={})=>{x.status='blocked';finding(code,{path,...extra});};
      if(!target||!V.validPath(target))block('unresolved_or_unsafe_target');
      if(target&&!target.startsWith(layout.prefix+'/'))block('target_outside_workspace');
      if(rows.filter(r=>r.kind==='chat').length>1||rows.filter(r=>r.kind==='resource').length>1||new Set(rows.map(r=>r.kind)).size>1)block('multiple_resource_claims');
      if(rows.length>1&&rows.every(r=>r.kind==='metadata')){
        if(new Set(rows.map(r=>JSON.stringify([r.recorded_bytes,r.recorded_sha256]))).size>1)block('divergent_metadata_aliases');
        else finding('metadata_aliases',{path},'review');
      }
      if(!rows.length&&!control){x.status='blocked';finding('unindexed_physical_file',{path});}
      if(rows.some(r=>r.pending))block('pending_resource_commit');
      if(relative.startsWith('.cae/'))block('existing_v2_control_data');
      try{
        const file=await h.getFile();x.observed_bytes=file.size;x.observed_last_modified=Number.isFinite(file.lastModified)?file.lastModified:null;
        // The full audit checked indexed files; hash again only when no
        // observed checksum was available. A new hash is evidence, not an
        // authorization to adopt an untracked or divergent file.
        // Re-hash all files for this plan to bind the observed bytes to it.
        x.observed_sha256=hash(await V.digestStream(file));
        const after=await h.getFile();
        if(after.size!==file.size||after.lastModified!==file.lastModified)block('file_changed_during_plan');
        if(!x.observed_sha256)block('invalid_observed_hash');
        if(rows.some(r=>r.recorded_bytes===null||!r.recorded_sha256))block('incomplete_index_evidence');
        if(rows.some(r=>r.recorded_bytes!==null&&r.recorded_bytes!==x.observed_bytes||r.recorded_sha256&&r.recorded_sha256!==x.observed_sha256))block('recorded_file_divergence');
      }catch(err){check();block('file_read_failed',{error:String(err?.name||'Error').slice(0,80)});}
      const chat=rows.find(r=>r.kind==='chat');
      if(chat){
        const info=chats.get(chat.id),h=info?.header;
        if(!h||h.conversation_id!==chat.id)block('chat_header_identity_unverified');
        if(info?.o.ambiguous)block('ambiguous_chat_identity');
        if(info?.o.header_project_id&&info.o.header_project_id!==chat.container_id&&info.o.source!=='verified_chats_list')
          finding('historical_header_project_differs',{path,header_project_id:info.o.header_project_id,planned_container_id:chat.container_id},'review');
        const filenameTitle=nameFromPath(path);
        if(chat.title&&filenameTitle&&S.fold(chat.title)!==S.fold(filenameTitle))finding('chat_filename_title_differs',{path},'review');
      }
      if(rows.some(r=>r.kind==='metadata'))x.action='rewrite_metadata_references';
      if(control)x.action='convert_control';
      if(target)mapAdd(targetsByPath,S.fold(target),path);
      entries.push(x);
    }
    function nameFromPath(p){return /([^/]+) \[[a-z0-9-]+\]\.md$/i.exec(p)?.[1]||null;}
    for(const [path,rows] of claims)if(!files.has(path))finding('indexed_file_missing',{path,kind:rows[0].kind});
    for(const [target,paths] of targetsByPath)if(paths.size>1){
      finding('target_path_collision',{target,source_paths:[...paths]});
      for(const x of entries)if(x.target&&S.fold(x.target)===target)x.status='blocked';
    }
    const directoriesPlan=[];
    for(const d of [...directories].sort(cmp)){
      const relative=rel(d),target=folderDestination(relative);
      // Some old chat-only containers can become empty after migration.
      // Preserve unknown empty directories rather than silently discard them.
      if(!target){
        if(!entries.some(x=>x.source.startsWith(d+'/')))finding('unresolved_empty_directory',{path:d});
        directoriesPlan.push({source:d,target:null,status:'review'});
      }else{
        if(targetsByPath.has(S.fold(target)))finding('file_directory_target_collision',{path:d,target});
        directoriesPlan.push({source:d,target,status:'proposed'});
      }
    }
    const controls=['workspace.json','containers.json','chats.json','resources.json','sync.json','preferences.json','activity-manual.json','activity-library.json'];
    return {schema:'cae.vault-migration-plan.v2',schema_version:2,provider:P.providerId||'chatgpt',account_id:accountId,
      source_prefix:prefix,target_prefix:layout.prefix,mode:'dry_run',execution_enabled:false,created_at:new Date().toISOString(),
      workspace:ws,container_registry:{schema:'cae.containers.v2',account_id:accountId,items:containers},
      live_metadata:{used:Boolean(live),captured_at:live?.captured_at||null,scope:'current_workspace_only'},
      planned_directories:[...new Set([...layout.reserved,...containers.filter(c=>c.previous_directories.length).map(c=>layout.path(c.type,c.id))])],
      planned_controls:controls.map(name=>layout.control(name)),global_control:{legacy_index:P.indexPath,retain_unchanged:true,
        proposed_root_manifest:'.cae/vault.json',proposed_provider_registry:'.cae/providers.json',proposed_migration_journal:'.cae/migrations/'},
      findings,entries,directories:directoriesPlan,
      counts:{files:entries.length,containers:containers.length,proposed_targets:entries.filter(x=>x.target).length,
        blocked_files:entries.filter(x=>x.status==='blocked').length},
      migration_requirements:['Stop all legacy writers across the Vault.','Revalidate current identity, all file hashes, all index revisions and target names.',
        'Copy and verify before committing new indexes; retain v1 originals until committed and rollback verified.',
        'Rewrite references transactionally; preserve source original names and bytes.','Resolve divergent, unknown and pending records before adoption.',
        'Do not activate v2 writers or change enrollment in this preview.']};
  }
  async function plan(dir,options={}){
    let draft=null;
    const report=await I.scan(dir,{...options,full:true,onInventory:async e=>{draft=await inventory(e,options);}});
    if(!draft)draft={schema:'cae.vault-migration-plan.v2',schema_version:2,provider:P.providerId||'chatgpt',account_id:options.accountId,
      source_prefix:report.prefix||null,target_prefix:null,mode:'dry_run',execution_enabled:false,created_at:new Date().toISOString(),
      findings:[],entries:[],directories:[],counts:{files:0,containers:0,proposed_targets:0,blocked_files:0}};
    draft.audit={complete:report.complete,provisional:report.provisional,counts:report.counts,issue_counts:report.issue_counts,
      started_at:report.started_at,finished_at:report.finished_at,issues_truncated:report.issues_truncated};
    if(!report.complete||report.provisional||report.issues_truncated||!draft.target_prefix)
      draft.findings.push({code:'incomplete_or_unstable_inventory',severity:'blocker'});
    for(const code of ['duplicate_chat_id','chat_file_identity_mismatch','filename_header_identity_mismatch','chat_index_identity_mismatch','legacy_chat_path_differs','configuration_scope_mismatch','invalid_index_record','file_not_observed_in_incomplete_scan']){
      if(report.issue_counts?.[code])draft.findings.push({code,severity:'blocker',count:report.issue_counts[code]});
    }
    draft.counts.blockers=draft.findings.filter(x=>x.severity==='blocker').length;
    draft.counts.review=draft.findings.filter(x=>x.severity==='review').length;
    draft.status=draft.counts.blockers?'blocked':'review_required';
    return draft;
  }
  return {plan,inventory,chatIdentity};
};
if(typeof module!=='undefined'&&module.exports)module.exports={create};
if(root.ChatArchiveVault&&root.CAEVaultSchemaV2&&root.ChatArchiveVaultIntegrity)
  root.CAEVaultMigrationV2=create(root.ChatArchiveVault,root.CAEVaultSchemaV2,root.ChatArchiveVaultIntegrity);
})(globalThis);
