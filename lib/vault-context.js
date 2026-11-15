/* Serial lifecycle + workspace-bound resident handles. Only opted-in workspaces
 * call this module. No permissions are requested and no keepalive timers exist. */
(function(root){
  'use strict';
  const PATH='offscreen.html';
  let creating=null, operations=Promise.resolve();
  async function exists() {
    if (!chrome.runtime.getContexts) return false;
    return (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],
      documentUrls:[chrome.runtime.getURL(PATH)]})).length>0;
  }
  async function ensure() {
    if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts) return false;
    if (creating) return creating;
    const p=(async()=>{
      if(await exists())return true;
      try { await chrome.offscreen.createDocument({url:PATH,reasons:['BLOBS'],
        justification:'Create bounded archive Blob URLs for explicit exports; retain selected directory handles and validate Vault indexes with bounded Blob reads while archiving is enabled.'}); }
      catch(error){if(!(await exists()))throw error;}
      return true;
    })().finally(()=>{if(creating===p)creating=null;});
    creating=p;return p;
  }
  function serial(fn) {
    const p=operations.catch(()=>{}).then(fn);
    operations=p.catch(()=>{});return p;
  }
  async function send(type, args={}) {
    const response=await chrome.runtime.sendMessage({target:'cae-vault-context',type,...args});
    if(!response?.ok)throw new Error(response?.errorName || 'Vault context unavailable.');
    return response.result;
  }
  function check(accountId, options={}) {
    return serial(async()=>{
      if(!(await ensure()))return {available:false,permission:'unsupported',retained:false};
      return send('CAE_VAULT_CONTEXT_CHECK',{accountId,refresh:!!options.refresh});
    });
  }
  function reconcile(accountIds) {
    return serial(async()=>{
      if(!accountIds.length){
        if(creating)await creating.catch(()=>{});
        // Manual jobs can own pending Blob URLs or a live Vault handle while
        // automatic synchronization is off. Do not destroy their document.
        if(root.ChatArchiveManualJobs?.hasActive && await root.ChatArchiveManualJobs.hasActive()){
          await ensure();
          // Release automatic-sync bindings, but keep separately owned manual
          // handles/Blob URLs in this same offscreen document.
          const result=await send('CAE_VAULT_CONTEXT_RECONCILE',{accountIds:[]});
          return {...result,manualJobActive:true};
        }
        if(chrome.offscreen?.closeDocument&&await exists())await chrome.offscreen.closeDocument();
        return {results:[],retainedCount:0};
      }
      if(!(await ensure()))return {results:[],permission:'unsupported'};
      return send('CAE_VAULT_CONTEXT_RECONCILE',{accountIds});
    });
  }
  function release(accountId) {
    return serial(async()=>{
      if(!(await exists()))return {released:true,retainedCount:0};
      return send('CAE_VAULT_CONTEXT_RELEASE',{accountId});
    });
  }
  function close() {return reconcile([]);}
  root.ChatArchiveVaultContext={ensure,check,reconcile,release,close,exists};
})(globalThis);
