/* Provider-specific Library enumeration, descriptor enrichment and catalog assembly.
 * IO is supplied by the job controller; commits, policy and checkpoints stay there. */
(function(root){
  'use strict';
  const MAX_NODES=15000,MAX_PAGES=120,MAX_FOLDERS=700;
  const iso=()=>new Date().toISOString(),err=(code,message)=>Object.assign(Error(message),{code});
  function job(kind){return {id:crypto.randomUUID(),kind,status:'queued',phase:'projects',started_at:new Date().toISOString(),next_at:0,
    cursor:null,seen_cursors:[],projects:[],refs:[],project_index:0,nodes:[],images:[],
    directories:[{id:null,depth:0,cursor:null,seen:[],pages:0}],directory_index:0,seen_directories:[],
    details:{},detail_errors:{},detail_index:0,targets:[],warnings:[],links_partial:false,
    counts:{library_pages:0,image_pages:0,project_pages:0,descriptors_cached:0,descriptors_excluded:0,descriptors_not_needed:0}};}
  function advanceCursor(j,next){
    if(next&&j.seen_cursors.includes(next))throw err('PAGINATION','Repeated pagination cursor; collection is incomplete.');
    if(next)j.seen_cursors.push(next);j.cursor=next;
  }
  async function collectStep(c,{page,readArchivedSources}){
    const I=root.ChatArchiveLibraryInventory,P=root.ChatArchiveLibraryPolicy;
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
      j.archived_sources=await readArchivedSources(c,new Set(catalog.items.map(x=>x.file_id).filter(Boolean)));
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
        if(!catalogChanged)return {catalog,changed:false};
      }
      return {catalog,changed:true};
    }
    return null;
  }
  root.ChatArchiveLibraryScan=Object.freeze({job,collectStep});
})(globalThis);
