/* ChatGPT storage policy. Preserve legacy paths, keys and schemas exactly.
 * All old-format writes still conflict on the shared provider index. */
(function(root){
  'use strict';
  const providerId='chatgpt',folderName='ChatGPT',controlFolder='.chat-archive';
  const validAccount=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(id);
  const validPrefix=p=>typeof p==='string'&&/^ChatGPT\/[^/\\]+$/.test(p)&&p.toLowerCase()!=='chatgpt/.chat-archive';
  const indexPath=folderName+'/'+controlFolder+'/index.json';
  const claimDir=folderName+'/'+controlFolder+'/writers';
  const workspaceSchema='cae.workspace-chats.v1',indexSchema='cae.vault-index.v1';
  function resourcePath(prefix,kind){
    if(!validPrefix(prefix))throw Error('Invalid workspace folder.');
    const names={chats:'.workspace.json',sync:'.sync.json',preferences:'.preferences.json',configuration:'_workspace_configuration.json',personalization:'_personalization.md',library:'_Library/_inventory.json',libraryReport:'_Library/_download_report.json',manualActivity:'.activity-manual.json',libraryActivity:'.activity-library.json'};
    if(!Object.hasOwn(names,kind))throw Error('Unknown workspace resource.');return prefix+'/'+names[kind];
  }
  function resourceKeys(account,operation){
    const R=root.CAEResources||(typeof require==='function'?require('../../contracts/resources.js'):null);
    if(!R)throw Error('Resource contract unavailable.');
    const keys=[R.key(providerId,null,'index','legacy-global')];
    if(validAccount(account))keys.push(R.key(providerId,account,'workspace_tree','archive'));
    else keys.push(R.key(providerId,null,'provider_tree','archive'));
    return keys;
  }
  const canonical = id => String(id || '').match(/^g-p-[a-f0-9]{32}(?=-|$)/i)?.[0] || String(id || '');
  const isProject = id => /^g-p-[a-f0-9]{32}$/i.test(canonical(id));
  const isGPT = id => /^g-(?!p-)[a-z0-9_-]{6,128}$/i.test(String(id || ''));
  const gptId = id => isGPT(id) ? String(id) : '';
  function gptLabel(id, name) {
    const value=String(name||'').trim();
    return value || ('GPT ['+String(id).slice(-10)+']');
  }
  function createLayout(safe,workspaceName, projects = [], existingPrefix = null) {
    // existingPrefix is a previously verified Vault folder, never remote text.
    if(existingPrefix!==null&&(!validPrefix(existingPrefix)||(root.ChatArchiveVault&&!root.ChatArchiveVault.validPath(existingPrefix+'/.workspace.json'))))throw Error('Invalid existing workspace folder.');
    const prefix = existingPrefix || (folderName + '/' + safe(workspaceName || 'Current workspace'));
    const groups = new Map();
    const used = new Set(['_unassigned']);
    // Sort by ID, not selection order, for repeatable collision resolution.
    const sorted = [...projects].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    function folder(id, name) {
      id = canonical(id);
      if (!id) return '_Unassigned';
      if (groups.has(id)) return groups.get(id);
      const base = safe(name || `Project_${id.slice(-12)}`);
      let value = base;
      if (used.has(value.toLowerCase())) value = `${base} [${safe(id.slice(-12), 12)}]`;
      let count = 2;
      while (used.has(value.toLowerCase())) value = `${base} [${safe(id.slice(-12), 12)}-${count++}]`;
      groups.set(id, value); used.add(value.toLowerCase()); return value;
    }
    for (const p of sorted) if (p.id) folder(p.id, p.name);
    const projectPath = (id, name) => `${prefix}/${folder(id, name)}`;
    const gptPath = (id, name) => `${prefix}/_GPTs/${safe(gptLabel(id,name),75)} [${safe(String(id).slice(-12),12)}]`;
    return { prefix, folder, projectPath, gptPath, chatPath(item) {
      const base=gptId(item.gptId) ? gptPath(item.gptId,item.gptName) : projectPath(item.projectId,item.project);
      return `${base}/${safe(item.title || 'Untitled chat', 100)} [${safe(item.id, 80)}].md`;
    }};
  }
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
      title: String(chat.title || ''), project_id: canonical(chat.projectId || ''),
      archived:Boolean(chat.archived),gpt_id:gptId(chat.gptId||''),
      gpt_name:String(chat.gptName||'') });
  }
  function projectFromHeader(fields) {
    const match = String(fields?.source || '').match(/\/g\/(g-p-[a-f0-9]{32})(?:[-/]|$)/i);
    return match ? canonical(match[1]) : '';
  }
  function sameChatRevision(item,previous){
    const listed=chatTimestamp(item?.updated);
    if(!previous||listed===null)return false;
    return String(item.title||'')===previous.title&&canonical(item.projectId||'')===canonical(previous.project_id||'')&&
      (typeof item.archived!=='boolean'||Boolean(item.archived)===Boolean(previous.archived))&&
      (!item.gptId||gptId(item.gptId)===gptId(previous.gpt_id))&&
      (!item.gptName||String(item.gptName)===String(previous.gpt_name||''))&&
      (previous.listed_updated_ms===listed||(previous.updated_ms!==null&&previous.updated_ms!==undefined&&listed<=previous.updated_ms));
  }
  const api=Object.freeze({providerId,folderName,controlFolder,validAccount,validPrefix,indexPath,claimDir,workspaceSchema,indexSchema,
    resourcePath,resourceKeys,canonical,isProject,isGPT,gptId,gptLabel,createLayout,chatTimestamp,chatFingerprint,projectFromHeader,sameChatRevision});
  root.ChatArchiveStorageProfile=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
