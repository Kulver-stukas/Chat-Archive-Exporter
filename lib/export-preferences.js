/* Browser-profile export choices. Field patches are serialized in the worker
 * so two open popup/panel instances do not overwrite each other's settings. */
(function(root){
  'use strict';
  const KEY='cae.export.preferences.v1';
  let writes=Promise.resolve();
  function queue(work){const operation=writes.catch(()=>{}).then(work);writes=operation.catch(()=>{});return operation;}
  async function read(){const saved=await chrome.storage.local.get(KEY),raw=saved[KEY];return {
    ...root.ChatArchiveExportSelection.preferences(raw),
    _revision:Number.isSafeInteger(raw?._revision)&&raw._revision>=0?raw._revision:0};}
  function get(){return queue(read);}
  function patch(changes){return queue(async()=>{
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Invalid export preferences.');
    const allowed=new Set(Object.keys(root.ChatArchiveExportSelection.DEFAULTS));
    for(const [key,value] of Object.entries(changes))if(!allowed.has(key)||typeof value!=='boolean')
      throw Error('Invalid export preference: '+key);
    const current=await read(),next={...current,...changes,_revision:current._revision+1};
    await chrome.storage.local.set({[KEY]:next});return next;
  });}
  root.ChatArchiveExportPreferences={KEY,get,patch};
})(globalThis);
