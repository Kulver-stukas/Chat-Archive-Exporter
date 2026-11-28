/* Portable, display-only completion receipts. Never import executable job state,
 * logs with filenames, download IDs, credentials or original bytes. */
(function(root){
'use strict';
const V=root.ChatArchiveVault, P=root.ChatArchivePaths;
const schema='cae.workspace-activity.v1',storage=root.ChatArchiveStorageProfile;
const manualStatuses=new Set(['completed','completed_with_warnings','completed_not_saved','cancelled','failed']);
const libraryStatuses=new Set(['complete','cancelled','error']);
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(s);
const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
const count=x=>Number.isSafeInteger(x)&&x>=0?Math.min(x,1000000):0;
const counts=x=>Object.fromEntries(['saved','skipped','failed','conflict'].map(k=>[k,count(x?.[k])]));
const time=x=>Date.parse(x?.finished_at||'')||0;
function clean(x,account,kind){
  if(!x||x.schema!==schema||x.provider!==storage.providerId||x.account_id!==account||x.kind!==kind||!date(x.finished_at)||!validId(x.operation_id))return null;
  const out={schema,provider:storage.providerId,account_id:account,kind,operation_id:x.operation_id,finished_at:date(x.finished_at),status:x.status};
  if(kind==='manual'&&manualStatuses.has(x.status)&&['vault','download'].includes(x.destination))return {...out,destination:x.destination,total_chats:count(x.total_chats),chats_done:count(x.chats_done),counts:counts(x.counts),delivery:x.delivery==='download_completed'?'download_completed':x.delivery==='user_cancelled_save'?'user_cancelled_save':null};
  if(kind==='library'&&libraryStatuses.has(x.status)&&['manual','incremental','archive','saved_inventory','saved_report'].includes(x.operation))return {...out,operation:x.operation,total:count(x.total),counts:counts(x.counts)};
  return null;
}
function manual(j){if(!j||!manualStatuses.has(j.status))return null;return clean({schema,provider:storage.providerId,account_id:j.account,kind:'manual',operation_id:j.id,finished_at:j.finished_at,status:j.status,destination:j.destination,total_chats:j.total_chats??j.items?.length,chats_done:j.chat_index,counts:j.counts,delivery:j.delivery_outcome},j.account,'manual');}
function library(c){const j=c?.job;if(!j||!libraryStatuses.has(j.status)||!j.finished_at||j.kind==='incremental'&&j.detail?.startsWith('List check complete:'))return null;const results=j.results||j.report?.results||[];return clean({schema,provider:storage.providerId,account_id:c.account_id,kind:'library',operation_id:j.id,finished_at:j.finished_at,status:j.status,operation:j.kind,total:c.catalog?.items?.length||0,counts:{saved:results.filter(x=>x.status==='saved').length,skipped:results.filter(x=>x.status==='already_archived'||x.status==='skipped').length,failed:results.filter(x=>x.status==='failed').length,conflict:results.filter(x=>x.status==='conflict').length}},c.account_id,'library');}
function newer(a,b){if(!a)return b||null;if(!b)return a;return time(a)>time(b)||time(a)===time(b)&&a.operation_id.localeCompare(b.operation_id)>=0?a:b;}
function path(prefix,kind){return storage.resourcePath(prefix,kind==='manual'?'manualActivity':'libraryActivity');}
async function locate(account,display){
 if(!validId(account))throw Error('Invalid workspace ID.');
 const dir=await V.restoreWorkspaceDirectory(account);if(!dir||(await V.permissionState(dir)).state!=='granted')return null;
 const prefix=await V.resolveWorkspacePrefix(dir,P.createLayout(display||'Workspace '+account.slice(0,8)).prefix,account);
 return {dir,prefix};
}
async function readReceipt(dir,prefix,account,kind){const x=await V.readJson(dir,path(prefix,kind));if(!x)return null;const result=clean(x,account,kind);if(!result)throw Error('Invalid workspace activity receipt; existing file preserved.');return result;}
async function legacyLibrary(dir,prefix,account){
 // Existing inventory/report can reconstruct a factual saved-catalog summary,
 // not historical execution, monitoring state, or current file integrity.
 const snap=await V.readJson(dir,storage.resourcePath(prefix,'library'));
 if(snap?.schema!=='cae.library-vault.v1'||snap.account_id!==account||!Array.isArray(snap.catalog?.items)||snap.catalog.items.length>15000||!date(snap.baseline_at)||!date(snap.saved_at))return null;
 if(snap.catalog.active_scope?.account_id&&snap.catalog.active_scope.account_id!==account)return null;
 const base={schema,provider:storage.providerId,account_id:account,kind:'library',status:'complete'};
 const inv=clean({...base,operation_id:validId(snap.commit_id)?snap.commit_id:'saved-inventory',finished_at:snap.saved_at,operation:'saved_inventory',total:snap.catalog.items.length},account,'library');
 const report=await V.readJson(dir,storage.resourcePath(prefix,'libraryReport')).catch(()=>null);
 if(report?.schema!=='cae.library-download-report.v1'||report.account_id!==account||!date(report.finished_at)||!Array.isArray(report.results)||report.results.length>15000)return inv;
 // A report may precede final inventory commit. Describe the saved report
 // rather than falsely asserting that the whole archive task finished.
 const r=clean({...base,operation_id:'saved-download-report',finished_at:report.finished_at,operation:'saved_report',total:report.results.length,counts:{saved:report.results.filter(x=>x?.status==='saved').length,failed:report.results.filter(x=>x?.status==='failed').length,skipped:report.results.filter(x=>x?.status==='already_archived').length,conflict:report.results.filter(x=>x?.status==='conflict').length}},account,'library');
 // The inventory commit usually follows its download report by seconds. If
 // the committed snapshot actually contains those results, prefer the report.
 const byId=new Map(snap.catalog.items.map(item=>[item?.id,item]));
 const matched=report.results.length&&report.results.every(x=>byId.get(x?.id)?.archive?.status===x?.status);
 return matched?r:newer(inv,r);
}
const cache=new Map(),inflight=new Map();
async function read(account,display,force=false){
 const cached=cache.get(account);
 if(!force&&cached&&Date.now()-cached.at<20000){
   const dir=await V.restoreWorkspaceDirectory(account);
   if(dir&&(await V.permissionState(dir)).state==='granted'&&typeof dir.isSameEntry==='function'&&await V.deadline(dir.isSameEntry(cached.dir),3000,'History Vault identity').catch(()=>false))return cached.value;
   cache.delete(account);
 }
 if(inflight.has(account))return inflight.get(account);
 const p=(async()=>{const loc=await locate(account,display);if(!loc)return null;const {dir,prefix}=loc;
   const [m,l]=await Promise.all([readReceipt(dir,prefix,account,'manual'),readReceipt(dir,prefix,account,'library')]);
   const fallback=await legacyLibrary(dir,prefix,account);
   const value={account_id:account,manual:m,library:l&&time(l)>=time(fallback)?l:fallback};
   const current=await V.restoreWorkspaceDirectory(account);
   if(!current||typeof current.isSameEntry!=='function'||!await V.deadline(current.isSameEntry(dir),3000,'History binding verification').catch(()=>false))throw Error('Vault changed during history read.');
   cache.set(account,{at:Date.now(),value,dir});return value;
 })().finally(()=>inflight.delete(account));inflight.set(account,p);return p;
}
async function publish(receipt,display){
 if(!receipt)return false;const r=clean(receipt,receipt.account_id,receipt.kind);if(!r)return false;
 const account=r.account_id,loc=await locate(account,display);if(!loc)return false;
 // Avoid creating a new workspace just for a receipt from a browser download.
 // A chat ledger, sync config, workspace config or saved library anchors it.
 const {dir,prefix}=loc;
 const anchored=await V.readJson(dir,storage.resourcePath(prefix,'chats'))||await V.readJson(dir,storage.resourcePath(prefix,'sync'))||await V.readJson(dir,storage.resourcePath(prefix,'configuration'))||await V.readJson(dir,storage.resourcePath(prefix,'library'));
 if(!anchored)return false;
 if((anchored.account_id||anchored.active_scope?.account_id)!==account)throw Error('Activity receipt workspace mismatch.');
 let previous=await readReceipt(dir,prefix,account,r.kind);if(newer(previous,r)===previous)return true;
 const unlock=await V.acquireLock(true);if(!unlock)return false;let release;
 try{
  release=await V.acquireVaultGuard(dir,unlock,{workspaceId:account,operation:'activity_receipt'});
  // Resolve and compare under the same guard, protecting both installations.
  const latestPrefix=await V.resolveWorkspacePrefix(dir,prefix,account);if(latestPrefix!==prefix)return false;
  previous=await readReceipt(dir,prefix,account,r.kind);if(newer(previous,r)===previous)return true;
  await V.writeFile(dir,path(prefix,r.kind),JSON.stringify(r,null,2)+'\n');cache.delete(account);return true;
 }finally{try{await release?.();}finally{await unlock();}}
}
function summary(r){if(!r)return '';
 const when=new Date(r.finished_at).toLocaleString();
 const status=({'completed':'Complete','complete':'Complete','completed_with_warnings':'Completed with warnings','completed_not_saved':'Prepared, not saved','cancelled':'Canceled','failed':'Failed','error':'Error'})[r.status]||'Recorded';
 if(r.kind==='manual')return `${status} - ${r.destination==='vault'?'Vault export':r.delivery==='download_completed'?'Browser download completed in originating browser':r.status==='completed_not_saved'?'Browser Save canceled':'Browser download'}; chats: ${r.chats_done}/${r.total_chats} processed; ${r.counts.saved} ${r.destination==='vault'?'saved':'prepared'}, ${r.counts.skipped} skipped, ${r.counts.failed} failed. (${when}; saved history)`;
 if(r.operation==='archive'||r.operation==='saved_report')return `${r.operation==='saved_report'?'Saved Library download report':status+' - Library archival'}: ${r.counts.saved} saved, ${r.counts.failed} failed. (${when}; saved history)`;
 return `${r.operation==='saved_inventory'?'Saved inventory':status+' - Library inventory'}: ${r.total} files. (${when}; saved history)`;
}
root.ChatArchiveWorkspaceActivity={manual,library,read,publish,summary,newer,clean,invalidate:account=>cache.delete(account)};
})(globalThis);
