/* Only runs on chatgpt.com as a content script. Auth material never leaves this context. */
(() => {
  'use strict';
  // Safe mode: do not inject into MAIN world or instrument ChatGPT fetch.
  // The session API is the sole account-ID source; warn when it is unavailable.
  let sessionCache = null;
  let sessionAt = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function getSession(force = false) {
    if (!force && sessionCache && Date.now() - sessionAt < 4 * 60_000) return sessionCache;
    const r = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const e = new Error(`Session lookup failed (HTTP ${r.status}).`); e.httpStatus = r.status; if ([401, 403].includes(r.status)) e.code = 'AUTH_REQUIRED'; throw e; }
    const j = await r.json();
    if (!j?.accessToken) { const e = new Error('No access token in ChatGPT session. Sign in and reload the page.'); e.httpStatus = 401; e.code = 'AUTH_REQUIRED'; throw e; }
    sessionAt = Date.now();
    sessionCache = j;
    return j;
  }
  function accountInfo(session) {
    const account = session.account || {};
    const accountId = account.id || session.accountId || '';
    let display = account.name || account.display_name || '';
    if (!display && accountId) display = `Workspace ${accountId.slice(0, 8)}`;
    return { accountId, display: display || 'Current workspace', observed: Boolean(account.id) };
  }
  async function status(force = false) {
    const s = await getSession(force);
    return { ...accountInfo(s), user: s?.user?.email || '', origin: location.origin,
      currentId: (location.pathname.match(/\/c\/([0-9a-f-]{36})/i) || [])[1] || '' };
  }
  const projectID=id=>/^g-p-[a-f0-9]{32}$/i.test(canonicalProjectId(id));
  const gptID=id=>/^g-(?!p-)[a-z0-9_-]{6,128}$/i.test(String(id||''));
  function observedGpt(x) {
    const id=String(x?.gizmo_id||x?.gizmo?.id||x?.gpt_id||'');
    const name=x?.gizmo?.display?.name||x?.gizmo_name||x?.gpt_name||'';
    return {gptId:gptID(id)?id:'',gptName:typeof name==='string'?name.slice(0,250):''};
  }
  let cooldownUntil = 0;
  let lastBackendRequestAt = 0;
  async function getJSON(path, retry = 0, options = {}) {
    if (cooldownUntil > Date.now()) {
      const e = new Error('API cooldown in progress.'); e.code='API_COOLDOWN'; e.httpStatus=429;
      e.retryAfterMs=cooldownUntil-Date.now(); throw e;
    }
    if (options.signal?.aborted) throw new Error('Request cancelled.');
    const session = await getSession(Boolean(retry) || Boolean(options.expectedAccountId) || options.verifyFreshScope===true);
    const info = accountInfo(session);
    if (options.expectedAccountId && options.expectedAccountId !== info.accountId) {
      const e = new Error('Workspace changed; background request stopped.'); e.code='WORKSPACE_CHANGED'; throw e;
    }
    const headers = { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' };
    if (info.accountId) headers['ChatGPT-Account-Id'] = info.accountId;
    const did = document.cookie.match(/(?:^|;\s*)oai-did=([^;]*)/);
    if (did) headers['oai-device-id'] = decodeURIComponent(did[1]);
    let r;
    if (options.background && Date.now()-lastBackendRequestAt < 2000)
      await sleep(2000 - (Date.now()-lastBackendRequestAt));
    lastBackendRequestAt = Date.now();
    try { r = await fetch(path, { credentials: 'include', headers, signal: options.signal || AbortSignal.timeout(45000), redirect: 'error' }); }
    catch (e) { throw new Error(`Network error: ${e.message || e}`); }
    if (r.status === 401 && retry === 0) {
      sessionCache = null;
      return getJSON(path, 1, options);
    }
    if ([429, 502, 503, 504].includes(r.status) && retry < 3) {
      const retryAfter = r.headers.get('retry-after');
      const numeric = retryAfter != null && retryAfter.trim() !== '' ? Number(retryAfter) : NaN;
      const explicitDelay = Number.isFinite(numeric) ? Math.max(0, numeric * 1000) : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : NaN;
      const delay = Number.isFinite(explicitDelay) ? explicitDelay : 1000 * (2 ** retry);
      if (delay > 30000 || options.background) {
        const error = new Error(`API requested a ${Math.ceil(delay / 1000)}s cooldown. Retry this export later.`);
        error.httpStatus = r.status; error.code = 'API_COOLDOWN';
        error.retryAfterMs = r.status === 429 ? Math.max(delay, 60000) : Math.max(delay, 5000);
        cooldownUntil = Date.now() + error.retryAfterMs; throw error;
      }
      await sleep(delay);
      if (options.signal?.aborted) throw new Error('Request cancelled.');
      return getJSON(path, retry + 1, options);
    }
    if (!r.ok) {
      const e = new Error(`ChatGPT API HTTP ${r.status} at ${new URL(path, location.origin).pathname}`);
      e.httpStatus = r.status;
      throw e;
    }
    const type = r.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error(`Unexpected response from ${path} (not JSON).`);
    return await r.json();
  }
  function records(j, endpoint) {
    if (!j || !Array.isArray(j.items)) throw new Error(`List endpoint returned unexpected format: ${endpoint}`);
    return j.items;
  }
  async function listAll(progress = () => {}) {
    const startingScope = await status(true);
    if(!startingScope.observed||!startingScope.accountId)throw Error('A verified active workspace is required.');
    const scopedJSON=path=>getJSON(path,0,{expectedAccountId:startingScope.accountId,verifyFreshScope:true});
    const warnings = [];
    const chats = new Map();
    const projects = new Map();
    const emit = detail => progress({ detail, count: chats.size, projects: projects.size });
    let projectPath = '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=false';
    let ownedOnlyFallback = false;
    let cursor = '';
    const visited = new Set();
    try {
      for (let page = 0; page < 300; page++) {
        const path = projectPath + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
        let j;
        try { j = await scopedJSON(path); }
        catch (e) {
          if (!page && (e.httpStatus === 400 || e.httpStatus === 403 || e.httpStatus === 404)) {
            projectPath = '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=true';
            ownedOnlyFallback = true;
            j = await scopedJSON(projectPath);
          } else throw e;
        }
        for (const item of records(j, path)) {
          const p = item?.gizmo?.gizmo || item?.gizmo || item;
          if (!p?.id || !projectID(p.id)) continue;
          if (p.workspace_id && p.workspace_id !== startingScope.accountId)throw Error('Project list belongs to another workspace.');
          projects.set(canonicalProjectId(p.id), { id: canonicalProjectId(p.id), name: p.display?.name || p.name || 'Unnamed project' });
        }
        emit(`Found ${projects.size} projects`);
        if (!j.cursor) { cursor = ''; break; }
        if (visited.has(j.cursor)) throw new Error('Project pagination cursor repeated.');
        visited.add(j.cursor);
        cursor = j.cursor;
      }
      if (cursor) warnings.push('Project list hit the pagination safety limit.');
      if (ownedOnlyFallback) warnings.push('Project API required owned_only=true; shared projects may be missing.');
    } catch (error) { warnings.push('Could not enumerate projects: ' + error.message); }

    for (const p of projects.values()) {
      let projectCursor = '0';
      const cursors = new Set();
      try {
        for (let page = 0; page < 1000; page++) {
          const path = `/backend-api/gizmos/${encodeURIComponent(p.id)}/conversations?cursor=${encodeURIComponent(projectCursor)}`;
          const j = await scopedJSON(path);
          const items = records(j, path);
          for (const item of items) if (item?.id) {
            chats.set(item.id, { id: item.id, title: item.title || 'Untitled chat', projectId: p.id, project: p.name, gptId:'',gptName:'',
              archived: Boolean(item.is_archived),containerObserved:true,
              updated: item.update_time ?? item.updated_at ?? '', created: item.create_time ?? item.created_at ?? '' });
          }
          emit(`Loaded ${p.name} (${chats.size} chats)`);
          if (!j.cursor) { projectCursor = ''; break; }
          if (cursors.has(j.cursor)) throw new Error('Project conversation cursor repeated.');
          cursors.add(j.cursor);
          projectCursor = j.cursor;
        }
        if (projectCursor) warnings.push(`Project ${p.name}: pagination safety limit reached.`);
      } catch (error) { warnings.push(`Project ${p.name}: ${error.message}`); }
    }

    async function listMain(archived) {
      const base = `/backend-api/conversations${archived ? '?is_archived=true' : ''}`;
      const limit = 100;
      let count = 0;
      for (let offset = 0; offset < 100_000; offset += limit) {
        const path = `${base}${base.includes('?') ? '&' : '?'}offset=${offset}&limit=${limit}&order=updated`;
        const j = await scopedJSON(path);
        const items = records(j, path);
        for (const item of items) {
          if (!item?.id) continue;
          const prev = chats.get(item.id);
          if (prev) {
            if (archived || item.is_archived) prev.archived = true;
            if (!prev.title || prev.title === 'Untitled chat') prev.title = item.title || prev.title;
            // Project lists and the main list can contain different activity timestamps.
            // Preserve the most recent plausible value without disturbing project ownership.
            const nextUpdated = item.update_time ?? item.updated_at ?? null;
            const parseTime = v => {
              if (v == null || v === '') return -1;
              if (typeof v === 'number' || /^\d+(?:\.\d+)?$/.test(String(v))) {
                const n = Number(v); return Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : -1;
              }
              const n = Date.parse(v); return Number.isFinite(n) ? n : -1;
            };
            if (parseTime(nextUpdated) > parseTime(prev.updated)) prev.updated = nextUpdated;
            if (!prev.created && (item.create_time || item.created_at)) prev.created = item.create_time || item.created_at;
            const pid=canonicalProjectId(item.gizmo_id||'');
            if (!prev.projectId&&projectID(pid))prev.projectId=pid;
            if (!prev.projectId) { const g=observedGpt(item);if(g.gptId){prev.gptId=g.gptId;prev.gptName=prev.gptName||g.gptName;} }
            if(Object.prototype.hasOwnProperty.call(item,'gizmo_id'))prev.containerObserved=true;
          } else {
            const observed=observedGpt(item), pid=projectID(item.gizmo_id)?canonicalProjectId(item.gizmo_id):'';
            chats.set(item.id, { id: item.id, title: item.title || 'Untitled chat', project: '', projectId: pid,...observed,
              containerObserved:Object.prototype.hasOwnProperty.call(item,'gizmo_id'),
              archived: archived || Boolean(item.is_archived), updated: item.update_time ?? item.updated_at ?? '', created: item.create_time ?? item.created_at ?? '' });
          }
        }
        count += items.length;
        emit(`Loaded ${archived ? 'archived' : 'main'} chats: ${count}`);
        if (items.length < limit || (Number.isFinite(j.total) && offset + limit >= j.total)) return;
      }
      warnings.push(`${archived ? 'Archived' : 'Main'} list reached the pagination safety limit.`);
    }
    try { await listMain(false); }
    catch (e) { warnings.push('Main conversation list incomplete: ' + e.message); }
    try { await listMain(true); }
    catch (e) { if (e.httpStatus !== 404 && e.httpStatus !== 405) warnings.push('Archived conversation list incomplete: ' + e.message); }
    if (!chats.size && !projects.size) throw new Error(`No chats or projects were listed. ${warnings.join(' ')}`);
    // Resolve UI labels without retrieving hidden GPT instructions, Knowledge,
    // neighboring accounts, or other configuration. Never block chat listing.
    const unknown=new Set([...chats.values()].filter(x=>x.gptId).map(x=>x.gptId));
    if(unknown.size){
      try{
        const raw=await scopedJSON('/backend-api/gizmos/bootstrap');
        const confirmed=ChatArchiveConfigInventory.gpts(raw,startingScope.accountId).items||[];
        const names=new Map(confirmed.filter(x=>x.name).map(x=>[x.id,x.name]));
        for(const id of [...unknown].filter(x=>!names.has(x)).slice(0,24)){
          try{
            const detail=await scopedJSON('/backend-api/gizmos/'+encodeURIComponent(id));
            const g=detail?.gizmo;
            if(g?.id===id&&(!g.workspace_id||g.workspace_id===startingScope.accountId)&&
              typeof g.display?.name==='string')names.set(id,g.display.name.slice(0,250));
          }catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED')throw e;}
        }
        for(const item of chats.values())if(item.gptId&&names.has(item.gptId))item.gptName=names.get(item.gptId);
      }catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED')throw e;
        warnings.push('Some GPT display names could not be resolved.');}
    }
    const endScope = await status(true);
    if (startingScope.accountId && endScope.accountId && startingScope.accountId !== endScope.accountId)
      throw new Error('Workspace changed during listing. Reload ChatGPT and try again.');
    return { scope: startingScope, items: [...chats.values()], projects: [...projects.values()], warnings };
  }
  function canonicalProjectId(value) {
    const s = String(value || '');
    return s.match(/^g-p-[a-f0-9]{32}(?=-|$)/i)?.[0] || s;
  }
  function projectSnapshot(wrapper) {
    const p = wrapper?.gizmo || wrapper;
    return {
          gizmo: {
            id: p.id, workspace_id: p.workspace_id, instructions: p.instructions || '',
            display: {name: p.display?.name || p.name || 'Unnamed project',
              description: p.display?.description || '', theme: p.display?.theme || null,
              emoji: p.display?.emoji || null},
            created_at: p.created_at || null, updated_at: p.updated_at || null,
            is_archived: Boolean(p.is_archived)
          },
          files: Array.isArray(wrapper?.files) ? wrapper.files.map(f => ({
            id: f.id || null, file_id: f.file_id || null, name: f.name || null,
            type: f.type || null, size: f.size ?? null, created_at: f.created_at || null,
            last_modified: f.last_modified ?? null, location: f.location || null,
            library_file_id: f.library_file_id || null,
            metadata: {
              knowledge_store_info: f.metadata?.knowledge_store_info
                ? {source_kind: f.metadata.knowledge_store_info.source_kind || null} : undefined,
              project_save: f.metadata?.project_save ? {
                save_id: f.metadata.project_save.save_id || null,
                project_id: f.metadata.project_save.project_id || null,
                conversation_id: f.metadata.project_save.conversation_id || null,
                conversation_title: f.metadata.project_save.conversation_title || null,
                message_id: f.metadata.project_save.message_id || null
              } : undefined
            }
          })) : [],
          connectors: [], connector_scopes_complete: true
    };
  }

  // Current-scope identity. Never call accounts/check or enumerate account switcher entries.
  async function configurationIdentity(expectedAccountId,background=false) {
    const session=await getSession(true);
    if(!accountInfo(session).observed||accountInfo(session).accountId!==expectedAccountId)
      throw Error('Current ChatGPT session does not match the archive workspace.');
    let me=null;
    try { me=await getJSON('/backend-api/me',0,{expectedAccountId,background,verifyFreshScope:true}); }
    catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED'||e.code==='API_COOLDOWN')throw e;}
    const latest=await getSession(true);
    if(accountInfo(latest).accountId!==expectedAccountId)throw Error('Workspace changed during profile inventory.');
    return ChatArchiveConfigInventory.identity(latest,me,expectedAccountId);
  }
  async function configurationGpts(expectedAccountId,known=[],background=false) {
    await assertScope(expectedAccountId);
    const raw=await getJSON('/backend-api/gizmos/bootstrap',0,{expectedAccountId,background,verifyFreshScope:true});
    const result=ChatArchiveConfigInventory.gpts(raw,expectedAccountId,known);
    await assertScope(expectedAccountId);
    return result;
  }
  async function assertScope(expectedAccountId) {
    const s=await status(true);
    if(!s.observed||!s.accountId||s.accountId!==expectedAccountId)
      throw Error('Workspace changed; configuration inventory stopped.');
    return s;
  }
  function pluginPath(scope,cursor='') {
    if(!['GLOBAL','WORKSPACE'].includes(scope))throw Error('Invalid plugin installation scope.');
    if(cursor.length>1500)throw Error('Invalid plugin cursor.');
    return `/backend-api/ps/plugins/installed?scope=${scope}`+
      (cursor?'&page_token='+encodeURIComponent(cursor):'');
  }
  async function configurationPluginsPage(expectedAccountId,scope,cursor='',background=false) {
    await assertScope(expectedAccountId);
    const raw=await getJSON(pluginPath(scope,cursor),0,{expectedAccountId,background,verifyFreshScope:true});
    const normalized=ChatArchiveConfigInventory.pluginPage(raw,scope,expectedAccountId);
    await assertScope(expectedAccountId);
    return normalized;
  }
  async function configurationPlugins(expectedAccountId,identity,warnings) {
    const pages={};
    for(const scope of identity.scope_type==='personal'?['GLOBAL']:['GLOBAL','WORKSPACE']){
      const items=[],seen=new Set();let cursor='',complete=false,count=0;
      for(let i=0;i<30;i++) {
        let result;
        try{result=await configurationPluginsPage(expectedAccountId,scope,cursor);}
        catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED'||e.code==='API_COOLDOWN'||e.httpStatus===429)throw e;
          warnings.push('Installed '+scope+' Plugins inventory incomplete: '+e.message);break;}
        items.push(...result.items);count++;
        if(!result.next_page_token){complete=true;break;}
        if(seen.has(result.next_page_token)){warnings.push('Repeated Plugins cursor for '+scope+'.');break;}
        seen.add(result.next_page_token);cursor=result.next_page_token;
      }
      if(!complete)warnings.push('Installed '+scope+' Plugins inventory is partial.');
      pages[scope]={status:complete?'complete':'partial',complete,pages:count,items};
    }
    return ChatArchiveConfigInventory.pluginsFromPages(pages,expectedAccountId);
  }
  function automationPath(bucket,cursor=''){
    if(!['scheduled','paused','finished'].includes(bucket)||cursor.length>1500)
      throw Error('Invalid automation list request.');
    return '/backend-api/automations?filter='+bucket+'&limit=25'+
      (cursor?'&cursor='+encodeURIComponent(cursor):'');
  }
  async function configurationAutomationsPage(expectedAccountId,bucket,cursor='',background=false){
    await assertScope(expectedAccountId);
    const raw=await getJSON(automationPath(bucket,cursor),0,
      {expectedAccountId,background,verifyFreshScope:true});
    const result=ChatArchiveConfigInventory.automationPage(raw,bucket,expectedAccountId);
    await assertScope(expectedAccountId);
    return result;
  }
  async function configurationAutomations(expectedAccountId,background,warnings){
    const pages={};
    for(const bucket of ['scheduled','paused','finished']){
      const items=[],seen=new Set();let cursor='',complete=false,count=0;
      for(let page=0;page<50;page++){
        let result;
        try{result=await configurationAutomationsPage(expectedAccountId,bucket,cursor,background);}
        catch(e){if(['WORKSPACE_CHANGED','AUTH_REQUIRED','API_COOLDOWN'].includes(e.code)||e.httpStatus===429)throw e;
          warnings.push('Schedules '+bucket+' inventory unavailable: '+e.message);break;}
        items.push(...result.items);count++;
        if(!result.cursor){complete=true;break;}
        if(seen.has(result.cursor)){warnings.push('Repeated Schedules cursor for '+bucket);break;}
        seen.add(result.cursor);cursor=result.cursor;
      }
      pages[bucket]={status:complete?'complete':'partial',complete,pages:count,items};
    }
    return ChatArchiveConfigInventory.automationsFromPages(pages);
  }
  async function configurationSnapshot(expectedAccountId,knownGpts=[],background=false) {
    const warnings=[];let identity=null,gpts=null,plugins=null,skills=null,automations=null;
    try{identity=await configurationIdentity(expectedAccountId,background);}
    catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED'||e.code==='API_COOLDOWN')throw e;
      warnings.push('Current profile metadata unavailable: '+e.message);}
    try{gpts=await configurationGpts(expectedAccountId,knownGpts,background);}
    catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED'||e.code==='API_COOLDOWN')throw e;
      warnings.push('GPT bootstrap inventory unavailable: '+e.message);}
    if(identity){
      try{({plugins,skills}=await configurationPlugins(expectedAccountId,identity,warnings));}
      catch(e){if(e.code==='WORKSPACE_CHANGED'||e.code==='AUTH_REQUIRED'||e.code==='API_COOLDOWN')throw e;
        warnings.push('Installed Plugins inventory unavailable: '+e.message);}
    }
    try{automations=await configurationAutomations(expectedAccountId,background,warnings);}
    catch(e){if(['WORKSPACE_CHANGED','AUTH_REQUIRED','API_COOLDOWN'].includes(e.code))throw e;
      warnings.push('Schedules inventory unavailable: '+e.message);}
    await assertScope(expectedAccountId);
    return {identity,gpts,plugins,skills,automations,warnings};
  }

  // Explicit one-shot metadata snapshot. No source content downloads or background timers.
  async function getWorkspaceSnapshot(expectedAccountId = '', progress = () => {}, options = {}) {
    const stopForLimit = e => { if (e?.code === 'API_COOLDOWN' || e?.httpStatus === 429 || e?.code === 'AUTH_REQUIRED') throw e; };
    const startingScope = await status(true);
    if (expectedAccountId && startingScope.accountId !== expectedAccountId)
      throw new Error('Workspace changed; snapshot stopped.');
    const projects = new Map();
    const wanted = Array.isArray(options.projectIds) ? new Set(options.projectIds.map(canonicalProjectId).filter(projectID)) : null;
    const includePersonalization = options.includePersonalization !== false;
    const warnings = [];
    let projectsComplete = true;
    let sidebarBase = '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=false';
    let cursor = '';
    const cursors = new Set();
    for (let page = 0; page < 300; page++) {
      let j;
      try {
        const path = sidebarBase + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
        j = await getJSON(path,0,{expectedAccountId,verifyFreshScope:true});
      } catch (error) { stopForLimit(error);
        if (!page && [400, 403, 404].includes(error.httpStatus)) {
          sidebarBase = '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=true';
          warnings.push('Project API requires owned_only=true; shared projects may not be included.');
          if (!wanted) projectsComplete = false;
          try { j = await getJSON(sidebarBase,0,{expectedAccountId,verifyFreshScope:true}); }
          catch (e) { stopForLimit(e); warnings.push('Could not read project metadata: ' + e.message); projectsComplete = false; break; }
        } else { warnings.push('Project metadata list incomplete: ' + error.message); projectsComplete = false; break; }
      }
      for (const item of records(j, sidebarBase)) {
        const wrapper = item?.gizmo?.gizmo ? item.gizmo : item;
        const p = wrapper?.gizmo || wrapper;
        if (!p?.id || !projectID(p.id)) continue;
        const id=canonicalProjectId(p.id);
        if (wanted && !wanted.has(id)) continue;
        if(p.workspace_id&&p.workspace_id!==expectedAccountId)
          throw Error('Project belongs to another workspace.');
        projects.set(id, projectSnapshot(wrapper));
      }
      progress({detail: `Metadata: ${projects.size} projects`});
      if (!j.cursor) { cursor = ''; break; }
      if (cursors.has(j.cursor)) { projectsComplete = false; warnings.push('Project metadata cursor repeated.'); break; }
      cursors.add(j.cursor); cursor = j.cursor;
    }
    if (cursor) { projectsComplete = false; warnings.push('Project metadata pagination safety limit reached.'); }

    if (wanted) for (const id of wanted) if (!projects.has(id)) {
      try {
        const wrapper = await getJSON(`/backend-api/gizmos/${encodeURIComponent(id)}`,0,{expectedAccountId,verifyFreshScope:true});
        if (wrapper?.gizmo?.id !== id) throw new Error('Project detail ID mismatch.');
        if(wrapper.gizmo.workspace_id&&wrapper.gizmo.workspace_id!==expectedAccountId)
          throw Error('Project belongs to another workspace.');
        projects.set(id, projectSnapshot(wrapper));
      } catch (e) { stopForLimit(e); projectsComplete = false; warnings.push(`Selected project ${id} unavailable: ${e.message}`); }
    }
    // One selected project at a time; no concurrent connector requests.
    for (const p of projects.values()) {
      let next = '';
      const seen = new Set();
      for (let page = 0; page < 100; page++) {
        const path = `/backend-api/projects/${encodeURIComponent(p.gizmo.id)}/connector_scopes?limit=100${next ? '&cursor=' + encodeURIComponent(next) : ''}`;
        try {
          const j = await getJSON(path,0,{expectedAccountId,verifyFreshScope:true});
          for (const s of records(j, path)) {
            p.connectors.push({
              scope_id: s.scope_id || null, connector_type: s.connector_type || null,
              scope_type: s.scope_type || null, display_name: s.display_name || null,
              canonical_handle: s.canonical_handle || null, original_url: s.original_url || null,
              created_at: s.created_at || null, last_synced_at: s.last_synced_at || null,
              last_sync_status: s.last_sync_status || null,
              last_sync_started_at: s.last_sync_started_at || null,
              last_sync_completed_at: s.last_sync_completed_at || null,
              is_connector_syncable: s.is_connector_syncable ?? null,
              connector_files: (s.connector_files || []).map(f => ({
                info: { id: f.info?.id || null, name: f.info?.name || null,
                  type: f.info?.type || null, size: f.info?.size ?? null,
                  last_modified: f.info?.last_modified ?? null },
                location: f.location || null,
                remote_id: f.remote_id || null, remote_modified_time: f.remote_modified_time || null,
                original_url: f.original_url || null
              }))
            });
          }
          if (!j.cursor) { next = ''; break; }
          if (seen.has(j.cursor)) throw new Error('Connector cursor repeated.');
          seen.add(j.cursor); next = j.cursor;
        } catch (e) { stopForLimit(e);
          p.connector_scopes_complete = false;
          warnings.push(`Connector inventory for ${p.gizmo.display.name} unavailable: ${e.message}`);
          break;
        }
      }
      if (next) { p.connector_scopes_complete = false; warnings.push(`Connector inventory for ${p.gizmo.display.name} reached pagination limit.`); }
      progress({detail: `Metadata: checked ${p.gizmo.display.name}`});
    }
    let personalization = null;
    if (includePersonalization) try {
      const raw = await getJSON('/backend-api/user_system_messages',0,{expectedAccountId,verifyFreshScope:true});
      const keys = ['about_user_message', 'about_model_message', 'name_user_message',
        'role_user_message', 'traits_model_message', 'other_user_message',
        'personality_type_selection', 'personality_traits', 'enabled', 'traits_enabled', 'disabled_tools'];
      personalization = Object.fromEntries(keys.filter(k => Object.prototype.hasOwnProperty.call(raw, k)).map(k => [k, raw[k]]));
    } catch (error) { stopForLimit(error); warnings.push('Global personalization unavailable: ' + error.message); }
    const endingScope = await status(true);
    if (startingScope.accountId && endingScope.accountId && startingScope.accountId !== endingScope.accountId)
      throw new Error('Workspace changed during metadata snapshot.');
    // This is a list of GPTs observed in selected chat metadata, not a claim
    // that all installed GPTs have been enumerated. Never copy GPT instructions.
    const gpts=(Array.isArray(options.observedGpts)?options.observedGpts:[])
      .filter(x=>gptID(x?.id)).map(x=>({id:String(x.id),name:String(x.name||'').slice(0,250),
        source:'conversation_listing'}));
    const configuration=options.includeConfiguration!==true?null:
      await configurationSnapshot(startingScope.accountId,gpts);
    if(configuration?.warnings?.length)warnings.push(...configuration.warnings);
    return { captured_at: new Date().toISOString(), active_scope:{account_id:startingScope.accountId},
      identity:configuration?.identity||null,
      custom_gpts:configuration?.gpts||null,
      installed_plugins:configuration?.plugins||null, bundled_skills:configuration?.skills||null,
      schedules:configuration?.automations||null,
      projects_complete: projectsComplete, projects: [...projects.values()], personalization,gpts,
      selection: wanted ? 'selected_projects' : 'all_projects',
      personalization_requested: includePersonalization, warnings };
  }

  async function getChat(item, expectedAccountId = '', options = {}) {
    const s = await status();
    if (expectedAccountId && expectedAccountId !== s.accountId) throw new Error('Workspace changed; export stopped.');
    const raw = await getJSON(`/backend-api/conversation/${encodeURIComponent(item.id)}`, 0, {...options, expectedAccountId});
    if (options.background && (raw.is_generating === true || raw.mapping?.[raw.current_node]?.message?.status === 'in_progress')) {
      const e = new Error('Response is still being generated.'); e.code='STILL_STREAMING'; throw e;
    }
    const currentPathId = (location.pathname.match(/\/c\/([0-9a-f-]{36})/i) || [])[1];
    const source = currentPathId === item.id ? location.origin + location.pathname : '';
    const routeProjectId = source && (location.pathname.match(/\/g\/(g-p-[a-z0-9-]+)\/c\//i) || [])[1];
    const chosen=item.containerObserved===true?(item.projectId||item.gptId||''):
      (item.projectId||item.gptId||raw.gizmo_id||routeProjectId||'');
    const pid=canonicalProjectId(chosen);
    const gid=chosen;
    return ChatArchiveNormalize.normalizeChat(raw, { ...item, projectId:projectID(pid)?pid:'',
      gptId:gptID(gid)?gid:'', origin: location.origin, source });
  }
  async function sourceLocation(fileId, projectId, expectedAccountId, signal, background = false) {
    if (!/^file[_-][a-zA-Z0-9_-]{1,120}$/.test(fileId || '') || !/^g-p-[a-zA-Z0-9-]{1,120}$/.test(projectId || ''))
      throw new Error('Invalid source/project identifier.');
    if (signal?.aborted) throw new Error('Source request cancelled.');
    const session = await getSession();
    const scope = accountInfo(session);
    if (expectedAccountId && expectedAccountId !== scope.accountId) throw new Error('Workspace changed; source download stopped.');
    const data = await getJSON(`/backend-api/files/download/${encodeURIComponent(fileId)}?gizmo_id=${encodeURIComponent(projectId)}&inline=false`, 0, { signal, background, expectedAccountId });
    if (typeof data?.download_url !== 'string' || !data.download_url) throw new Error('API did not return a source download URL.');
    const freshSession = await getSession();
    if (scope.accountId && scope.accountId !== accountInfo(freshSession).accountId) throw new Error('Workspace changed; source download stopped.');
    const headers = { Authorization: `Bearer ${freshSession.accessToken}` };
    if (scope.accountId) headers['ChatGPT-Account-Id'] = scope.accountId;
    // This object stays inside the content script. Only bounded byte chunks leave it.
    return { downloadUrl: data.download_url, origin: location.origin, headers };
  }

  // Manual, read-only inventory. This function never requests download URLs,
  // file bytes, Memory, adjacent accounts, or project source content.
  async function libraryInventory(expectedAccountId, progress = () => {}, options = {}) {
    const initial = await status(true);
    if (!initial.observed || !initial.accountId || initial.accountId !== expectedAccountId)
      throw new Error('A verified active workspace is required for Library inventory.');
    const I = window.ChatArchiveLibraryInventory;
    if (!I) throw new Error('Library inventory helper is unavailable. Reload the ChatGPT tab.');
    const warnings = [];
    const collections = {
      library: {status:'complete',pages:0,folders_scanned:0,nodes:0,errors:0},
      images: {status:'complete',pages:0,images:0,errors:0},
      descriptors: {status:'complete',attempted:0,succeeded:0,failed:0,skipped:0},
      project_links: {status:'complete',projects_found:0,projects_checked:0,refs:0,matched:0,unmatched:0,errors:0}
    };
    const mark = (part, message) => progress({phase:'library',detail:message,component:part});
    const fetchScoped = path => {
      if(options.signal?.aborted)throw new Error('Library inventory cancelled.');
      return getJSON(path,0,{expectedAccountId,verifyFreshScope:true,signal:options.signal});
    };
    const MAX_PAGES = 120, MAX_NODES = 15000, MAX_FOLDERS = 700, MAX_DETAILS = 1200;
    const nodes=[],images=[],folderQueue=[],seenFolders=new Set(),seenLibrary=new Set(),seenGallery=new Set();
    const childQueue = []; // Process the root first, then only discovered Library directories.
    childQueue.push({id:null,depth:0});
    while (childQueue.length) {
      if (seenFolders.size >= MAX_FOLDERS) {
        collections.library.status='partial'; warnings.push('Library folder limit reached; additional folders were not scanned.');break;
      }
      const folder = childQueue.shift();
      if (folder.id) {
        if (seenFolders.has(folder.id))continue;
        seenFolders.add(folder.id);
      }
      if (folder.depth > 16) {collections.library.status='partial';warnings.push('Library nesting depth limit reached.');continue;}
      let cursor='',countPages=0;
      const cursors=new Set();
      for (;;) {
        if (countPages>=MAX_PAGES || nodes.length>=MAX_NODES) {
          collections.library.status='partial'; warnings.push('Library pagination or item limit reached.');break;
        }
        const u=new URL('/backend-api/files/library/nodes', location.origin);
        if(folder.id)u.searchParams.set('parent_directory_id',folder.id);
        if(cursor)u.searchParams.set('cursor',cursor);
        let json;
        try {json=await fetchScoped(u.pathname+u.search);}
        catch(error) {
          if(options.signal?.aborted||error.code==='WORKSPACE_CHANGED'||/workspace changed/i.test(error.message))throw error;
          collections.library.status='partial';collections.library.errors++;
          warnings.push(`Library request failed (folder ${folder.id?'nested':'root'}): HTTP ${error.httpStatus||'network'}.`);
          break;
        }
        if(!Array.isArray(json?.items)) {
          collections.library.status='partial';collections.library.errors++;
          warnings.push('Library response has no items array; it cannot establish a complete inventory.');break;
        }
        collections.library.pages++;countPages++;
        let mismatched=0;
        for(const raw of json.items){
          const node=I.fromNode(raw);
          if(!node)continue;
          // A server that ignores parent_directory_id can return the root
          // collection for every folder. Do not invent child relationships.
          if(folder.id && node.parent_directory_id !== folder.id) {mismatched++;continue;}
          const id = node.library_id ? node.kind+':'+node.library_id : node.file_id ? 'file:'+node.file_id : null;
          if(!id || seenLibrary.has(id))continue;
          seenLibrary.add(id); nodes.push(node);
          if((node.kind==='directory'||node.kind==='folder') && node.library_id &&
             !/^(mounted|external|connector)$/i.test(node.access_kind||'')) {
            childQueue.push({id:node.library_id,depth:folder.depth+1});
          }
        }
        if (mismatched) {
          collections.library.status='partial';collections.library.errors++;
          warnings.push(`Child listing for folder ${folder.id} returned ${mismatched} mismatched parents; rejected those nodes.`);
          break;
        }
        mark('library',`Library: ${nodes.length} nodes, ${collections.library.pages} pages`);
        const next=json.cursor??json.next_cursor??json.after??null;
        if(next==null||next==='')break;
        const str=String(next);
        if(str.length>4096 || cursors.has(str)){
          collections.library.status='partial';warnings.push('Library pagination returned an invalid or repeated cursor.');break;
        }
        cursors.add(str);cursor=str;
      }
      collections.library.folders_scanned++;
    }
    collections.library.nodes=nodes.length;
    // The generated-image gallery is a separate collection: on Free plans it
    // contains images absent from the Library root listing.
    let after='',seenAfter=new Set();
    for(let page=0;page<MAX_PAGES;page++){
      const u=new URL('/backend-api/my/recent/image_gen',location.origin);
      u.searchParams.set('limit','50');if(after)u.searchParams.set('after',after);
      let json;
      try{json=await fetchScoped(u.pathname+u.search);}
      catch(error){
        if(options.signal?.aborted||error.code==='WORKSPACE_CHANGED'||/workspace changed/i.test(error.message))throw error;
        collections.images.status='partial';collections.images.errors++;
        warnings.push(`Images gallery unavailable: HTTP ${error.httpStatus||'network'}.`);break;
      }
      if(!Array.isArray(json?.items)){
        collections.images.status='partial';collections.images.errors++;
        warnings.push('Images response has no items array.');break;
      }
      collections.images.pages++;
      for(const raw of json.items){
        const image=I.fromImage(raw);
        if(!image)continue;
        const key=image.gallery_id||image.file_id;
        if(seenGallery.has(key))continue;
        seenGallery.add(key);images.push(image);
      }
      mark('images',`Generated Images: ${images.length} (${collections.images.pages} pages)`);
      const next=json.after??json.next_cursor??json.cursor??null;
      if(next==null||next==='')break;
      const str=String(next);
      if(str.length>4096 || seenAfter.has(str)){
        collections.images.status='partial';warnings.push('Images pagination returned a repeated or invalid cursor.');break;
      }
      seenAfter.add(str);after=str;
      if(page===MAX_PAGES-1){collections.images.status='partial';warnings.push('Images pagination limit reached.');}
    }
    collections.images.images=images.length;
    // A file's author and its placement are independent facts. Enumerate
    // Project Sources only to attach verified *references* to existing Library
    // file_ids/library_ids. No file bytes, instructions or project text leave
    // this content script; unmatched refs are reported but not invented as files.
    const projectRefs=[], projects=new Map();
    let projectCursor='',projectPath='/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=false';
    const projectCursors=new Set();
    try {
      for(let page=0;page<120;page++){
        let json;
        try{json=await fetchScoped(projectPath+(projectCursor?'&cursor='+encodeURIComponent(projectCursor):''));}
        catch(error){
          if(page===0 && [400,403,404].includes(error.httpStatus)){
            projectPath='/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=true';
            collections.project_links.status='partial';
            warnings.push('Project Source links: API fallback to owned projects; shared references may be missing.');
            json=await fetchScoped(projectPath);
          }else throw error;
        }
        if(!Array.isArray(json?.items))throw Error('Project list returned no items array.');
        for(const raw of json.items){
          const p=raw?.gizmo?.gizmo||raw?.gizmo||raw;
          const pid=canonicalProjectId(p?.id||'');
          if(!projectID(pid))continue;
          if(p.workspace_id && p.workspace_id!==expectedAccountId)
            throw Object.assign(Error('Project belongs to another workspace.'),{code:'WORKSPACE_CHANGED'});
          projects.set(pid,{id:pid,name:String(p.display?.name||p.name||'Untitled Project').slice(0,250)});
        }
        collections.project_links.projects_found=projects.size;
        const next=json.cursor||null;
        if(!next){projectCursor='';break;}
        if(projectCursors.has(next))throw Error('Project list returned a repeated pagination cursor.');
        projectCursors.add(next);projectCursor=next;
        if(page===119){collections.project_links.status='partial';warnings.push('Project Sources: project list page limit reached.');}
      }
      let inspected=0;
      for(const project of projects.values()){
        if(inspected>=200){collections.project_links.status='partial';warnings.push('Project Sources: project detail limit reached.');break;}
        inspected++;
        try{
          const json=await fetchScoped('/backend-api/gizmos/'+encodeURIComponent(project.id));
          const p=json?.gizmo?.gizmo||json?.gizmo||json;
          if(canonicalProjectId(p?.id||'')!==project.id || (p.workspace_id && p.workspace_id!==expectedAccountId))
            throw Object.assign(Error('Project detail scope mismatch.'),{code:'WORKSPACE_CHANGED'});
          if(!Array.isArray(json?.files))throw Error('Project has no files list.');
          collections.project_links.projects_checked++;
          for(const file of json.files){
            const link=I.sourceReference(file,project);
            if(link)projectRefs.push(link);
          }
        }catch(error){
          if(options.signal?.aborted || error.code==='WORKSPACE_CHANGED' || /workspace changed/i.test(error.message))throw error;
          collections.project_links.status='partial';collections.project_links.errors++;
          if(collections.project_links.errors<=8)
            warnings.push(`Project Source links unavailable (${project.name}): HTTP ${error.httpStatus||'schema/network'}.`);
          if(error.code==='API_COOLDOWN'){warnings.push('Project links paused by API cooldown.');break;}
        }
        mark('project_links',`Project Sources: checked ${inspected}/${projects.size} projects`);
      }
    }catch(error){
      if(options.signal?.aborted || error.code==='WORKSPACE_CHANGED' || /workspace changed/i.test(error.message))throw error;
      collections.project_links.status='partial';collections.project_links.errors++;
      warnings.push(`Project Source links incomplete: HTTP ${error.httpStatus||'schema/network'}.`);
    }
    collections.project_links.refs=projectRefs.length;
    // Only obtain metadata for files whose origin was not established from
    // the gallery or the library row. Never fetch file bytes.
    const galleryFileIds=new Set(images.map(x=>x.file_id).filter(Boolean));
    const targets=[...new Set(nodes.filter(x=>x.kind==='file'&&I.goodFile(x.file_id)).map(x=>x.file_id))]
      .filter(fid=>!galleryFileIds.has(fid));
    const chosen=targets.slice(0,MAX_DETAILS);
    collections.descriptors.skipped=targets.length-chosen.length;
    if(collections.descriptors.skipped){collections.descriptors.status='partial';warnings.push(`Descriptor limit: ${collections.descriptors.skipped} files have unverified provenance.`);}
    const details=new Map();let consecutiveNotFound=0,stopEnrichment=false;
    // Two concurrent descriptors reduce the foreground cost without a burst
    // of hundreds of requests. Every request retains the active-account guard.
    for(let i=0;i<chosen.length&&!stopEnrichment;i+=2){
      const batch=chosen.slice(i,i+2);
      const results=await Promise.all(batch.map(async fid=>{
        try{
          const json=await fetchScoped('/backend-api/files/'+encodeURIComponent(fid));
          const detail=I.fromDetail(json);
          if(!detail)throw Error('Unexpected file descriptor.');
          return {fid,detail};
        }catch(error){return {fid,error};}
      }));
      for(const result of results){
        collections.descriptors.attempted++;
        if(result.detail){
          details.set(result.fid,result.detail);collections.descriptors.succeeded++;
          consecutiveNotFound=0;
        }else{
          const error=result.error;
          if(options.signal?.aborted||error.code==='WORKSPACE_CHANGED'||/workspace changed/i.test(error.message))throw error;
          collections.descriptors.failed++;collections.descriptors.status='partial';
          consecutiveNotFound=error.httpStatus===404?consecutiveNotFound+1:0;
          if(collections.descriptors.failed<=8)
            warnings.push(`File metadata unavailable (${result.fid.slice(-8)}): HTTP ${error.httpStatus||'network'}.`);
          if(error.code==='API_COOLDOWN'||consecutiveNotFound>=4){
            stopEnrichment=true;
            warnings.push(error.code==='API_COOLDOWN'?'Descriptor enrichment paused by API cooldown.':'Descriptor endpoint returned repeated 404; enrichment stopped.');
          }
        }
      }
      if(i%12===0||i+batch.length===chosen.length)
        mark('descriptors',`File origins: ${Math.min(i+batch.length,chosen.length)}/${chosen.length} checked`);
      if(!stopEnrichment && i+batch.length<chosen.length)await sleep(100);
      if(options.signal?.aborted)throw Error('Library inventory cancelled.');
    }
    collections.descriptors.skipped+=Math.max(0,chosen.length-collections.descriptors.attempted);
    if(collections.descriptors.skipped)collections.descriptors.status='partial';
    if(options.signal?.aborted)throw new Error('Library inventory cancelled.');
    const end=await status(true);
    if(!end.observed||end.accountId!==expectedAccountId)throw new Error('Workspace changed during library inventory; results discarded.');
    const catalog=I.linkCatalog(I.buildCatalog(nodes,images,details),projectRefs);
    collections.project_links.matched=catalog.project_source_refs.matched;
    collections.project_links.unmatched=catalog.project_source_refs.unmatched.length;
    return {
      schema:'cae.library-inventory.v2',captured_at:new Date().toISOString(),
      active_scope:{account_id:expectedAccountId,workspace_name:initial.display},
      status:collections.library.status==='complete'&&collections.images.status==='complete'?'complete':'partial',
      classification_status:collections.descriptors.status,links_status:collections.project_links.status,
      collections,summary:catalog.summary,items:catalog.items,folders:catalog.folders,
      unmatched_project_refs:catalog.project_source_refs.unmatched,warnings
    };
  }

  // Bounded background operations: one pagination page per durable job. No
  // guessed endpoints, no Memory, no auth material in returned objects.
  async function backgroundPage(query, expectedAccountId) {
    if (!expectedAccountId) throw new Error('A confirmed workspace is required.');
    const opts={background:true, expectedAccountId};
    const projectId=canonicalProjectId(query.projectId||'');
    const cursor=typeof query.cursor==='string'?query.cursor:'';
    if(cursor.length>4096)throw new Error('Invalid cursor.');
    const needProject=()=>{if(!/^g-p-[a-f0-9]{32}$/i.test(projectId))throw new Error('Invalid project ID.');};
    const chat=(x,p=null)=>({id:x.id,title:x.title||'Untitled chat',
      projectId:projectID(p?.id||x.gizmo_id)?canonicalProjectId(p?.id||x.gizmo_id):'',
      project:p?.name||'', ...(!p?observedGpt(x):{gptId:'',gptName:''}),
      containerObserved:Boolean(p)||Object.prototype.hasOwnProperty.call(x,'gizmo_id'),
      archived:Boolean(x.is_archived||query.archived), updated:x.update_time??x.updated_at??'',
      created:x.create_time??x.created_at??''});
    switch(query.kind){
      case 'config_identity':return configurationIdentity(expectedAccountId,true);
      case 'config_gpts':return configurationGpts(expectedAccountId,
        Array.isArray(query.knownGpts)?query.knownGpts.slice(0,500):[],true);
      case 'config_plugins':return configurationPluginsPage(expectedAccountId,
        query.scope,typeof query.pageToken==='string'?query.pageToken:'',true);
      case 'config_schedules':return configurationAutomationsPage(expectedAccountId,
        query.bucket,typeof query.cursor==='string'?query.cursor:'',true);
      case 'projects': {
        const path='/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=false'+
          (cursor?'&cursor='+encodeURIComponent(cursor):'');
        const j=await getJSON(path,0,opts);
        const items=records(j,path).map(x=>x?.gizmo?.gizmo?x.gizmo:x);
        const eligible=items.filter(x=>projectID(x?.gizmo?.id));
        if(eligible.some(x=>x.gizmo?.workspace_id&&x.gizmo.workspace_id!==expectedAccountId))
          throw Error('Project list contains another workspace; inventory rejected.');
        if(eligible.some(x=>!Array.isArray(x.files)))throw new Error('Incomplete project inventory schema.');
        return {items:eligible.map(projectSnapshot),cursor:j.cursor||null};
      }
      case 'chats': {
        const offset=Number(query.offset)||0;
        if(offset<0||offset>100000||offset%100)throw new Error('Invalid list offset.');
        const path='/backend-api/conversations?offset='+offset+'&limit=100&order=updated'+(query.archived?'&is_archived=true':'');
        const j=await getJSON(path,0,opts),items=records(j,path);
        return {items:items.filter(x=>x?.id).map(x=>chat(x)),
          nextOffset:items.length===100&&(!Number.isFinite(j.total)||offset+100<j.total)?offset+100:null};
      }
      case 'project_chats': {
        needProject();const path=`/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=${encodeURIComponent(cursor||'0')}`;
        const j=await getJSON(path,0,opts);
        return {items:records(j,path).filter(x=>x?.id).map(x=>chat(x,{id:projectId,name:query.projectName||''})),cursor:j.cursor||null};
      }
      case 'project': {
        needProject();const j=await getJSON(`/backend-api/gizmos/${encodeURIComponent(projectId)}`,0,opts);
        if(j?.gizmo?.id!==projectId||(j.gizmo.workspace_id&&j.gizmo.workspace_id!==expectedAccountId)||!Array.isArray(j.files))throw new Error('Incomplete project detail schema.');
        return projectSnapshot(j);
      }
      case 'connectors': {
        needProject();const path=`/backend-api/projects/${encodeURIComponent(projectId)}/connector_scopes?limit=100`+(cursor?'&cursor='+encodeURIComponent(cursor):'');
        const j=await getJSON(path,0,opts);
        if(j.project_connectors_enabled===false)throw new Error('Project connectors are disabled; inventory is not authoritative for removals.');
        return {cursor:j.cursor||null,items:records(j,path).map(x=>({
          scope_id:x.scope_id||null,connector_type:x.connector_type||null,scope_type:x.scope_type||null,
          display_name:x.display_name||null,canonical_handle:x.canonical_handle||null,original_url:x.original_url||null,
          created_at:x.created_at||null,last_synced_at:x.last_synced_at||null,last_sync_status:x.last_sync_status||null,
          last_sync_started_at:x.last_sync_started_at||null,last_sync_completed_at:x.last_sync_completed_at||null,
          is_connector_syncable:x.is_connector_syncable??null,
          connector_files:(Array.isArray(x.connector_files)?x.connector_files:[]).map(f=>({info:{
            id:f.info?.id||null,name:f.info?.name||null,type:f.info?.type||null,size:f.info?.size??null,
            last_modified:f.info?.last_modified??null},location:f.location||null,remote_id:f.remote_id||null,
            remote_modified_time:f.remote_modified_time||null,original_url:f.original_url||null}))}))};
      }
      case 'personalization': {
        const j=await getJSON('/backend-api/user_system_messages',0,opts);
        const fields=['about_user_message','about_model_message','name_user_message','role_user_message',
          'traits_model_message','other_user_message','personality_type_selection','personality_traits','enabled','traits_enabled','disabled_tools'];
        return Object.fromEntries(fields.filter(k=>Object.prototype.hasOwnProperty.call(j,k)).map(k=>[k,j[k]]));
      }
      default: throw new Error('Unknown background metadata operation.');
    }
  }

  // Bounded operations owned by the durable Library controller, not the panel.
  // All route construction is local; no arbitrary URL supplied by extension UI.
  async function libraryPage(query, expectedAccountId, signal) {
    const I=window.ChatArchiveLibraryInventory;
    const check=async()=>{
      if(signal?.aborted)throw Object.assign(Error('Library operation stopped.'),{code:'CANCELLED'});
      const s=await status(true);
      if(!s.observed||!expectedAccountId||s.accountId!==expectedAccountId)
        throw Object.assign(Error('Workspace changed; Library operation paused.'),{code:'WORKSPACE_CHANGED'});
      return s;
    };
    await check();
    const opts={expectedAccountId,verifyFreshScope:true,signal,background:query.background===true};
    const get=path=>getJSON(path,0,opts);
    const cursor=typeof query.cursor==='string'?query.cursor:'';
    if(cursor.length>4096)throw Error('Invalid pagination cursor.');
    const next=j=>{
      const v=j?.cursor??j?.next_cursor??j?.after??null;
      if(v!==null&&(typeof v!=='string'||v.length>4096))throw Error('Invalid server cursor.');
      return v||null;
    };
    const items=j=>{if(!Array.isArray(j?.items))throw Error('No items array in response.');return j.items;};
    let result;
    if(query.kind==='nodes'){
      const u=new URL('/backend-api/files/library/nodes',location.origin);
      if(query.parent){if(!I.goodNode(query.parent))throw Error('Invalid directory ID.');u.searchParams.set('parent_directory_id',query.parent);}
      if(cursor)u.searchParams.set('cursor',cursor);
      const j=await get(u.pathname+u.search),rows=items(j).map(I.fromNode).filter(Boolean);
      if(query.parent&&rows.some(x=>x.parent_directory_id!==query.parent))throw Error('Server returned mismatched directory parents.');
      result={items:rows,cursor:next(j),ignored:items(j).length-rows.length};
    }else if(query.kind==='images'){
      const u=new URL('/backend-api/my/recent/image_gen',location.origin);
      u.searchParams.set('limit','50');if(cursor)u.searchParams.set('after',cursor);
      const j=await get(u.pathname+u.search);
      result={items:items(j).map(I.fromImage).filter(Boolean),cursor:next(j)};
    }else if(query.kind==='projects'){
      const u=new URL('/backend-api/gizmos/snorlax/sidebar',location.origin);
      u.searchParams.set('conversations_per_gizmo','0');u.searchParams.set('owned_only',query.ownedOnly?'true':'false');
      if(cursor)u.searchParams.set('cursor',cursor);
      const j=await get(u.pathname+u.search),rows=[];
      for(const raw of items(j)){
        const p=raw?.gizmo?.gizmo||raw?.gizmo||raw,id=canonicalProjectId(p?.id||'');
        if(!projectID(id))continue;
        if(p.workspace_id&&p.workspace_id!==expectedAccountId)throw Object.assign(Error('Project workspace mismatch.'),{code:'WORKSPACE_CHANGED'});
        rows.push({id,name:String(p.display?.name||p.name||'Untitled Project').slice(0,250)});
      }
      result={items:rows,cursor:next(j)};
    }else if(query.kind==='project_refs'){
      if(!projectID(query.projectId))throw Error('Invalid Project ID.');
      const j=await get('/backend-api/gizmos/'+encodeURIComponent(query.projectId));
      const p=j?.gizmo?.gizmo||j?.gizmo||j;
      if(canonicalProjectId(p?.id||'')!==query.projectId||(p.workspace_id&&p.workspace_id!==expectedAccountId))
        throw Object.assign(Error('Project workspace mismatch.'),{code:'WORKSPACE_CHANGED'});
      if(!Array.isArray(j.files))throw Error('Project files list unavailable.');
      const project={id:query.projectId,name:String(p.display?.name||p.name||query.projectName||'Untitled Project').slice(0,250)};
      result={refs:j.files.map(x=>I.sourceReference(x,project)).filter(Boolean)};
    }else if(query.kind==='details'){
      if(!Array.isArray(query.fileIds)||query.fileIds.length>2||!query.fileIds.every(I.goodFile))throw Error('Invalid descriptor batch.');
      const rows=[];
      for(const id of query.fileIds){
        try{
          const d=I.fromDetail(await get('/backend-api/files/'+encodeURIComponent(id)));
          if(!d)throw Error('Invalid file descriptor.');
          rows.push({file_id:id,detail:d});
        }catch(e){
          if(signal?.aborted||['WORKSPACE_CHANGED','API_COOLDOWN','AUTH_REQUIRED'].includes(e.code))throw e;
          rows.push({file_id:id,error:{code:e.code||'DESCRIPTOR_UNAVAILABLE',http_status:e.httpStatus||null}});
        }
      }
      result={items:rows};
    }else throw Error('Unknown Library metadata operation.');
    await check(); // Discard a page if the browser changed workspace during its request.
    return result;
  }
  async function assetLocation(fileId, expectedAccountId, signal, conversationId = '') {
    const conversationFile=conversationId&&typeof fileId==='string'&&/^file[_-][a-zA-Z0-9_-]{1,120}$/.test(fileId);
    if((!window.ChatArchiveLibraryInventory.goodFile(fileId)&&!conversationFile)||!expectedAccountId)throw Error('Invalid Library file identifier.');
    if(conversationId&&!/^[a-zA-Z0-9_-]{10,100}$/.test(conversationId))throw Error('Invalid conversation identifier.');
    const before=await status(true);
    if(!before.observed||before.accountId!==expectedAccountId)throw Object.assign(Error('Workspace changed.'),{code:'WORKSPACE_CHANGED'});
    const j=await getJSON('/backend-api/files/download/'+encodeURIComponent(fileId)+'?inline=false'+
      (conversationId?'&conversation_id='+encodeURIComponent(conversationId):''),0,
      {expectedAccountId,verifyFreshScope:true,signal});
    if(typeof j?.download_url!=='string'||!j.download_url)throw Error('No original download URL returned.');
    const session=await getSession(true),after=accountInfo(session);
    if(!after.observed||after.accountId!==expectedAccountId)throw Object.assign(Error('Workspace changed.'),{code:'WORKSPACE_CHANGED'});
    return {downloadUrl:j.download_url,origin:location.origin,
      headers:{Authorization:`Bearer ${session.accessToken}`,'ChatGPT-Account-Id':expectedAccountId}};
  }

  // Only resolve an attachment observed in the exact selected message of the
  // freshly read active branch. A caller cannot supply a URL or borrow a file
  // identifier from another conversation/message. The location stays local to
  // this content script and is consumed by the existing bounded SourceTransfer.
  async function attachmentLocation(attachment, expectedAccountId, signal) {
    const fail=(code,message,httpStatus)=>{throw Object.assign(Error(message),{code,...(httpStatus?{httpStatus}:{})});};
    const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(v);
    const file=v=>typeof v==='string'&&/^file[_-][a-zA-Z0-9_-]{1,120}$/.test(v);
    const path=v=>typeof v==='string'&&v.length<=2048&&v.startsWith('/mnt/data/')&&
      !/[\\\x00-\x1f\x7f?#]/.test(v)&&!v.endsWith('/')&&!v.includes('//')&&
      !v.split('/').some(p=>p==='.'||p==='..');
    if(!attachment||typeof attachment!=='object'||Array.isArray(attachment)||
       !/^[a-zA-Z0-9_-]{10,100}$/.test(attachment.conversationId||'')||!id(attachment.messageId)||
       typeof attachment.key!=='string'||!attachment.key||attachment.key.length>4096||
       typeof expectedAccountId!=='string'||!expectedAccountId||
       (attachment.fileId!=null&&!file(attachment.fileId))||
       (attachment.sandboxPath!=null&&!path(attachment.sandboxPath))||
       (!attachment.fileId&&!attachment.sandboxPath)||
       ['url','downloadUrl','download_url','headers'].some(k=>Object.prototype.hasOwnProperty.call(attachment,k)))
      fail('ATTACHMENT_INVALID','Invalid conversation attachment reference.');
    const N=globalThis.ChatArchiveNormalize,E=globalThis.ChatArchiveExportSelection;
    if(!N||!E)fail('ATTACHMENT_UNAVAILABLE','Attachment helpers are unavailable. Reload the ChatGPT tab.');
    const check=async()=>{
      if(signal?.aborted)fail('SOURCE_ABORTED','Attachment request cancelled.');
      const s=await status(true);
      if(!s.observed||s.accountId!==expectedAccountId)fail('WORKSPACE_CHANGED','Workspace changed; attachment download stopped.');
    };
    await check();
    const cid=attachment.conversationId;
    let raw;
    try { raw=await getJSON('/backend-api/conversation/'+encodeURIComponent(cid),0,
      {expectedAccountId,verifyFreshScope:true,signal}); }
    catch(e){
      if([403,404,410].includes(e.httpStatus))fail('ATTACHMENT_UNAVAILABLE','The attachment conversation is no longer available.',e.httpStatus);
      throw e;
    }
    await check();
    if((raw?.conversation_id||raw?.id)!==cid)fail('ATTACHMENT_CHANGED','The attachment conversation changed. Reload the message selector.');
    if((raw.workspace_id&&raw.workspace_id!==expectedAccountId)||(raw.account_id&&raw.account_id!==expectedAccountId))
      fail('WORKSPACE_CHANGED','Attachment conversation belongs to another workspace.');
    if(raw.is_temporary===true||raw.is_temporary_chat===true||raw.temporary===true)
      fail('ATTACHMENT_UNAVAILABLE','Temporary conversations are excluded from export.');
    const chat=N.normalizeChat(raw,{id:cid,origin:location.origin});
    const matches=a=>a.key===attachment.key&&(a.fileId||null)===(attachment.fileId||null)&&
      (a.sandboxPath||null)===(attachment.sandboxPath||null);
    const message=chat.messages.find(m=>m.id===attachment.messageId);
    const ref=message?.attachments?.find(matches);
    const planned=E.attachments(chat,E.DEFAULTS).some(a=>
      a.messageIds.includes(attachment.messageId)&&a.keys.includes(attachment.key)&&
      (a.fileId||null)===(attachment.fileId||null)&&(a.sandboxPath||null)===(attachment.sandboxPath||null));
    if(!ref||!planned)fail('ATTACHMENT_CHANGED','The selected message no longer contains this attachment. Reload the message selector.');
    try {
      if(ref.fileId)return await assetLocation(ref.fileId,expectedAccountId,signal,cid);
      if(message.role!=='assistant'||ref.origin!=='generated')
        fail('ATTACHMENT_UNAVAILABLE','This attachment has no supported original-file locator.');
      const node=Object.values(raw.mapping).find(n=>n?.id===attachment.messageId);
      const providerMessageId=node?.message?.id||node?.id;
      if(!id(providerMessageId))fail('ATTACHMENT_UNAVAILABLE','The generating message identifier is unavailable.');
      // Observed provider contract: chat2api ChatService.get_response_file_url
      // and DownloadConversation issue #78. No fallback to neighboring messages,
      // Library search, or guessed file identifiers when the sandbox has expired.
      const endpoint='/backend-api/conversation/'+encodeURIComponent(cid)+'/interpreter/download'+
        '?message_id='+encodeURIComponent(providerMessageId)+'&sandbox_path='+encodeURIComponent(ref.sandboxPath)+'&download_intent=true';
      const j=await getJSON(endpoint,0,{expectedAccountId,verifyFreshScope:true,signal});
      await check();
      if(j?.status==='error'||typeof j?.download_url!=='string'||!j.download_url)
        fail('ATTACHMENT_UNAVAILABLE','The generated file is unavailable or its sandbox has expired.');
      const session=await getSession(true),scope=accountInfo(session);
      if(!scope.observed||scope.accountId!==expectedAccountId)fail('WORKSPACE_CHANGED','Workspace changed; attachment download stopped.');
      if(signal?.aborted)fail('SOURCE_ABORTED','Attachment request cancelled.');
      return {downloadUrl:j.download_url,origin:location.origin,
        headers:{Authorization:`Bearer ${session.accessToken}`,'ChatGPT-Account-Id':expectedAccountId}};
    } catch(e){
      if([403,404,410].includes(e.httpStatus))fail('ATTACHMENT_UNAVAILABLE','The original file is no longer available for this message.',e.httpStatus);
      throw e;
    }
  }

  window.ChatArchiveApi = { status, listAll, getChat, getWorkspaceSnapshot, sourceLocation, backgroundPage, libraryInventory, libraryPage, assetLocation, attachmentLocation };
})();
