/* Pure Library job policy. Content provenance is independent of where a file is used. */
(function(root){
  'use strict';
  const I=root.ChatArchiveLibraryInventory;
  const validFile=id=>I.goodFile(id);
  function sourceSets(refs=[],archivedSources=[]){
    // Project membership does not prove that a copy has been committed to Vault.
    // Every archivedSources entry must explicitly confirm an existing on-disk
    // copy with a matching SHA-256, not merely an index entry.
    return {files:new Set([...refs,...archivedSources].map(x=>x.file_id).filter(validFile)),
      libraries:new Set(refs.map(x=>x.library_file_id).filter(Boolean)),
      verifiedFiles:new Set(archivedSources.filter(x=>x.verified===true).map(x=>x.file_id).filter(validFile))};
  }
  function managed(item,sets){
    return (item.contexts||[]).includes('project_source') || sets?.files.has(item.file_id) ||
      (item.library_locations||[]).some(l=>sets?.libraries.has(l.library_id));
  }
  function eligible(item,sets){
    if(item.source_only || !(item.sources||[]).some(x=>x==='library'||x==='images'))
      return {selectable:false,reason:'Project Source reference only; use Project Sources export'};
    if(!validFile(item.file_id))return {selectable:false,reason:'No original file identifier'};
    if(sets?.verifiedFiles?.has(item.file_id))
      return {selectable:false,reason:'Matching Project Source original verified in Vault'};
    if((item.library_locations||[]).some(x=>/mounted|external|connector/i.test(x.access_kind||'')))
      return {selectable:false,reason:'External storage is outside this export'};
    if(['page','site','space','slides'].includes(item.library_artifact_type))
      return {selectable:false,reason:'Native object export is not implemented'};
    if(Number.isFinite(item.file_size_bytes)&&item.file_size_bytes>512*1024*1024)
      return {selectable:false,reason:'Above the 512 MiB file limit'};
    return {selectable:true,reason:'Original can be requested; availability is not yet verified'};
  }
  function bornAt(item){
    // A changed title/updated_at is not evidence of a new file. No clock/first-seen fallback.
    const t=item.created_at||item.file_upload_time||item.gallery?.created_at;
    const value=typeof t==='number'?(t<1e11?t*1000:t):Date.parse(t||'');
    return Number.isFinite(value)?value:null;
  }
  function newAfter(item,knownIds,baselineAt){
    if(knownIds.has(item.id))return false;
    const t=bornAt(item),cutoff=Date.parse(baselineAt||'');
    return t!==null&&Number.isFinite(cutoff)&&t>cutoff;
  }
  function decorate(catalog,refs=[],archivedSources=[]){
    const sets=sourceSets(refs,archivedSources);
    for(const item of catalog.items){
      item.managed_by_project_sources=!!managed(item,sets);
      item.source_copy_verified=!!(validFile(item.file_id)&&sets.verifiedFiles.has(item.file_id));
      item.source_archive_status=item.source_copy_verified?'verified':item.managed_by_project_sources?'unverified':'not_linked';
      item.archive_eligibility=eligible(item,sets);
      if(item.source_copy_verified)item.enrichment_status='source_copy_verified';
      else if(item.enrichment_status==='source_copy_verified')delete item.enrichment_status;
    }
    return catalog;
  }
  function summarize(items){
    const summary={total:items.length,library_files:0,images_gallery:0,images_unique:0,image_only:0,
      folders:0,by_origin:{uploaded:0,generated:0,unknown:0},by_media:{image:0,file:0},groups:{},by_context:{},
      selectable:0,project_source_excluded:0,project_source_linked:0,project_source_only:0,classified:0};
    const galleries=new Set();
    for(const item of items){
      if(item.sources?.includes('library'))summary.library_files++;
      if(item.sources?.includes('images')){summary.images_unique++;if(!item.sources?.includes('library'))summary.image_only++;}
      for(const id of item.gallery_ids||[])galleries.add(id);
      const o=item.origin||'unknown',m=item.media_class==='image'?'image':'file';
      summary.by_origin[o]=(summary.by_origin[o]||0)+1;summary.by_media[m]++;
      summary.groups[o+'/'+m]=(summary.groups[o+'/'+m]||0)+1;
      for(const c of item.contexts||[])summary.by_context[c]=(summary.by_context[c]||0)+1;
      if(item.archive_eligibility?.selectable)summary.selectable++;
      if(item.managed_by_project_sources)summary.project_source_linked++;
      if(item.source_copy_verified)summary.project_source_excluded++;
      if(item.source_only)summary.project_source_only++;
      if(o!=='unknown')summary.classified++;
    }
    summary.images_gallery=galleries.size;return summary;
  }
  function mergeIncremental(previous,fresh,baselineAt){
    const known=new Map((previous?.items||[]).map(x=>[x.id,structuredClone(x)]));
    let added=0,older=0,undated=0,promoted=0;
    for(const x of fresh.items||[]){
      // References are not binaries; a formerly Source-only file may become
      // discoverable through Library without being newly created on the server.
      if(x.source_only)continue;
      if(known.has(x.id)){
        if(known.get(x.id)?.source_only){known.set(x.id,x);promoted++;}
        continue;
      }
      if(newAfter(x,new Set(),baselineAt)){known.set(x.id,x);added++;}
      else if(bornAt(x)===null)undated++;else older++;
    }
    const items=[...known.values()];
    return {...fresh,items,summary:{...summarize(items),folders:fresh.folders?.length||0},
      incremental:{added,promoted_from_source_only:promoted,older_not_enrolled:older,undated_not_enrolled:undated},
      // No automatic deletion, reclassification or rewriting of old entries.
      unmatched_project_refs:mergeRefs(previous?.unmatched_project_refs||[],fresh.unmatched_project_refs||[])};
  }
  function mergeRefs(a,b){const m=new Map();for(const x of [...a,...b])m.set(x.project_id+'|'+(x.source_record_id||x.file_id||x.library_file_id),x);return [...m.values()];}
  const api={sourceSets,managed,eligible,bornAt,newAfter,decorate,summarize,mergeIncremental,mergeRefs};
  root.ChatArchiveLibraryPolicy=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
