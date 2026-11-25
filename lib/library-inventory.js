/* Read-only Library / generated-Images inventory helpers. No signed URLs or file bytes are retained. */
(function(root) {
  'use strict';
  const clean = (value, max = 240) => typeof value === 'string' ? value.slice(0, max) : null;
  const goodFile = id => typeof id === 'string' && /^file_[A-Za-z0-9_-]{8,140}$/.test(id);
  const goodNode = id => typeof id === 'string' && /^[A-Za-z0-9_-]{6,180}$/.test(id);
  const num = value => Number.isFinite(value) && value >= 0 ? value : null;
  const dateValue = value => {
    if (Number.isFinite(value)) {
      const millis=value<1e11?value*1000:value;
      const d=new Date(millis);
      return Number.isFinite(d.valueOf())?d.toISOString():null;
    }
    return clean(value,70);
  };
  function fileFromGallery(item) {
    if (goodFile(item?.file_id)) return item.file_id;
    // Gallery id (s_...) is not a physical file id. Only an actual content URL
    // for the allowed ChatGPT host may supply one; never return that URL.
    if (typeof item?.url !== 'string') return null;
    try {
      const u = new URL(item.url, 'https://chatgpt.com');
      if (u.origin !== 'https://chatgpt.com' || u.pathname !== '/backend-api/estuary/content') return null;
      const id = u.searchParams.get('id');
      return goodFile(id) ? id : null;
    } catch (_) { return null; }
  }
  function formatClass(mimeType, name, isGallery = false) {
    if (isGallery) return 'image';
    const mime = String(mimeType || '').toLowerCase().split(';')[0];
    const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] || '';
    const inSet = (s) => s.split(' ').includes(ext);
    if (mime.startsWith('image/') || inSet('png jpg jpeg webp gif svg bmp ico avif tiff tif')) return 'image';
    if (inSet('py js mjs cjs ts tsx jsx html htm css scss c cpp h hpp cs go rs java kt swift rb php sh bash ps1 bat lua r jl scala clj hs')) return 'code';
    if (inSet('json jsonl csv tsv yaml yml toml xml sql db sqlite parquet xls xlsx ods')) return 'data';
    if (inSet('pdf doc docx ppt pptx odt odp epub')) return 'office';
    if (inSet('zip tar gz tgz 7z rar bz2 xz')) return 'archive';
    if (inSet('txt md markdown rtf rst tex org log')) return 'text';
    if (mime.includes('spreadsheet') || mime.includes('csv') || mime.includes('json') || mime.includes('yaml') || mime.includes('xml') || mime.includes('sql')) return 'data';
    if (mime.includes('pdf') || mime.includes('wordprocessingml') || mime.includes('presentationml') || mime.includes('msword') || mime.includes('opendocument')) return 'office';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || mime.includes('compressed')) return 'archive';
    if (mime.includes('javascript') || mime.includes('python') || mime.includes('typescript') || mime.includes('html') || mime.includes('css') || mime.includes('x-c') || mime.includes('java') || mime.includes('shell')) return 'code';
    if (mime.startsWith('text/')) return 'text';
    return 'other';
  }
  function fromNode(node) {
    const kind = clean(node?.kind, 30);
    if (kind !== 'file' && kind !== 'directory' && kind !== 'folder') return null;
    const nodeId = goodNode(node?.id) ? node.id : (goodNode(node?.library_file_id) ? node.library_file_id : null);
    const fileId = goodFile(node?.file_id) ? node.file_id : null;
    return {
      kind, library_id: nodeId, file_id: fileId,
      name: clean(node?.name || node?.file_name, 300) || nodeId || fileId || '(unnamed)',
      mime_type: clean(node?.mime_type || node?.type, 120),
      file_extension: clean(node?.file_extension, 20),
      file_size_bytes: num(node?.file_size_bytes ?? node?.size),
      file_upload_time: dateValue(node?.file_upload_time),
      updated_at: dateValue(node?.updated_at),
      created_at: dateValue(node?.record_creation_time ?? node?.created_at),
      parent_directory_id: goodNode(node?.parent_directory_id) ? node.parent_directory_id : null,
      access_kind: clean(node?.access_kind, 30),
      library_file_category: clean(node?.library_file_category, 100),
      library_artifact_type: clean(node?.library_artifact_type, 100),
      image_gen_attribution: node?.image_gen_attribution === true ||
        (node?.image_gen_attribution && typeof node.image_gen_attribution === 'object' &&
         Object.keys(node.image_gen_attribution).length > 0) ? true : false,
      origination_thread_id: clean(node?.origination_thread_id, 120),
      origination_message_id: clean(node?.origination_message_id, 120),
      is_project: node?.is_project === true,
      state: clean(node?.state, 70)
    };
  }
  function fromImage(raw) {
    const galleryId = goodNode(raw?.id) ? raw.id : (goodNode(raw?.gallery_id) ? raw.gallery_id : null);
    const fileId = fileFromGallery(raw);
    if (!galleryId && !fileId) return null;
    return {
      gallery_id: galleryId, file_id: fileId,
      title: clean(raw?.title || raw?.prompt, 300),
      width: num(raw?.width), height: num(raw?.height),
      created_at: dateValue(raw?.created_at),
      conversation_id: clean(raw?.conversation_id, 120)
    };
  }
  // Metadata is deliberately allowlisted: no owner IDs, source IPs, signed
  // thumbnails, internal workflow objects, auth, or entire descriptor bodies.
  function fromDetail(raw) {
    const d = raw?.file || raw?.data || raw;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const m = d.metadata && typeof d.metadata === 'object' ? d.metadata : {};
    return {
      use_case: clean(d.use_case || m.use_case, 90),
      mime_type: clean(d.mime_type, 120),
      file_size_bytes: num(d.size ?? m.file_size_bytes),
      file_extension: clean(d.file_extension, 20),
      created_at: dateValue(d.creation_time),
      upload_source: clean(m.upload_source, 100),
      upload_mode: clean(m.upload_mode, 100),
      origin_service: clean(m.origin_service, 100),
      source_file_id: goodFile(m.source_file_id) ? m.source_file_id : null
    };
  }
  // Provenance describes the creation of content, not the upload mechanism or
  // placement (Library, Project Source, chat attachment, or Work output).
  function originFor(entry) {
    const votes=[];
    if (entry.sources?.includes('images'))
      votes.push({origin:'generated',evidence:'images_gallery',status:'confirmed'});
    const detail=entry.detail||{};
    const use=String(detail.use_case||'').toLowerCase();
    if (['image_gen','dalle','code_interpreter'].includes(use))
      votes.push({origin:'generated',evidence:`use_case:${use}`,status:'confirmed'});
    else if (use==='caas')
      votes.push({origin:'generated',evidence:'use_case:caas',status:'inferred'});
    else if (['my_files','ace_upload','multimodal'].includes(use))
      votes.push({origin:'uploaded',evidence:`use_case:${use}`,status:'inferred'});
    if (entry.image_gen_attribution)
      votes.push({origin:'generated',evidence:'image_gen_attribution',status:'inferred'});
    if (String(entry.library_artifact_type||'').toLowerCase()==='image_gen')
      votes.push({origin:'generated',evidence:'library_artifact_type:image_gen',status:'inferred'});
    const category=String(entry.library_file_category||'').toLowerCase();
    if (['user_uploaded','uploaded','uploaded_file'].includes(category))
      votes.push({origin:'uploaded',evidence:`library_file_category:${category}`,status:'confirmed'});
    if (['generated','chatgpt_generated','assistant_generated'].includes(category))
      votes.push({origin:'generated',evidence:`library_file_category:${category}`,status:'confirmed'});
    // upload_source=user means that a service transported the file into the
    // Library under the user's account. It does NOT establish who authored it.
    // The same applies to gizmo, codex and project_save / sediment signals.
    const choices=new Set(votes.map(v=>v.origin));
    if(choices.size>1)return {origin:'unknown',origin_status:'conflicting',origin_evidence:votes.map(v=>v.evidence)};
    if(!votes.length)return {origin:'unknown',origin_status:'unavailable',origin_evidence:[]};
    return {origin:votes[0].origin,origin_status:votes.every(v=>v.status==='confirmed')?'confirmed':'inferred',origin_evidence:votes.map(v=>v.evidence)};
  }
  const isUUID = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(v);
  const projectId = v => typeof v === 'string' && /^g-p-[a-z0-9]{32}$/i.test(v);
  function sourceReference(f, project) {
    if(!projectId(project?.id) || !f || typeof f !== 'object')return null;
    const fid=goodFile(f.file_id)?f.file_id:null;
    const libraryId=goodNode(f.library_file_id)?f.library_file_id:null;
    const sourceRecordId=goodNode(f.id)?f.id:null;
    if(!fid && !libraryId && !sourceRecordId)return null;
    const metadata=f.metadata||{};
    const save=metadata.project_save||{};
    return {
      type:'project_source', project_id:project.id, project_name:clean(project.name,250)||'Untitled Project',
      file_id:fid, library_file_id:libraryId,
      source_record_id:sourceRecordId,
      source_kind:clean(metadata.knowledge_store_info?.source_kind,100),
      storage_location:clean(f.location,70),
      name:clean(f.name,300),mime_type:clean(f.mime_type||f.type,120),
      file_size_bytes:num(f.size_bytes??f.size),created_at:dateValue(f.created_at),
      conversation_id:isUUID(save.conversation_id)?save.conversation_id:null,
      message_id:clean(save.message_id,120),
      ui_url:null, url_status:'not_observed'
    };
  }
  function buildPlacements(entry, projectRefs=[]) {
    const placements=[];
    const dedupe=new Set();
    const push=(p,key)=>{if(!dedupe.has(key)){dedupe.add(key);placements.push(p);}};
    for(const l of entry.library_locations||[]) {
      push({type:'library',library_file_id:l.library_id||null,
        directory_id:l.parent_directory_id||null,folder_path:l.folder_path||null,
        ui_url:null,url_status:'not_observed'},'library:'+l.library_id+':'+l.parent_directory_id);
      if(isUUID(l.origination_thread_id))push({type:'conversation_message',
        conversation_id:l.origination_thread_id,message_id:isUUID(l.origination_message_id)?l.origination_message_id:null,
        message_role:'unknown',conversation_kind:'unknown',
        evidence:'library_origination',ui_url:null,url_status:'not_observed'},
        'conversation:'+l.origination_thread_id+':'+l.origination_message_id);
    }
    if(entry.gallery_ids?.length)for(const galleryId of entry.gallery_ids){
      push({type:'generated_image_gallery',gallery_id:galleryId,
        conversation_id:isUUID(entry.gallery?.conversation_id)?entry.gallery.conversation_id:null,
        ui_url:null,url_status:'not_observed'},'gallery:'+galleryId);
    }
    for(const p of projectRefs) {
      push(p,'project:'+p.project_id+':'+(p.source_record_id||p.file_id||p.library_file_id));
      if(isUUID(p.conversation_id))push({type:'conversation_message',
        conversation_id:p.conversation_id,message_id:p.message_id||null,
        message_role:'unknown',conversation_kind:'unknown',
        evidence:'project_save',project_id:p.project_id,ui_url:null,url_status:'not_observed'},
        'conversation:'+p.conversation_id+':'+(p.message_id||'')+':'+p.project_id);
    }
    return placements;
  }
  function sourceOnlyRecord(refs){
    const first=refs[0],fid=first.file_id;
    const id=fid?'file:'+fid:'project_source:'+first.project_id+':'+(first.source_record_id||first.library_file_id);
    const name=refs.find(x=>x.name)?.name||id;
    const mime=refs.find(x=>x.mime_type)?.mime_type||null;
    const type=formatClass(mime,name);
    const record={id,file_id:fid||null,name,mime_type:mime,format_class:type,media_class:type==='image'?'image':'file',
      file_size_bytes:refs.find(x=>x.file_size_bytes!=null)?.file_size_bytes??null,
      created_at:refs.find(x=>x.created_at)?.created_at||null,updated_at:null,file_upload_time:null,
      source_only:true,origin:'unknown',origin_status:'insufficient_evidence',origin_evidence:[],
      sources:['project_source'],gallery_ids:[],library_locations:[],gallery:null,use_case:null};
    record.placements=buildPlacements(record,refs);
    record.contexts=[...new Set(record.placements.map(p=>p.type))];
    return record;
  }
  function linkCatalog(catalog, projectRefs=[]) {
    // Reconstruct Source-only references on each pass, rather than retaining an
    // obsolete duplicate when a later Library scan exposes the same file_id.
    catalog.items=(catalog.items||[]).filter(x=>!x.source_only);
    const byFile=new Map(),byLibrary=new Map(),unmatched=[];
    for(const item of catalog.items){
      if(item.file_id)byFile.set(item.file_id,item);
      for(const l of item.library_locations||[])if(l.library_id)byLibrary.set(l.library_id,item);
    }
    const links=new Map();
    for(const p of projectRefs){
      const e=(p.file_id&&byFile.get(p.file_id)) || (p.library_file_id&&byLibrary.get(p.library_file_id));
      if(!e){unmatched.push(p);continue;}
      if(!links.has(e.id))links.set(e.id,[]);
      links.get(e.id).push(p);
    }
    for(const item of catalog.items){
      item.placements=buildPlacements(item,links.get(item.id)||[]);
      item.contexts=[...new Set(item.placements.map(p=>p.type))];
    }
    const sourceOnly=new Map();
    for(const p of unmatched){
      const key=p.file_id?'file:'+p.file_id:'project_source:'+p.project_id+':'+(p.source_record_id||p.library_file_id);
      if(!sourceOnly.has(key))sourceOnly.set(key,[]);
      sourceOnly.get(key).push(p);
    }
    for(const refs of sourceOnly.values())catalog.items.push(sourceOnlyRecord(refs));
    const byContext={library:0,project_source:0,conversation_message:0,generated_image_gallery:0};
    for(const item of catalog.items){
      for(const t of item.contexts)if(Object.prototype.hasOwnProperty.call(byContext,t))byContext[t]++;
    }
    catalog.summary.by_context=byContext;
    catalog.summary.source_only=sourceOnly.size;
    const messageReferences=[],seenMessages=new Set();
    for(const item of catalog.items)for(const placement of item.placements){
      if(placement.type!=='conversation_message')continue;
      const key=item.id+'|'+placement.conversation_id+'|'+(placement.message_id||'')+'|'+placement.evidence;
      if(seenMessages.has(key))continue;seenMessages.add(key);
      messageReferences.push({file_record_id:item.id,file_id:item.file_id||null,
        conversation_id:placement.conversation_id,message_id:placement.message_id||null,
        message_role:'unknown',conversation_kind:'unknown',evidence:placement.evidence,
        ui_url:null,url_status:'not_observed'});
    }
    catalog.message_references=messageReferences;
    catalog.summary.message_references=messageReferences.length;
    catalog.project_source_refs={matched:projectRefs.length-unmatched.length,unmatched,
      source_only_records:sourceOnly.size};
    return catalog;
  }
  function buildCatalog(nodes, images, details = new Map()) {
    const byId = new Map();
    const folders = [];
    const knownFolders = new Map();
    for (const n of nodes) {
      if (n.kind === 'directory' || n.kind === 'folder') {
        folders.push(n);
        if (n.library_id) knownFolders.set(n.library_id,n);
      }
    }
    function folderPath(parentId) {
      const seen = new Set(), names = [];
      let cursor = parentId;
      while (cursor && knownFolders.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor);
        const folder = knownFolders.get(cursor);
        names.unshift(folder.name);
        cursor = folder.parent_directory_id;
      }
      return names.join(' / ') || null;
    }
    for (const n of nodes) {
      if (n.kind !== 'file') continue;
      const id = n.file_id ? 'file:'+n.file_id : n.library_id ? 'library:'+n.library_id : null;
      if (!id) continue;
      let e = byId.get(id);
      if (!e) {
        e = {id, file_id:n.file_id, name:n.name, mime_type:n.mime_type, file_size_bytes:n.file_size_bytes,
          created_at:n.created_at, updated_at:n.updated_at, file_upload_time:n.file_upload_time, sources:['library'], gallery_ids:[], library_locations:[],
          gallery:null, library_file_category:n.library_file_category, library_artifact_type:n.library_artifact_type,
          image_gen_attribution:n.image_gen_attribution, detail:null};
        byId.set(id,e);
      }
      if (!e.library_locations.some(x=>x.library_id===n.library_id && x.parent_directory_id===n.parent_directory_id)) {
        e.library_locations.push({library_id:n.library_id,parent_directory_id:n.parent_directory_id,
          folder_path:folderPath(n.parent_directory_id),access_kind:n.access_kind,
          origination_thread_id:n.origination_thread_id,origination_message_id:n.origination_message_id});
      }
      e.image_gen_attribution ||= n.image_gen_attribution;
    }
    for (const img of images) {
      const id = img.file_id ? 'file:'+img.file_id : img.gallery_id ? 'gallery:'+img.gallery_id : null;
      if (!id) continue;
      let e = byId.get(id);
      if (!e) {
        e = {id,file_id:img.file_id,name:img.title || img.gallery_id || '(unnamed image)',mime_type:null,
          file_size_bytes:null,created_at:img.created_at,updated_at:null,file_upload_time:null,sources:[],gallery_ids:[],library_locations:[],
          gallery:null,library_file_category:null,library_artifact_type:null,image_gen_attribution:false,detail:null};
        byId.set(id,e);
      }
      if (!e.sources.includes('images')) e.sources.push('images');
      if (img.gallery_id && !e.gallery_ids.includes(img.gallery_id)) e.gallery_ids.push(img.gallery_id);
      if (!e.gallery) e.gallery={title:img.title,width:img.width,height:img.height,
        created_at:img.created_at,conversation_id:img.conversation_id};
    }
    const entries = [...byId.values()];
    for (const e of entries) {
      e.detail = e.file_id ? (details.get(e.file_id)||null) : null;
      if (!e.mime_type) e.mime_type = e.detail?.mime_type || (e.sources.includes('images')?'image/unknown':null);
      if (!e.file_size_bytes) e.file_size_bytes = e.detail?.file_size_bytes ?? null;
      if (!e.created_at) e.created_at = e.detail?.created_at ?? null;
      const type = formatClass(e.mime_type,e.name,e.sources.includes('images'));
      e.media_class = type === 'image' ? 'image' : 'file';
      e.format_class = type;
      Object.assign(e,originFor(e));
      e.use_case = e.detail?.use_case || null;
      delete e.detail;
    }
    entries.sort((a,b)=>{
      const originOrder={uploaded:0,generated:1,unknown:2};
      const x=originOrder[a.origin]-originOrder[b.origin];
      return x || a.media_class.localeCompare(b.media_class) || a.name.localeCompare(b.name);
    });
    const summary = {total:entries.length, library_files:entries.filter(x=>x.sources.includes('library')).length,
      images_gallery:images.length, images_unique:entries.filter(x=>x.sources.includes('images')).length,
      image_only:entries.filter(x=>x.sources.includes('images')&&!x.sources.includes('library')).length,
      folders:folders.length, by_origin:{uploaded:0,generated:0,unknown:0},by_media:{image:0,file:0},groups:{}};
    for (const e of entries) {
      summary.by_origin[e.origin]++;
      summary.by_media[e.media_class]++;
      const key=e.origin+'/'+e.media_class;
      summary.groups[key]=(summary.groups[key]||0)+1;
    }
    return {items:entries,folders,summary};
  }
  root.ChatArchiveLibraryInventory = {goodFile,goodNode,fileFromGallery,fromNode,fromImage,fromDetail,sourceReference,buildPlacements,sourceOnlyRecord,linkCatalog,originFor,formatClass,buildCatalog};
})(typeof window !== 'undefined' ? window : globalThis);
