/* Vault storage shared by manual export and the opt-in sync worker. No network IO.
 * Files stay in the user-selected directory. The index is saved in that directory
 * rather than in Chrome-only storage, so reinstalls do not lose change tracking. */
(function (root) {
  'use strict';
  const INDEX_PATH = 'ChatGPT/.chat-archive/index.json';
  const WORKSPACE_SCHEMA = 'cae.workspace-chats.v1';
  const DB_NAME = 'cae-vault-handles';
  const DB_STORE = 'settings';
  const DB_KEY = 'selected-directory';
  const encoder = new TextEncoder();
  function validPath(path) {
    if (typeof path !== 'string' || path.length > 2000 || path.includes('\\')) return false;
    const parts = path.split('/');
    return parts.length >= 3 && parts[0] === 'ChatGPT' && parts.every(p =>
      p && p !== '.' && p !== '..' && p.length <= 255 &&
      !/[\\/:*?"<>|\x00-\x1f]/.test(p) && !/[. ]$/.test(p) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
  }
  function ensurePath(path) {
    if (!validPath(path)) throw new Error('Unsafe Vault path.');
    return path.split('/');
  }
  const isMissing = e => e?.name === 'NotFoundError';
  const forbiddenName = e => e?.name === 'TypeError' && /name is not allowed|invalid.+name/i.test(String(e?.message || ''));
  const unsupportedNameError = () => Object.assign(new Error('File System Access rejected the source filename and its inert alias. Original name remains in the task metadata.'),{code:'UNSUPPORTED_FILENAME'});
  function safeSourceFallback(path) {
    const parts = ensurePath(path), filename = parts.pop();
    // Do not assume which extension or basename Chrome rejected. The explicit
    // inert suffix is stable and does not change the underlying original bytes.
    parts.push(ChatArchivePaths.inertFilename(filename));
    const result = parts.join('/');ensurePath(result);return result;
  }
  async function parentDirectory(rootHandle, path, create = false) {
    const parts = ensurePath(path);
    let dir = rootHandle;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return { dir, filename: parts.at(-1) };
  }
  async function lookupFile(rootHandle, path) {
    try {
      const { dir, filename } = await parentDirectory(rootHandle, path, false);
      return { dir, handle: await dir.getFileHandle(filename, { create: false }), filename };
    } catch (e) { if (isMissing(e)) return null; throw e; }
  }
  function newIndex() {
    return { schema: 'cae.vault-index.v1', created_at: new Date().toISOString(),
      updated_at: null, sources: Object.create(null), chats: Object.create(null), metadata: Object.create(null) };
  }
  async function digestStream(file) {
    const digest = new ChatArchiveHash.Sha256();
    if (typeof file.stream !== 'function') throw new Error('File streaming is unavailable.');
    const reader = file.stream().getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        digest.update(item.value);
      }
      return digest.hex();
    } finally { reader.releaseLock(); }
  }
  async function readIndex(rootHandle) {
    const existing = await lookupFile(rootHandle, INDEX_PATH);
    if (!existing) return newIndex();
    const file = await existing.handle.getFile();
    if (file.size > 16 * 1024 * 1024) throw new Error('Vault index exceeds the 16 MiB safety limit.');
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error('Vault index is invalid JSON. Rename it manually before retrying; it will not be overwritten.'); }
    if (!data || data.schema !== 'cae.vault-index.v1' ||
      !['sources', 'chats', 'metadata'].every(k => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])))
      throw new Error('Vault index has an unknown or invalid schema. No files were modified.');
    // Never trust a path returned from a file on disk without checking it again.
    return data;
  }
  async function writeFile(rootHandle, path, contents) {
    const prior = await lookupFile(rootHandle, path);
    const { dir, filename } = await parentDirectory(rootHandle, path, true);
    const handle = await dir.getFileHandle(filename, { create: true });
    let stream = null;
    try {
      stream = await handle.createWritable();
      await stream.write(contents);
      await stream.close();
    } catch (e) {
      try { await stream?.abort(); } catch {}
      if (!prior) {
        try { if ((await handle.getFile()).size === 0) await dir.removeEntry(filename); } catch {}
      }
      throw e;
    }
    return handle;
  }
  async function saveIndex(rootHandle, data) {
    data.updated_at = new Date().toISOString();
    const content = JSON.stringify(data, null, 2) + '\n';
    if (encoder.encode(content).byteLength > 16 * 1024 * 1024)
      throw new Error('Vault index is too large to update; no further files should be downloaded.');
    await writeFile(rootHandle, INDEX_PATH, content);
  }
  function sourceFingerprint(job) {
    return JSON.stringify({ file_id: job.fileId, expected_bytes: job.expectedBytes ?? null,
      modified: job.sourceModifiedMs ?? null, remote_modified: job.remoteModifiedTime || null,
      location: job.sourceLocation || null });
  }
  function keyFor(accountId, job) {
    if (!accountId || !job?.key) throw new Error('Account and source identifiers are required for the Vault index.');
    return `${accountId}|${job.key}`;
  }
  // Conversation-list metadata is the preflight source of truth. The detail
  // endpoint must not be called just to learn whether a chat was updated.
  function chatTimestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      const ms = n < 1e11 ? n * 1000 : n;
      return ms > 0 && ms < 8.64e15 ? Math.round(ms) : null;
    }
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }
  function chatFingerprint(chat) {
    const updated = chatTimestamp(chat?.updated);
    if (updated === null || !chat?.id) return null; // Never infer unchanged from created_at alone.
    return JSON.stringify({ id: String(chat.id), updated_ms: updated,
      title: String(chat.title || ''), project_id: ChatArchivePaths.canonical(chat.projectId || ''),
      archived:Boolean(chat.archived),gpt_id:ChatArchivePaths.gptId(chat.gptId||''),
      gpt_name:String(chat.gptName||'') });
  }
  // The Markdown's `updated` is the archived conversation revision. `exported`
  // and File.lastModified are not remote revision markers.
  async function readChatHeader(file) {
    const head = await file.slice(0, 16384).text();
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(head)?.[1];
    if (!block) return null;
    const fields = Object.create(null);
    for (const line of block.split(/\r?\n/)) {
      const m = /^(title|updated|created|exported|conversation_id|project|project_id|archived|source|container_type|container_id|gpt):\s*(.+)$/.exec(line);
      if (!m) continue;
      try { fields[m[1]] = JSON.parse(m[2]); } catch { return null; }
    }
    if (!fields.conversation_id || typeof fields.updated !== 'string') return null;
    return fields;
  }
  function projectFromHeader(fields) {
    const match = String(fields?.source || '').match(/\/g\/(g-p-[a-f0-9]{32})(?:[-/]|$)/i);
    return match ? ChatArchivePaths.canonical(match[1]) : '';
  }
  function previousListMarker(fingerprint, id) {
    try {
      const marker = JSON.parse(fingerprint);
      return marker?.id === id && Number.isFinite(marker.updated_ms) ? marker : null;
    } catch { return null; }
  }
  async function matchesChatFile(handle, record) {
    const file = await handle.getFile();
    if (!Number.isFinite(record?.bytes) || file.size !== record.bytes || !/^[0-9a-f]{64}$/i.test(record?.sha256 || '')) return false;
    // Hash on every chat preflight. Disk timestamps are never a version check;
    // additionally this detects same-size local edits with preserved mtime.
    return (await digestStream(file)) === record.sha256;
  }
  function workspaceIndexPath(prefix) {
    const path = String(prefix || '') + '/.workspace.json';
    ensurePath(path);
    if (path.split('/').length !== 3) throw new Error('Invalid workspace directory.');
    return path;
  }
  async function readWorkspaceIndex(rootHandle, prefix, accountId) {
    const path = workspaceIndexPath(prefix);
    const existing = await lookupFile(rootHandle, path);
    if (!existing) return { schema: WORKSPACE_SCHEMA, account_id: accountId,
      workspace: prefix.slice('ChatGPT/'.length), created_at: new Date().toISOString(),
      updated_at: null, chats: Object.create(null) };
    const file = await existing.handle.getFile();
    if (file.size > 16 * 1024 * 1024) throw new Error('Workspace chat index exceeds the 16 MiB safety limit.');
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error('Workspace chat index is invalid JSON. It will not be overwritten.'); }
    if (!data || data.schema !== WORKSPACE_SCHEMA || data.account_id !== accountId ||
        !data.chats || typeof data.chats !== 'object' || Array.isArray(data.chats))
      throw new Error('Workspace index has an invalid schema or belongs to another account.');
    data.chats = Object.assign(Object.create(null), data.chats);
    return data;
  }
  /* Resolve a previously archived workspace by its immutable account ID.
   * No writes, renames, enrollment, or guessing from a display name. The
   * existing seed/hash checks still decide whether monitoring may start. */
  async function resolveWorkspacePrefix(rootHandle, preferred, accountId) {
    workspaceIndexPath(preferred);
    if(typeof accountId!=='string'||!/^[a-zA-Z0-9_-]{3,120}$/.test(accountId))throw Error('Verified workspace ID required.');
    const index=await readIndex(rootHandle),owners=new Map(),matches=new Set();
    const prefixOf=p=>validPath(p)&&p.split('/')[1].toLowerCase()!=='.chat-archive' ? p.split('/').slice(0,2).join('/') : null;
    for(const group of [index.chats,index.metadata,index.sources]){
      for(const [key,rec] of Object.entries(group||{})){
        const sep=key.indexOf('|'),p=prefixOf(rec?.path);
        if(sep<=0||!p)continue;
        const id=key.slice(0,sep);
        if(!owners.has(p))owners.set(p,new Set());
        owners.get(p).add(id);
        if(id===accountId)matches.add(p);
      }
    }
    // If the global index does not know this account, look only at immediate
    // workspace directories, not chat bodies or other provider data.
    if(!matches.size){
      let top;
      try{top=await rootHandle.getDirectoryHandle('ChatGPT',{create:false});}
      catch(e){if(!isMissing(e))throw e;}
      if(top&&typeof top.entries==='function'){
        let count=0;
        for await(const [name,handle] of top.entries()){
          if(++count>512)throw Error('Too many Vault entries to identify a workspace safely.');
          const p='ChatGPT/'+name;
          if(handle?.kind!=='directory'||name.toLowerCase()==='.chat-archive'||!validPath(p+'/.workspace.json'))continue;
          try{
            const ledger=await readJson(rootHandle,p+'/.workspace.json');
            if(ledger?.schema===WORKSPACE_SCHEMA&&ledger.account_id===accountId&&ledger.chats&&typeof ledger.chats==='object'&&!Array.isArray(ledger.chats))matches.add(p);
          }catch(e){if(p===preferred)throw e;}
        }
      }
    }
    if(matches.size>1)throw Error('More than one archive directory matches this workspace ID. Resolve the duplicate directories before writing.');
    const chosen=matches.values().next().value||preferred;
    if(chosen.toLowerCase()==='chatgpt/.chat-archive'||[...owners].some(([p,ids])=>p.toLowerCase()===chosen.toLowerCase()&&[...ids].some(id=>id!==accountId)))
      throw Error('Vault directory is indexed for another workspace. No files were changed.');
    const ledger=await readJson(rootHandle,workspaceIndexPath(chosen));
    if(ledger&&(ledger.schema!==WORKSPACE_SCHEMA||ledger.account_id!==accountId||!ledger.chats||typeof ledger.chats!=='object'||Array.isArray(ledger.chats)))
      throw Error('Workspace index belongs to another account or has an invalid schema. No files were changed.');
    const sync=await readJson(rootHandle,chosen+'/.sync.json');
    if(sync&&(sync.schema!=='cae.background-config.v1'||sync.account_id!==accountId))
      throw Error('Vault monitoring configuration belongs to another workspace or has an invalid schema.');
    if(!ledger&&!sync){
      const config=await readJson(rootHandle,chosen+'/_workspace_configuration.json');
      if(config&&(config.schema!=='cae.workspace-configuration.v1'||config.active_scope?.account_id!==accountId))
        throw Error('Vault configuration belongs to another workspace or has an invalid schema.');
    }
    return chosen;
  }
  async function writeWorkspaceIndex(rootHandle, prefix, data) {
    const previousDate = data.updated_at;
    data.updated_at = new Date().toISOString();
    const content = JSON.stringify(data, null, 2) + '\n';
    if (encoder.encode(content).byteLength > 16 * 1024 * 1024) {
      data.updated_at = previousDate;
      throw new Error('Workspace index exceeds the 16 MiB safety limit.');
    }
    try { await writeFile(rootHandle, workspaceIndexPath(prefix), content); }
    catch (e) { data.updated_at = previousDate; throw e; }
  }
  async function matchesFile(handle, record) {
    const file = await handle.getFile();
    if (!Number.isFinite(record?.bytes) || typeof record.sha256 !== 'string') return false;
    if (file.size !== record.bytes) return false;
    // Same size and mtime do not prove integrity; a user can restore mtime.
    return (await digestStream(file)) === record.sha256;
  }
  function disambiguate(path, id, count) {
    const parts = ensurePath(path), name = parts.pop();
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const suffix = ` [${ChatArchivePaths.safe(String(id || 'source').slice(-10), 10)}${count > 1 ? '-' + count : ''}]`;
    parts.push(stem.slice(0, Math.max(1, 235 - suffix.length - ext.length)) + suffix + ext);
    return parts.join('/');
  }
  async function selectUnusedPath(rootHandle, preferred, id) {
    let candidate = preferred;
    for (let i = 0; i <= 500; i++) {
      const proposed = i === 0 ? candidate : disambiguate(candidate, id, i);
      try { if (!(await lookupFile(rootHandle, proposed))) return proposed; }
      catch (e) {
        if (forbiddenName(e) && candidate === preferred) { candidate = safeSourceFallback(preferred); i = -1; continue; }
        throw forbiddenName(e) ? unsupportedNameError() : e;
      }
    }
    throw new Error('Unable to allocate an unused source filename.');
  }
  async function openStore(rootHandle) {
    if (!rootHandle || typeof rootHandle.getDirectoryHandle !== 'function') throw new Error('No Vault directory selected.');
    const index = await readIndex(rootHandle);
    async function record(kind, key, value) {
      const old = index[kind][key];
      index[kind][key] = value;
      try { await saveIndex(rootHandle, index); }
      catch (e) { if (old === undefined) delete index[kind][key]; else index[kind][key] = old; throw e; }
    }
    let workspace = null;
    let workspacePrefix = '';
    let workspaceAccountId = '';
    async function recordWorkspaceChat(id, value) {
      if (!workspace || !id) throw new Error('Workspace index not opened.');
      const previous = workspace.chats[id];
      workspace.chats[id] = value;
      try { await writeWorkspaceIndex(rootHandle, workspacePrefix, workspace); }
      catch (e) {
        if (previous === undefined) delete workspace.chats[id];
        else workspace.chats[id] = previous;
        throw e;
      }
    }
    async function useWorkspace(prefix, accountId) {
      if (!accountId || typeof accountId !== 'string') throw new Error('Cannot index Vault chats without a confirmed account ID.');
      if (workspace && workspacePrefix === prefix && workspaceAccountId === accountId) return workspace;
      const ledger = await readWorkspaceIndex(rootHandle, prefix, accountId);
      workspace = ledger;
      workspacePrefix = prefix;
      workspaceAccountId = accountId;
      // One-time migration of all v0.1.5 and v0.1.5.1 records in this
      // workspace. The YAML header is read from the actual archived file;
      // no API requests or reliance on the file's creation date.
      let imported = 0;
      for (const [key, old] of Object.entries(index.chats)) {
        if (!key.startsWith(accountId + '|') || !old || typeof old.path !== 'string' ||
            !old.path.startsWith(prefix + '/')) continue;
        const id = key.slice(accountId.length + 1);
        if (Object.prototype.hasOwnProperty.call(workspace.chats, id)) continue;
        try {
          ensurePath(old.path);
          const local = await lookupFile(rootHandle, old.path);
          if (!local || !(await matchesChatFile(local.handle, old))) continue;
          const fields = await readChatHeader(await local.handle.getFile());
          if (!fields || fields.conversation_id !== id) continue;
          const oldList = previousListMarker(old.remote_fingerprint, id);
          workspace.chats[id] = {
            conversation_id: id, path: old.path, title: String(fields.title || ''),
            project_id: ChatArchivePaths.isProject(oldList?.project_id)?ChatArchivePaths.canonical(oldList.project_id):projectFromHeader(fields),
            gpt_id: ChatArchivePaths.gptId(fields.container_id||oldList?.project_id),
            gpt_name: fields.gpt||null,
            updated: fields.updated, updated_ms: chatTimestamp(fields.updated),
            exported: fields.exported || null,
            listed_updated_ms: oldList?.updated_ms ?? null,
            sha256: old.sha256, bytes: old.bytes,
            saved_at: old.saved_at || null,
            migrated_from: 'cae.vault-index.v1'
          };
          imported++;
        } catch (_e) { /* A corrupt legacy record is preserved, never overwritten. */ }
      }
      if (imported) await writeWorkspaceIndex(rootHandle, workspacePrefix, workspace);
      return workspace;
    }
    function assertChatWorkspace(item, key, path) {
      if (!workspace || !workspaceAccountId) throw new Error('Workspace chat index must be opened before exporting.');
      if (key !== `${workspaceAccountId}|${item.id}`) throw new Error('Chat/account mismatch.');
      ensurePath(path);
      if (!path.startsWith(workspacePrefix + '/')) throw new Error('Chat path is outside the active workspace.');
    }
    async function decideChat(item, { key, path }) {
      if (typeof key !== 'string' || !key || !item?.id) throw new Error('Invalid chat identity.');
      assertChatWorkspace(item, key, path);
      const previous = workspace.chats[item.id];
      if (!previous) {
        const old = index.chats[key];
        if (old && old.path && await lookupFile(rootHandle, old.path))
          return { action: 'skip', status: 'conflict', reason: 'Legacy chat could not be verified; preserved without overwrite.', path: old.path };
        if (await lookupFile(rootHandle, path)) return { action: 'skip', status: 'skipped',
          reason: 'Existing untracked chat; not overwritten.', path };
        return { action: 'fetch' };
      }
      ensurePath(previous.path);
      if (!previous.path.startsWith(workspacePrefix + '/')) throw new Error('Indexed chat path is outside the active workspace.');
      const local = await lookupFile(rootHandle, previous.path);
      if (!local) return { action: 'fetch' }; // User deleted the local file.
      if (!(await matchesChatFile(local.handle, previous))) return { action: 'skip',
        status: 'conflict', reason: 'Local chat was edited; never overwrite.', path: previous.path };
      const listed = chatTimestamp(item.updated);
      if (listed === null) return { action: 'fetch' }; // List has no usable remote version.
      const idMatches = String(item.title || '') === previous.title &&
        ChatArchivePaths.canonical(item.projectId || '') === ChatArchivePaths.canonical(previous.project_id || '') &&
        (typeof item.archived!=='boolean'||Boolean(item.archived)===Boolean(previous.archived)) &&
        (!item.gptId||ChatArchivePaths.gptId(item.gptId)===ChatArchivePaths.gptId(previous.gpt_id)) &&
        (!item.gptName||String(item.gptName)===String(previous.gpt_name||''));
      // A confirmed previous list marker is reusable across sessions. For
      // migrated chats with no marker, compare the list against YAML updated.
      // A list older than the saved revision cannot establish a newer version.
      const sameVersion = previous.listed_updated_ms === listed ||
        (previous.updated_ms !== null && previous.updated_ms !== undefined && listed <= previous.updated_ms);
      if (idMatches && sameVersion) {
        if (previous.listed_updated_ms !== listed)
          await recordWorkspaceChat(item.id, { ...previous, listed_updated_ms: listed });
        return { action: 'skip', status: 'skipped', reason: 'Archived version matches workspace index.', path: previous.path };
      }
      return { action: 'fetch' };
    }
    async function writeText(path, text, { kind, key, remoteChat = null, recovery = false }) {
      if (!['chats', 'metadata'].includes(kind) || typeof key !== 'string' || !key)
        throw new Error('Invalid Vault text record identity.');
      ensurePath(path);
      if (kind === 'chats') {
        const id = key.slice(workspaceAccountId.length + 1);
        if (!workspace || key !== `${workspaceAccountId}|${id}` || !id)
          throw new Error('Workspace chat index must be opened before writing.');
        if (!path.startsWith(workspacePrefix + '/')) throw new Error('Chat path is outside the active workspace.');
        const previous = workspace.chats[id];
        const target = previous?.path || path;
        ensurePath(target);
        const incoming = encoder.encode(text);
        const hash = ChatArchiveHash.hex(incoming);
        const fields = await readChatHeader(new Blob([incoming]));
        if (!fields || fields.conversation_id !== id) throw new Error('Generated Markdown has an invalid conversation header.');
        const existing = await lookupFile(rootHandle, target);
        // A browser shutdown can occur after the file swap but before the
        // workspace index commit. ONLY a separately staged, verified Markdown
        // capture may adopt an identical orphaned file during recovery.
        const sameIncoming = recovery && existing &&
          (await existing.handle.getFile()).size === incoming.byteLength &&
          (await digestStream(await existing.handle.getFile())) === hash;
        if (existing && !previous && !sameIncoming)
          return { status: 'conflict', reason: 'Existing untracked chat; not overwritten.', path: target };
        if (existing && previous && !(await matchesChatFile(existing.handle, previous)) && !sameIncoming)
          return { status: 'conflict', reason: 'Local file differs from last export; preserved.', path: target };
        const version = {
          conversation_id: id, path: target, title: String(fields.title || ''),
          project_id: remoteChat&&Object.prototype.hasOwnProperty.call(remoteChat,'projectId')?
            (ChatArchivePaths.isProject(remoteChat.projectId)?ChatArchivePaths.canonical(remoteChat.projectId):''):
            (typeof fields.project_id==='string'?ChatArchivePaths.canonical(fields.project_id):projectFromHeader(fields)),
          archived:typeof remoteChat?.archived==='boolean'?remoteChat.archived:fields.archived===true,
          gpt_id: ChatArchivePaths.gptId(remoteChat?.gptId||fields.container_id),
          gpt_name: remoteChat?.gptName||fields.gpt||null,
          updated: fields.updated, updated_ms: chatTimestamp(fields.updated),
          exported: fields.exported || null,
          listed_updated_ms: chatTimestamp(remoteChat?.updated),
          sha256: hash, bytes: incoming.byteLength,
          saved_at: new Date().toISOString(),
          created: fields.created || null
        };
        if (sameIncoming) {
          if (!previous || previous.sha256 !== hash || previous.listed_updated_ms !== version.listed_updated_ms)
            await recordWorkspaceChat(id, { ...version, saved_at: previous?.saved_at || version.saved_at });
          return { status: 'recovered', reason: 'Verified existing file and recovered its workspace index.', path: target, sha256: hash };
        }
        if (existing && previous.sha256 === hash) {
          if (JSON.stringify(version) !== JSON.stringify({ ...previous, saved_at: version.saved_at }))
            await recordWorkspaceChat(id, { ...version, saved_at: previous.saved_at });
          return { status: 'skipped', reason: 'Unchanged.', path: target };
        }
        await writeFile(rootHandle, target, incoming);
        await recordWorkspaceChat(id, version);
        return { status: 'saved', path: target, sha256: hash };
      }
      const indexed = index[kind][key];
      const target = indexed?.path || path;
      ensurePath(target);
      const incoming = encoder.encode(text);
      const hash = ChatArchiveHash.hex(incoming);
      const existing = await lookupFile(rootHandle, target);
      // Only an independently staged manual payload can request recovery.
      // Adopt an identical interrupted file, never unrelated user modifications.
      if (recovery && existing && (await existing.handle.getFile()).size === incoming.byteLength &&
          (await digestStream(await existing.handle.getFile())) === hash) {
        if (!indexed || indexed.sha256 !== hash)
          await record(kind, key, {path:target,sha256:hash,bytes:incoming.byteLength,saved_at:new Date().toISOString()});
        return {status:'recovered',path:target,sha256:hash};
      }
      if (existing && !indexed) return { status: 'skipped', reason: 'Existing untracked file; not overwritten.', path: target };
      if (existing && !(await matchesFile(existing.handle, indexed)))
        return { status: 'conflict', reason: 'Local file differs from last recorded export; preserved.', path: target };
      if (existing && indexed.sha256 === hash) return { status: 'skipped', reason: 'Unchanged.', path: target };
      const handle = await writeFile(rootHandle, target, incoming);
      const file = await handle.getFile();
      await record(kind, key, { path: target, sha256: hash, bytes: file.size,
        local_last_modified: file.lastModified, saved_at: new Date().toISOString() });
      return { status: 'saved', path: target, sha256: hash };
    }
    async function forgetPendingSource(key, oldRecord = null) {
      const pending = index.sources[key];
      if (!pending?.pending) return;
      if (oldRecord) return record('sources', key, oldRecord);
      delete index.sources[key];
      try { await saveIndex(rootHandle, index); }
      catch (e) { index.sources[key] = pending; throw e; }
    }
    async function decideSource(job, accountId) {
      if (!workspace || workspaceAccountId !== accountId ||
          !validPath(job?.path) || !job.path.startsWith(workspacePrefix + '/'))
        throw new Error('Source identity/path is outside the verified active workspace.');
      const key = keyFor(accountId, job);
      let previous = index.sources[key];
      const remote = sourceFingerprint(job);
      if(previous?.path && (!validPath(previous.path)||!previous.path.startsWith(workspacePrefix+'/')))
        return {action:'skip',status:'conflict',key,path:previous.path,
          reason:'Existing Source index path is outside the workspace; preserved without access.'};
      if (previous?.pending) {
        if (remote !== previous.remote_fingerprint) return { action: 'skip', status: 'conflict', key, path: previous.path,
          reason: 'Interrupted Source metadata changed; pending file preserved for manual recovery.' };
        let existing;
        try { existing = await lookupFile(rootHandle, previous.path); }
        catch (_e) { return { action: 'skip', status: 'conflict', key, path: previous.path,
          reason: 'Interrupted Source path cannot be verified; manual recovery required.' }; }
        if (existing && Number.isSafeInteger(previous.bytes) && /^[a-f0-9]{64}$/i.test(previous.sha256 || '')) {
          const f = await existing.handle.getFile();
          if (f.size === previous.bytes && await digestStream(f) === previous.sha256) {
            await record('sources', key, { ...previous, pending: false, ready_to_commit: false,
              local_last_modified: f.lastModified, saved_at: new Date().toISOString() });
            return { action: 'skip', status: 'skipped', key, path: previous.path,
              sha256: previous.sha256, downloadedBytes: previous.bytes,
              reason: 'Completed original verified; interrupted index commit recovered.' };
          }
        }
        // A missing pending file is safe to retry. An existing unverified file
        // must be preserved, not silently overwritten or duplicated.
        if (existing) return { action: 'skip', status: 'conflict', key, path: previous.path,
          reason: 'Interrupted Source bytes cannot be verified; no retry until manually resolved.' };
        await forgetPendingSource(key);
        previous = null;
      }
      if (previous?.deleted_at) return {action:'skip', status:'changed', key, path:previous.path, reason:'Source reappeared; preserved copy is in deleted/. Restore manually for now.'};
      if (previous) {
        ensurePath(previous.path);
        let existing;
        try { existing = await lookupFile(rootHandle, previous.path); }
        catch (e) {
          if (forbiddenName(e))return {action:'skip',status:'conflict',key,path:previous.path,
            reason:'A previously archived filename is rejected by this browser; the existing index and file are preserved for manual recovery.'};
          throw e;
        }
        if (existing) {
          if (!(await matchesFile(existing.handle, previous)))
            return { action: 'skip', reason: 'Local source was modified; never overwrite.', status: 'conflict', key, path: previous.path };
          if (remote !== previous.remote_fingerprint)
            return { action: 'skip', reason: 'Remote metadata changed; update deferred to a future revision.', status: 'changed', key, path: previous.path };
          return { action: 'skip', reason: 'Already archived and unchanged.', status: 'skipped', key, path: previous.path,
            sha256: previous.sha256, downloadedBytes: previous.bytes };
        }
        // User removed the previously archived file: re-download safely.
        return { action: 'download', key, path: previous.path, remote,
          replacingMissing: true, prior_record: structuredClone(previous) };
      }
      const path = await selectUnusedPath(rootHandle, job.path, job.fileId);
      return { action: 'download', key, path, remote, replacingMissing: false, prior_record: null };
    }
    async function beginSource(decision, job = null) {
      if (decision.action !== 'download') throw new Error('Source was not scheduled for download.');
      if (!workspace || !validPath(decision.path) || !decision.path.startsWith(workspacePrefix + '/'))
        throw new Error('Source destination is outside the verified active workspace.');
      if (await lookupFile(rootHandle, decision.path)) throw new Error('Source target appeared during export; it will not be overwritten.');
      for (let attempt = 0; attempt < 2; attempt++) {
        const { dir, filename } = await parentDirectory(rootHandle, decision.path, true);
        let handle;
        try {
          handle = await dir.getFileHandle(filename, { create: true });
          const stream = await handle.createWritable();
          const target = { handle, stream, dir, filename, fresh: true, decision };
          try {
            await record('sources', decision.key, {
              pending: true, project_id: job?.projectId || null, file_id: job?.fileId || null,
              name: job?.name || filename, original_filename: job?.name || filename,
              stored_filename: filename, filename_aliased: Boolean(decision.filename_alias_from) || filename !== (job?.name || filename),
              category: job?.category || null, path: decision.path,
              source_identity: job?.sourceIdentity || null, attached_at: job?.attachedAt || null,
              remote_fingerprint: decision.remote, staged_at: new Date().toISOString()
            });
          } catch (e) { await abortSource(target); throw e; }
          return target;
        } catch (e) {
          if (handle) {
            try { if ((await handle.getFile()).size === 0) await dir.removeEntry(filename); } catch {}
          }
          if (attempt === 0 && forbiddenName(e)) {
            const original = decision.path;
            decision.path = await selectUnusedPath(rootHandle, safeSourceFallback(original), decision.key);
            decision.filename_alias_from = original.split('/').at(-1);
            continue;
          }
          throw forbiddenName(e) ? unsupportedNameError() : e;
        }
      }
    }
    async function abortSource(target) {
      if (!target) return;
      try { await target.stream.abort(); } catch {}
      // A new empty placeholder may remain if createWritable aborts. Never
      // delete files with data or a file we cannot positively identify as empty.
      let safelyEmpty = false;
      if (target.fresh) {
        try {
          const file = await target.handle.getFile();
          if (file.size === 0) { await target.dir.removeEntry(target.filename); safelyEmpty = true; }
        } catch (e) { if (isMissing(e)) safelyEmpty = true; }
      }
      if (safelyEmpty && target.decision)
        await forgetPendingSource(target.decision.key, target.decision.prior_record);
    }
    async function stageSourceCommit(job, decision, sha256, bytes) {
      const pending = index.sources[decision.key];
      if (!pending?.pending || pending.path !== decision.path ||
        !/^[a-f0-9]{64}$/i.test(sha256 || '') || !Number.isSafeInteger(bytes) || bytes < 0)
        throw new Error('Invalid Source commit recovery checkpoint.');
      await record('sources', decision.key, { ...pending,
        project_id: job?.projectId || pending.project_id, file_id: job?.fileId || pending.file_id,
        sha256, bytes, ready_to_commit: true });
    }
    async function completeSource(job, decision, target, sha256, bytes) {
      const file = await target.handle.getFile();
      if (!Number.isSafeInteger(bytes) || bytes < 0 || file.size !== bytes ||
          !/^[a-f0-9]{64}$/i.test(sha256 || '') || await digestStream(file) !== sha256)
        throw new Error('Source on-disk size or SHA-256 did not match streamed bytes; pending recovery entry preserved.');
      await record('sources', decision.key, {
        project_id: job.projectId, file_id: job.fileId,
        name: job.name, original_filename: job.name, stored_filename: decision.path.split('/').at(-1),
        filename_aliased: !!decision.filename_alias_from || decision.path.split('/').at(-1) !== job.name,
        category: job.category, path: decision.path,
        source_identity: job.sourceIdentity || null, attached_at: job.attachedAt || null,
        remote_fingerprint: decision.remote, sha256, bytes,
        local_last_modified: file.lastModified,
        saved_at: new Date().toISOString()
      });
      return file;
    }
    async function knownProjects(prefix, accountId) {
      const result = new Map();
      for (const [key, rec] of Object.entries(index.metadata)) {
        if (!key.startsWith(accountId + '|') || !rec?.path?.startsWith(prefix + '/') || !rec.path.endsWith('/_project.md')) continue;
        const local = await lookupFile(rootHandle, rec.path);
        if (!local) continue;
        const header = await (await local.handle.getFile()).slice(0, 32768).text();
        const match = /^project_id: (.+)$/m.exec(header);
        let id; try { id = JSON.parse(match?.[1] || 'null'); } catch { continue; }
        if (!id) id = /^\| Project ID \| `([^`]+)` \|/m.exec(header)?.[1] || null;
        if (typeof id !== 'string' || !/^g-p-[a-z0-9-]+$/i.test(id)) continue;
        result.set(id, { id, path: rec.path.slice(0, -12), name: rec.path.split('/').at(-2) });
      }
      for (const [key, rec] of Object.entries(index.sources)) {
        if (!key.startsWith(accountId + '|') || !rec?.path?.startsWith(prefix + '/') || !rec.project_id) continue;
        if (!result.has(rec.project_id)) {
          const dir = rec.path.split('/Sources/')[0].split('/deleted/')[0];
          result.set(rec.project_id, { id: rec.project_id, path: dir, name: dir.split('/').at(-1) });
        }
      }
      return [...result.values()];
    }
    async function quarantineSource(key, at = new Date().toISOString()) {
      const rec = index.sources[key];
      if (!rec || rec.deleted_at) return {status:'skipped'};
      ensurePath(rec.path);
      const original = await lookupFile(rootHandle, rec.path);
      if (!original) return {status:'missing'};
      // Never remove a locally edited source, including same-size / same-mtime edits.
      if ((await digestStream(await original.handle.getFile())) !== rec.sha256)
        return {status:'conflict', reason:'Locally edited source preserved.'};
      const before = rec.path, dir = before.split('/Sources/')[0];
      if (dir === before) return {status:'conflict', reason:'Source path is not a managed Sources path.'};
      const destination = await selectUnusedPath(rootHandle, dir + '/deleted/' + before.split('/').at(-1), rec.file_id);
      const loc = await parentDirectory(rootHandle, destination, true);
      const copy = await loc.dir.getFileHandle(loc.filename, {create:true});
      const stream = await copy.createWritable();
      try { await (await original.handle.getFile()).stream().pipeTo(stream); }
      catch (e) { try { await stream.abort(); } catch {} throw e; }
      const stored = await copy.getFile();
      if (stored.size !== rec.bytes || await digestStream(stored) !== rec.sha256)
        throw new Error('Deleted-source backup verification failed; original was preserved.');
      // Commit a verified copy before removing the original. A crash can leave
      // both copies, never lose the only copy. A later re-add is reported, not overwritten.
      await record('sources', key, {...rec, path:destination, previous_path:before,
        deleted_at:at, local_last_modified:stored.lastModified});
      await original.dir.removeEntry(original.filename);
      return {status:'moved', path:destination};
    }
    return { index, rootHandle, writeText, decideChat, useWorkspace, decideSource, beginSource, abortSource, stageSourceCommit, completeSource,
      knownProjects, quarantineSource,
      getSourceIndex: key => index.sources[key] || null };
  }
  function openDB() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable.'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
      let blocked=false;
      req.onblocked=()=>{blocked=true;reject(Object.assign(new Error('Vault directory database is blocked. Close obsolete extension pages and retry.'),{code:'IDB_BLOCKED'}));};
      req.onsuccess = () => {if(blocked){req.result.close();return;}req.result.onversionchange=()=>req.result.close();resolve(req.result);};
      req.onerror = () => reject(req.error || new Error('Could not open Vault directory settings.'));
    });
  }
  async function transact(mode, work) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        let value;
        const req = work(tx.objectStore(DB_STORE));
        req.onsuccess = () => { value = req.result; };
        req.onerror = () => reject(req.error || new Error('Vault directory settings read/write failed.'));
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('Vault directory settings transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('Vault directory settings transaction aborted.'));
      });
    } finally { db.close(); }
  }
  async function rememberDirectory(handle) { await transact('readwrite', s => s.put(handle, DB_KEY)); }
  async function restoreDirectory() { return (await transact('readonly', s => s.get(DB_KEY))) || null; }
  async function rememberWorkspaceDirectory(accountId, handle) {
    if (!accountId || typeof accountId !== 'string') throw new Error('Workspace ID required.');
    await transact('readwrite', s => s.put(handle, 'workspace-directory:' + accountId));
  }
  async function restoreWorkspaceDirectory(accountId) {
    return (await transact('readonly', s => s.get('workspace-directory:' + accountId))) || null;
  }
  // Browser-held lock survives async waits and is automatically released if
  // a panel or service worker is destroyed. All writers must acquire it first.
  async function acquireLock(ifAvailable = false) {
    if (!globalThis.navigator?.locks) throw new Error('Web Locks unavailable; concurrent Vault writes are unsafe.');
    let release;
    const held = new Promise(resolve => { release = resolve; });
    return new Promise((resolve, reject) => {
      navigator.locks.request('cae-vault-writer', {mode:'exclusive', ifAvailable}, async lock => {
        if (!lock) { resolve(null); return; }
        resolve(release);
        await held;
      }).catch(reject);
    });
  }
  async function readJson(rootHandle, path) {
    const local = await lookupFile(rootHandle, path);
    if (!local) return null;
    const f = await local.handle.getFile();
    if (f.size > 16 * 1024 * 1024) throw new Error('Service file too large.');
    return JSON.parse(await f.text());
  }
  // Keep permission state distinct from filesystem/IndexedDB errors. Never
  // request permission here: callers can use this from a passive/background check.
  async function permissionState(handle) {
    if (!handle) return {state: 'no_handle'};
    if (typeof handle.queryPermission !== 'function') return {state: 'unsupported'};
    try {
      const state = await handle.queryPermission({mode: 'readwrite'});
      return ['granted', 'prompt', 'denied'].includes(state)
        ? {state} : {state: 'error', errorName: 'InvalidPermissionState'};
    } catch (error) {
      return {state: 'error', errorName: String(error?.name || 'Error').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 60) || 'Error'};
    }
  }
  async function hasPermission(handle, ask = false) {
    const result = await permissionState(handle);
    if (result.state === 'granted') return true;
    if (!ask) return false;
    if (result.state === 'error' || result.state === 'unsupported') {
      const error = new Error('Vault permission check failed: ' + (result.errorName || result.state));
      error.name = result.errorName || 'NotSupportedError';
      throw error;
    }
    if (!handle || typeof handle.requestPermission !== 'function') return false;
    // Only explicit UI actions pass ask=true. No synthetic clicks or automatic
    // permission prompts from focus changes, timers, worker or offscreen.
    return (await handle.requestPermission({mode: 'readwrite'})) === 'granted';
  }
  const api = { INDEX_PATH, WORKSPACE_SCHEMA, validPath, parentDirectory, openStore, digestStream, sourceFingerprint, chatFingerprint, readChatHeader, workspaceIndexPath, resolveWorkspacePrefix,
    rememberDirectory, restoreDirectory, rememberWorkspaceDirectory, restoreWorkspaceDirectory, acquireLock,
    permissionState, hasPermission, readIndex, readJson, writeFile, lookupFile, chatTimestamp, matchesChatFile, keyFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
