/* Bounded, allowlisted permission timeline, independent of Vault write access.
 * No chat text, file paths/names, tokens, signed URLs or arbitrary errors.
 * Export aliases workspace IDs. Diagnostics never request access or change sync.
 */
(function(root){
  'use strict';
  const KEY='cae.vault-permission-log.v1', LIMIT=240;
  const states=new Set(['granted','prompt','denied','no_handle','error','unsupported','unknown']);
  const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(id);
  const word=x=>String(x||'').replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,70);
  let serial=Promise.resolve(),last=new Map();
  function append(accountId,event,values={}) {
    if(!validId(accountId))return Promise.resolve();
    const row={at:new Date().toISOString(),accountId,event:word(event),version:word(chrome.runtime.getManifest?.().version||'unknown')};
    for(const key of ['panel','worker','offscreen'])if(states.has(values[key]))row[key]=values[key];
    for(const key of ['retained','userActivation','holderChanged'])if(typeof values[key]==='boolean')row[key]=values[key];
    for(const key of ['stage','errorName','workerErrorName','offscreenErrorName','panelErrorName','version','indexError','contextError','holderInstance'])if(values[key])row[key]=word(values[key]);
    if(Array.isArray(values.contexts))row.contexts=[...new Set(values.contexts.map(word))].sort().slice(0,10);
    if(Number.isSafeInteger(values.retainedCount))row.retainedCount=values.retainedCount;
    const sig=JSON.stringify({...row,at:null}),prev=last.get(accountId+'|'+row.event);
    if(prev?.sig===sig && Date.now()-prev.at<15000)return Promise.resolve();
    last.set(accountId+'|'+row.event,{sig,at:Date.now()});
    if(last.size>500)last.delete(last.keys().next().value);
    const p=serial.catch(()=>{}).then(async()=>{
      const data=(await chrome.storage.local.get(KEY))[KEY];
      const rows=Array.isArray(data?.events)?data.events.slice(-LIMIT+1):[];
      rows.push(row);await chrome.storage.local.set({[KEY]:{schema:KEY,events:rows}});
    });
    serial=p.catch(()=>{});return p;
  }
  async function contexts() {
    if(!chrome.runtime.getContexts)return [];
    try {const request=chrome.runtime.getContexts({});const rows=await (root.ChatArchiveVault?.deadline?root.ChatArchiveVault.deadline(request,2500,'Context diagnostics'):request);return [...new Set(rows.map(c=>c.contextType).filter(Boolean))].sort();}
    catch {return [];}
  }
  async function report() {
    // Read the last committed log, never wait for a live probe or an append.
    const data=(await chrome.storage.local.get(KEY))[KEY];
    const aliases=new Map();
    function alias(id){if(!aliases.has(id))aliases.set(id,'workspace_'+(aliases.size+1));return aliases.get(id);}
    const events=(data?.events||[]).slice(-LIMIT).map(r=>{
      // Re-allowlist persisted values too; do not export arbitrary injected keys.
      const out={at:r.at,workspace:alias(r.accountId),event:word(r.event)};
      for(const k of ['panel','worker','offscreen'])if(states.has(r[k]))out[k]=r[k];
      for(const k of ['retained','userActivation','holderChanged'])if(typeof r[k]==='boolean')out[k]=r[k];
      for(const k of ['stage','errorName','workerErrorName','offscreenErrorName','panelErrorName','version','indexError','contextError','holderInstance'])if(r[k])out[k]=word(r[k]);
      if(Array.isArray(r.contexts))out.contexts=r.contexts.map(word).slice(0,10);
      if(Number.isSafeInteger(r.retainedCount))out.retainedCount=r.retainedCount;
      return out;
    });
    return {schema:KEY,extensionVersion:chrome.runtime.getManifest?.().version||'unknown',
      exportedAt:new Date().toISOString(),limit:LIMIT,contexts:await contexts(),events,
      note:'Permission observations only. Workspace IDs are aliased. No chat bodies, tokens, file paths or file contents. Retained handles do not guarantee persistent permission.'};
  }
  root.ChatArchiveVaultDiagnostics={KEY,LIMIT,append,contexts,report};
})(globalThis);
