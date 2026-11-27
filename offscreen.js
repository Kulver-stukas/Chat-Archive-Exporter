/* Workspace-bound handle holder / bounded Blob access probe.
 * The worker remains the only background writer. Keeping handles alive is an
 * experiment in permission lifetime, NOT a promise or a permission bypass.
 * No timers, permission requests, network calls or captured chat/file bodies.
 */
(() => {
  'use strict';
  const retained = new Map();
  const instance = (globalThis.crypto?.randomUUID?.() || String(Date.now()));
  let serial = Promise.resolve();
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{3,120}$/.test(id);
  const safeName = e => String(e?.name || 'Error').replace(/[^a-zA-Z0-9_]/g, '').slice(0,60) || 'Error';

  async function check(accountId, refresh = false) {
    if (!validId(accountId)) throw new TypeError('Invalid workspace ID.');
    let entry = retained.get(accountId);
    if (!entry || refresh) {
      // Hold the old handle until a replacement has been loaded successfully.
      let dir;
      try { dir = await ChatArchiveVault.restoreWorkspaceDirectory(accountId); }
      catch (error) {
        return {accountId, available:false, permission:'error', errorName:safeName(error),
          stage:'restore', retained:!!entry, holderInstance:instance, retainedCount:retained.size};
      }
      if (!dir) {
        retained.delete(accountId);
        return {accountId, available:false, permission:'no_handle', retained:false,
          holderInstance:instance, retainedCount:retained.size};
      }
      if (!entry && retained.size >= 100) throw new Error('Too many retained Vault bindings.');
      entry = {dir, retainedAt:new Date().toISOString(), indexProbed:false};
      retained.set(accountId, entry);
    }
    const result = await ChatArchiveVault.permissionState(entry.dir);
    const previous = entry.permission;
    entry.permission = result.state;
    const out = {accountId, available:result.state==='granted', permission:result.state,
      retained:true, retainedAt:entry.retainedAt, checkedAt:new Date().toISOString(),
      holderInstance:instance, retainedCount:retained.size, errorName:result.errorName || null};
    if (result.state === 'granted' && (!entry.indexProbed || refresh || previous !== 'granted')) {
      try {
        const within=(p)=>ChatArchiveVault.deadline?ChatArchiveVault.deadline(p,4000,'Offscreen index probe'):p;
        const item = await within(ChatArchiveVault.lookupFile(entry.dir, ChatArchiveVault.INDEX_PATH));
        entry.hasIndex = !!item;
        if (item) {
          const file = await within(item.handle.getFile());
          // A real, bounded Blob read. Do not retain Blob/index contents in RAM.
          await within(file.slice(0,32).arrayBuffer());
        }
        entry.indexProbed = true;
        entry.indexError = null;
      } catch (error) {
        entry.indexProbed = false;
        entry.indexError = safeName(error);
      }
    }
    out.hasIndex = entry.hasIndex ?? null;
    out.indexError = result.state==='granted' ? (entry.indexError || null) : null;
    if (out.indexError) out.available = false;
    return out;
  }

  async function handle(msg) {
    if (msg.type === 'CAE_VAULT_CONTEXT_CHECK') return check(msg.accountId, !!msg.refresh);
    if (msg.type === 'CAE_VAULT_CONTEXT_RELEASE') {
      if (!validId(msg.accountId)) throw new TypeError('Invalid workspace ID.');
      retained.delete(msg.accountId);
      return {released:true, retainedCount:retained.size};
    }
    if (msg.type === 'CAE_VAULT_CONTEXT_RECONCILE') {
      if (!Array.isArray(msg.accountIds) || msg.accountIds.length>100 || !msg.accountIds.every(validId))
        throw new TypeError('Invalid enabled workspace list.');
      const ids = new Set(msg.accountIds);
      for (const key of retained.keys()) if (!ids.has(key)) retained.delete(key);
      const results=[];
      for (const id of ids) results.push(await check(id));
      return {results, holderInstance:instance, retainedCount:retained.size};
    }
    throw new TypeError('Unknown Vault context message.');
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.target !== 'cae-vault-context' || sender.id !== chrome.runtime.id || sender.tab ||
        !['CAE_VAULT_CONTEXT_CHECK','CAE_VAULT_CONTEXT_RELEASE','CAE_VAULT_CONTEXT_RECONCILE'].includes(msg.type)) return false;
    const run=serial.catch(()=>{}).then(()=>handle(msg));
    serial=run.catch(()=>{});
    run.then(result=>sendResponse({ok:true,result}),error=>sendResponse({ok:false,
      error:'Vault context operation failed.', errorName:safeName(error)}));
    return true;
  });
})();
