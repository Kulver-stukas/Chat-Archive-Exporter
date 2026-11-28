/* Metadata rendering, with observed source download outcomes. No network calls. */
(function (root) {
  'use strict';
  const safe = value => ChatArchiveNormalize.safeFilename(String(value || 'Unknown'), 75);
  const q = value => JSON.stringify(value ?? null);
  const isDefined = v => v !== undefined && v !== null && v !== '';
  function fenced(value, language = '') {
    const content = String(value ?? '');
    const runs = content.match(/`+/g) || [];
    const maxRun = Math.max(2, ...runs.map(x => x.length));
    const fence = '`'.repeat(maxRun + 1);
    return `${fence}${language}\n${content}\n${fence}`;
  }
  function sourceFile(f) {
    const save = f?.metadata?.project_save || null;
    const kind = f?.metadata?.knowledge_store_info?.source_kind || null;
    return {
      category: save ? 'saved_response' : (kind || 'unknown'),
      id: f.id || null,
      file_id: f.file_id || null,
      name: f.name || null,
      mime_type: f.type || null,
      size_bytes: Number.isFinite(f.size) ? f.size : null,
      attached_at: f.created_at || null,
      source_last_modified_ms: Number.isFinite(f.last_modified) ? f.last_modified : null,
      location: f.location || null,
      library_file_id: f.library_file_id || null,
      project_save: save ? {
        save_id: save.save_id || null,
        project_id: save.project_id || null,
        conversation_id: save.conversation_id || null,
        conversation_title: save.conversation_title || null,
        message_id: save.message_id || null
      } : null,
      download_status: 'not_attempted'
    };
  }
  function sourceConnector(scope) {
    return {
      category: 'connector', scope_id: scope.scope_id || null,
      provider: scope.connector_type || null,
      scope_type: scope.scope_type || null,
      name: scope.display_name || null,
      canonical_handle: scope.canonical_handle || null,
      original_url: scope.original_url || null,
      attached_at: scope.created_at || null,
      last_synced_at: scope.last_synced_at || null,
      last_sync_status: scope.last_sync_status || null,
      last_sync_started_at: scope.last_sync_started_at || null,
      last_sync_completed_at: scope.last_sync_completed_at || null,
      is_connector_syncable: scope.is_connector_syncable ?? null,
      connector_files: (scope.connector_files || []).map(f => ({
        file_id: f.info?.id || null,
        name: f.info?.name || null,
        mime_type: f.info?.type || null,
        size_bytes: Number.isFinite(f.info?.size) ? f.info.size : null,
        source_last_modified_ms: Number.isFinite(f.info?.last_modified) ? f.info.last_modified : null,
        location: f.location || null,
        remote_id: f.remote_id || null,
        remote_modified_time: f.remote_modified_time || null,
        original_url: f.original_url || null
      })),
      download_status: 'not_attempted'
    };
  }
  function normalizeProject(raw) {
    const p = raw?.gizmo || raw || {};
    const files = raw?.files || [];
    return {
      id: p.id || null,
      workspace_id: p.workspace_id || null,
      name: p.display?.name || p.name || 'Unnamed project',
      description: p.display?.description || '',
      instructions: p.instructions || '',
      theme: p.display?.theme || null,
      emoji: p.display?.emoji || null,
      created_at: p.created_at || null,
      updated_at: p.updated_at || null,
      is_archived: Boolean(p.is_archived),
      connector_scopes_complete: raw?.connector_scopes_complete !== false,
      files: files.map(sourceFile),
      connectors: (raw?.connectors || []).map(sourceConnector)
    };
  }
  function renderProject(p, capturedAt) {
    const lines = [
      `# Project: ${p.name}`,
      '',
      '| Property | Value |', '|---|---|',
      `| Project ID | \`${p.id || ''}\` |`,
      `| Workspace ID | \`${p.workspace_id || ''}\` |`,
      `| Created | ${p.created_at || 'unknown'} |`,
      `| Updated | ${p.updated_at || 'unknown'} |`,
      `| Archived | ${p.is_archived ? 'yes' : 'no'} |`,
      `| Snapshot captured | ${capturedAt} |`,
      '',
      '## Description', '', p.description || '(empty)', '',
      '## Instructions', '', p.instructions || '(empty)', '',
      '## Display settings', '',
      fenced(JSON.stringify({ emoji: p.emoji, theme: p.theme }, null, 2), 'json'), '',
      'The snapshot records the project configuration at export time, not the historical instructions for individual chats.',
      'Project and account Memory content is intentionally excluded.', ''
    ];
    return lines.join('\n');
  }
  function compactText(value) {
    return String(value == null || value === '' ? 'unknown' : value)
      .replace(/[|\r\n]+/g, ' ').replace(/\\/g, '\\\\');
  }
  function isoMillis(value) {
    if (!Number.isFinite(value)) return 'unknown';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : 'unknown';
  }
  function renderSources(p, capturedAt) {
    const record = {
      schema: 'cae.project-sources.v1',
      project_id: p.id,
      captured_at: capturedAt,
      connector_scopes_complete: p.connector_scopes_complete,
      files: p.files,
      connector_scopes: p.connectors
    };
    const rows = [
      '| Source | Category | Record created | Last modified / synced | Download | Local path |',
      '|---|---|---|---|---|---|'
    ];
    for (const f of p.files) {
      rows.push(`| ${compactText(f.name)} | ${compactText(f.category)} | ${compactText(f.attached_at)} | ${isoMillis(f.source_last_modified_ms)} | ${compactText(f.download_status)} | ${compactText(f.local_path)} |`);
    }
    for (const c of p.connectors) {
      rows.push(`| ${compactText(c.name)} | ${compactText(c.provider)} / ${compactText(c.scope_type)} | ${compactText(c.attached_at)} | ${compactText(c.last_synced_at)} | ${compactText(c.download_status)} | ${compactText(c.connector_files?.map(f => f.local_path).filter(Boolean).join('; '))} |`);
    }
    return [
      `# Project Sources: ${p.name}`, '',
      `Snapshot captured: ${capturedAt}`, '',
      `File entries: ${p.files.length}; connector scopes: ${p.connectors.length}.`, '',
      'Source download outcomes are recorded per file below. Entries marked `saved`, `skipped`, `changed`, or `conflict` may have an existing local copy; inspect `local_path` and the reason.',
      'Content is stored byte-for-byte as received; no text conversion, MIME sniffing, or archive extraction is performed.',
      ...(p.connector_scopes_complete ? [] : ['**Warning:** The connector scopes inventory may be incomplete.', '']),
      'A missing field means that the server did not supply a value. `attached_at` preserves the API record created_at; its exact semantics can differ by source type. Source modification and synchronization times are separate.',
      'Signed download URLs and Memory contents are never persisted.', '',
      '## Source overview', '',
      ...rows, '',
      '## Machine-readable inventory', '',
      fenced(JSON.stringify(record, null, 2), 'json'), ''
    ].join('\n');
  }
  function renderPersonalization(raw, capturedAt) {
    const keys = ['about_user_message', 'about_model_message', 'name_user_message',
      'role_user_message', 'traits_model_message', 'other_user_message',
      'personality_type_selection', 'personality_traits', 'enabled', 'traits_enabled', 'disabled_tools'];
    const personal = Object.fromEntries(keys.filter(k => Object.prototype.hasOwnProperty.call(raw || {}, k)).map(k => [k, raw[k]]));
    const fields = [
      ['about_model_message', 'Instructions for ChatGPT'],
      ['about_user_message', 'About the user'],
      ['other_user_message', 'Other custom instructions'],
      ['traits_model_message', 'Model traits instructions']
    ];
    const lines = [
      '# ChatGPT user personalization', '', `Snapshot captured: ${capturedAt}`, '',
      'Only user personalization fields available from the active ChatGPT account are included. Memory is excluded.', ''
    ];
    for (const [key, title] of fields) {
      if (isDefined(personal[key])) lines.push(`## ${title}`, '', fenced(personal[key], 'text'), '');
    }
    lines.push('## Available settings (JSON)', '', fenced(JSON.stringify(personal, null, 2), 'json'), '');
    return lines.join('\n');
  }
  function applyDownloads(project, report) {
    const map = new Map((report?.results || []).filter(r => r.project_id === project.id && r.file_id).map(r => [r.file_id, r]));
    const apply = file => {
      const r = map.get(file.file_id) || (!file.file_id && report?.results?.find(x => x.project_id === project.id && !x.file_id && x.name === file.name));
      if (!r) return file;
      return { ...file, download_status: r.status, local_path: r.local_path,
        downloaded_bytes: r.downloaded_bytes, expected_bytes: r.expected_bytes,
        size_matches: r.size_matches, sha256: r.sha256,
        response_content_type: r.content_type || null,
        download_note: r.reason || r.warning || null };
    };
    project.files = project.files.map(apply);
    project.connectors = project.connectors.map(c => {
      const files = c.connector_files.map(apply);
      const statuses = [...new Set(files.map(f => f.download_status || 'not_attempted'))];
      return { ...c, connector_files: files, download_status: statuses.length === 1 ? statuses[0] : statuses.length ? 'mixed' : 'no_synchronized_files' };
    });
    return project;
  }
  function renderWorkspaceConfiguration(context, capturedAt) {
    const activeId=String(context.active_scope?.account_id||'');
    const projects=(context.projects||[]).map(raw=>{
      const p=raw?.gizmo||raw||{};
      return {id:String(p.id||''),name:String(p.display?.name||p.name||''),
        created_at:p.created_at||null,updated_at:p.updated_at||null};
    }).filter(x=>/^g-p-[a-f0-9]{32}$/i.test(x.id));
    const observed=[...new Map((context.gpts||[]).filter(x=>/^g-(?!p-)[a-z0-9_-]{6,128}$/i.test(x?.id||''))
      .map(x=>[x.id,{id:x.id,name:String(x.name||''),source:'observed_conversation'}])).values()];
    const gptInventory=context.custom_gpts;
    const gpts=gptInventory?.items?[...new Map([...observed,...gptInventory.items].map(x=>[x.id,x])).values()]:observed;
    const scopes=[];
    for(const raw of context.projects||[]) {
      const pid=(raw?.gizmo||raw)?.id||'';
      for(const x of raw?.connectors||[])if(x.connector_type||x.scope_id)scopes.push({
        project_id:pid,connector_type:x.connector_type||null,display_name:x.display_name||null,
        scope_type:x.scope_type||null,scope_id:x.scope_id||null,last_sync_status:x.last_sync_status||null
      });
    }
    const partialSelection=context.selection==='selected_projects';
    const pluginData=context.installed_plugins||null,skillData=context.bundled_skills||null;
    const schedules=context.schedules||null;
    const identity=context.identity||null;
    const snapshot={schema:'cae.workspace-configuration.v1',captured_at:capturedAt,
      active_scope:{account_id:activeId,scope_type:identity?.scope_type||'unknown'},
      identity:identity?{status:identity.complete?'complete':'partial',account_id:identity.account_id,
        user_name:identity.user_name||null,workspace_name:identity.workspace_name||null,
        display_name:identity.display_name||null,scope_type:identity.scope_type}:null,
      selection:context.selection||'unknown',
      projects:{status:partialSelection?'selected_projects_only':
        (context.projects_complete===true?'complete':'partial'),complete:context.projects_complete===true&&!partialSelection,items:projects},
      custom_gpts:{status:gptInventory?.status||'observed_only',complete:gptInventory?.complete===true,
        coverage:gptInventory?.coverage||'observed_conversations',items:gpts},
      plugins:pluginData?{status:pluginData.status,complete:pluginData.complete,
        scopes:pluginData.scopes||[],items:pluginData.items}: {status:'not_enumerated',complete:false,items:null},
      skills:skillData?{status:skillData.status,complete:skillData.complete,
        kind:'bundled_in_explicitly_installed_plugins',items:skillData.items}:
        {status:'not_enumerated',complete:false,kind:'bundled_in_explicitly_installed_plugins',items:null},
      standalone_skills:{status:'not_enumerated',complete:false,items:null},
      schedules:schedules?{status:schedules.status,complete:schedules.complete,
        buckets:schedules.buckets||[],items:schedules.items}:
        {status:'not_enumerated',complete:false,items:null},
      connected_app_scopes:{status:'project_connector_scopes_only',complete:context.projects_complete===true&&!partialSelection,items:scopes},
      notes:['The snapshot covers only the verified active ChatGPT workspace. No other account is queried.',
        'Installed Plugins are explicit user installations only. Bundled Skills are references, not exported skill contents.',
        'GLOBAL entries belong to the current user; WORKSPACE entries belong to the active workspace. Neither proves OAuth authorization.',
        'GPT bootstrap is not a complete owned-GPT catalog. Standalone installed Skills were not enumerated.',
        'Project connector scopes describe project Sources; remote provider destinations were not enumerated.',
        'Schedules are configuration snapshots, not execution histories; suggested tasks are excluded.', 
        'No account or Project Memory, token, signed source URL, full Plugin manifest or external provider data is archived.']};
    return JSON.stringify(snapshot,null,2)+'\n';
  }
  // A failed/incomplete refresh must never silently erase a previously complete
  // section. This merger runs ONLY against the same workspace's disk snapshot.
  function mergeWorkspaceConfiguration(existing,incoming,expectedAccountId){
    const next=typeof incoming==='string'?JSON.parse(incoming):incoming;
    const old=typeof existing==='string'?JSON.parse(existing):existing;
    if(!next||next.schema!=='cae.workspace-configuration.v1'||
       next.active_scope?.account_id!==expectedAccountId)throw Error('Invalid current-scope configuration snapshot.');
    if(!old)return JSON.stringify(next,null,2)+'\n';
    if(old.schema!=='cae.workspace-configuration.v1')throw Error('Unknown existing configuration schema.');
    if(old.active_scope?.account_id&&old.active_scope.account_id!==expectedAccountId)
      throw Error('Existing configuration belongs to another workspace.');
    const safeKeys=['projects','custom_gpts','plugins','skills','schedules','connected_app_scopes'];
    for(const k of safeKeys){
      const oldSection=old[k],fresh=next[k];
      if(oldSection?.complete===true && fresh?.complete!==true){
        next[k]={...oldSection,retained_from_previous_complete_snapshot:true};
      }
    }
    // Preserve informative but partial inventories when a later refresh is
    // unavailable (e.g. the periodic project scan has no GPT bootstrap data).
    for(const k of ['plugins','skills','custom_gpts','schedules']){
      const previous=old[k],fresh=next[k];
      if(Array.isArray(previous?.items)&&previous.items.length &&
         !Array.isArray(fresh?.items))next[k]={...previous,retained_from_previous_snapshot:true};
    }
    if(Array.isArray(old.custom_gpts?.items)&&Array.isArray(next.custom_gpts?.items)&&
       next.custom_gpts.complete!==true){
      const union=new Map(old.custom_gpts.items.map(x=>[x.id,x]));
      for(const row of next.custom_gpts.items){
        const former=union.get(row.id);
        union.set(row.id,former?.name&&!row.name?{...row,name:former.name,description:row.description||former.description}:row);
      }
      next.custom_gpts.items=[...union.values()];
    }
    if(!next.identity&&old.identity?.account_id===expectedAccountId)next.identity=old.identity;
    return JSON.stringify(next,null,2)+'\n';
  }
  // Observed time is not a configuration change. Do not rewrite merely to
  // advance captured_at when every actual setting remains identical.
  function sameConfiguration(previous,incoming){
    if(!previous)return false;
    try{
      const a=typeof previous==='string'?JSON.parse(previous):structuredClone(previous);
      const b=typeof incoming==='string'?JSON.parse(incoming):structuredClone(incoming);
      if(a.active_scope?.account_id!==b.active_scope?.account_id)return false;
      delete a.captured_at;delete b.captured_at;
      return JSON.stringify(a)===JSON.stringify(b);
    }catch{return false;}
  }
  function renderReport(context) {
    const warnings = [...new Set(context.warnings || [])];
    if (!context.projects_complete) warnings.unshift('Requested project enumeration may be incomplete.');
    const sources = context.source_downloads;
    const lines = [
      '# Archive report', '',
      `Exporter version: ${context.exporter_version || '0.1.6.9'}`, '',
      `Captured: ${context.captured_at || 'unknown'}`, '',
      `Selection: ${context.selection || 'all_projects'}`, '',
      `Projects included: ${(context.projects || []).length}`, '',
      `Requested project metadata complete: ${context.projects_complete ? 'yes' : 'no'}`, '',
      `Personalization: ${context.personalization ? 'included' : context.personalization_requested === false ? 'not requested for a partial selection' : 'unavailable'}`, '',
      ...(context.chat_counts ? ['## Chat export', '', fenced(JSON.stringify(context.chat_counts, null, 2), 'json'), ''] : []),
      '## Project Sources', '',
      ...(sources ? [fenced(JSON.stringify({ counts: sources.counts, received_bytes: sources.received_bytes,
        stored_bytes: sources.stored_bytes, limits: sources.limits }, null, 2), 'json'), '',
        'SHA-256 records the downloaded bytes. It is not proof of equality to an unavailable remote original.',
        'Connector sources are snapshots of the representation supplied by ChatGPT, not a fresh Google Drive export.', '',
        '### Per-source results', '', fenced(JSON.stringify(sources.results, null, 2), 'json'), ''] : [
        'Source contents were not requested for this export.', '']),
      '## Warnings', '', ...(warnings.length ? warnings.map(w => `- ${w}`) : ['- None reported']), ''
    ];
    return lines.join('\n');
  }
  function entries(context, workspaceName, options = {}) {
    const layout = options.layout || (typeof ChatArchivePaths !== 'undefined'
      ? ChatArchivePaths.createLayout(workspaceName, (context.projects || []).map(raw => ({id: raw.gizmo?.id, name: raw.gizmo?.display?.name}))) : null);
    const prefix = layout?.prefix || `ChatGPT/${safe(workspaceName)}`;
    const time = context.captured_at || new Date().toISOString();
    const out = [];
    const names = new Map();
    for (const raw of context.projects || []) {
      const p = applyDownloads(normalizeProject(raw), context.source_downloads);
      if (!p.id) continue;
      let folder = safe(p.name);
      const usedBy = names.get(folder);
      if (usedBy && usedBy !== p.id) folder = `${folder} [${safe(p.id.slice(-12))}]`;
      names.set(folder, p.id);
      const base = layout ? layout.projectPath(p.id, p.name) : `${prefix}/${folder}`;
      out.push({ path: `${base}/_project.md`, content: renderProject(p, time) });
      out.push({ path: `${base}/_sources.md`, content: renderSources(p, time) });
    }
    out.push({ path: `${prefix}/_workspace_configuration.json`, content: renderWorkspaceConfiguration(context,time) });
    out.push({ path: `${prefix}/_archive_report.md`, content: renderReport(context) });
    if (context.personalization) out.push({ path: `${prefix}/_personalization.md`, content: renderPersonalization(context.personalization, time) });
    return out;
  }

  const api = { normalizeProject, sourceFile, sourceConnector, renderProject, renderSources,
    renderPersonalization, renderWorkspaceConfiguration, mergeWorkspaceConfiguration, sameConfiguration, renderReport, entries, fenced, applyDownloads };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveMeta = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
