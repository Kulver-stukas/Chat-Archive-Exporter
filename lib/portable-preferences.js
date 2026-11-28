/* Portable settings only; never copy permissions, jobs or browser state. */
(function(root){
'use strict';
const V=()=>root.ChatArchiveVault, schema='cae.workspace-preferences.v1';
const bool=(x,k)=>typeof x?.[k]==='boolean';
function clean(raw,account){
  if(!raw||raw.schema!==schema||raw.account_id!==account)throw Error('Invalid workspace preferences.');
  const out={schema,account_id:account};
  if(raw.chat&&bool(raw.chat,'enabled')&&['active','workspace'].includes(raw.chat.scope)&&['tracked','tracked_and_new'].includes(raw.chat.enrollment)&&bool(raw.chat,'sources'))out.chat={enabled:raw.chat.enabled,scope:raw.chat.scope,enrollment:raw.chat.enrollment,sources:raw.chat.enabled&&raw.chat.sources};
  if(raw.library&&bool(raw.library,'enabled')&&bool(raw.library,'monitorOnStart'))out.library={enabled:raw.library.enabled,monitorOnStart:raw.library.monitorOnStart};
  if(raw.export&&Object.keys(root.ChatArchiveExportSelection.DEFAULTS).every(k=>bool(raw.export,k)))out.export=root.ChatArchiveExportSelection.preferences(raw.export);
  return out;
}
async function read(dir,account,display){
  const v=V(),prefix=await v.resolveWorkspacePrefix(dir,root.ChatArchivePaths.createLayout(display).prefix,account);
  const raw=await v.readJson(dir,root.ChatArchiveStorageProfile.resourcePath(prefix,'preferences'));
  const out=raw?clean(raw,account):{schema,account_id:account};
  const disk=await v.readJson(dir,root.ChatArchiveStorageProfile.resourcePath(prefix,'sync'));
  if(disk&&disk.schema==='cae.background-config.v1'&&disk.account_id===account){
    const chat=clean({schema,account_id:account,chat:disk},account).chat;if(chat)out.chat=chat;
  }
  const inventory=await v.readJson(dir,root.ChatArchiveStorageProfile.resourcePath(prefix,'library'));
  const hasInventory=inventory?.schema==='cae.library-vault.v1'&&inventory.account_id===account&&Array.isArray(inventory.catalog?.items)&&Number.isFinite(Date.parse(inventory.baseline_at));
  return {...out,hasInventory:!!hasInventory};
}
async function write(dir,account,display,patch){
  const v=V(),release=await v.acquireLock();let shared;
  try{
    shared=await v.acquireVaultGuard(dir,release,{workspaceId:account,operation:'preferences'});
    const prefix=await v.resolveWorkspacePrefix(dir,root.ChatArchivePaths.createLayout(display).prefix,account);
    const prior=await v.readJson(dir,root.ChatArchiveStorageProfile.resourcePath(prefix,'preferences'));
    if(prior)clean(prior,account);
    const next=clean({...prior,...patch,schema,account_id:account},account);
    await v.writeFile(dir,root.ChatArchiveStorageProfile.resourcePath(prefix,'preferences'),JSON.stringify(next,null,2)+'\n');return next;
  }finally{try{await shared?.();}finally{release();}}
}
root.CAEPortablePreferences={read,write,clean};
})(globalThis);
