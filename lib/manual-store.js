/* UI-independent manual job storage. No credentials or signed URLs.
 * IndexedDB holds accepted selections, immutable staged bytes and per-job handles.
 * Background capture uses a DIFFERENT database and is never cleared here. */
(function(root){
  'use strict';
  const DB='cae-manual-exports-v1',VERSION=1,MAX_BYTES=128*1024*1024,REPORT_RESERVE=64*1024;
  const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id);
  function open(){return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,VERSION);
    r.onupgradeneeded=()=>{const d=r.result;
      if(!d.objectStoreNames.contains('jobs'))d.createObjectStore('jobs',{keyPath:'id'});
      if(!d.objectStoreNames.contains('entries'))d.createObjectStore('entries',{keyPath:'key'}).createIndex('job','jobId');
      if(!d.objectStoreNames.contains('handles'))d.createObjectStore('handles');
      if(!d.objectStoreNames.contains('controls'))d.createObjectStore('controls');
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Manual export database unavailable.'));
    r.onblocked=()=>reject(Error('Close an obsolete extension page to upgrade the manual job database.'));
  });}
  async function tx(stores,mode,work){const d=await open();try{return await new Promise((resolve,reject)=>{
    const t=d.transaction(stores,mode);let value,reason;
    t.oncomplete=()=>resolve(value);t.onabort=()=>reject(reason||t.error||Error('Manual export transaction aborted.'));
    t.onerror=()=>{reason ||= t.error;};
    try{work(t,v=>{value=v;},e=>{reason=e;t.abort();});}catch(e){reason=e;try{t.abort();}catch{}reject(e);}
  });}finally{d.close();}}
  const request=(r,done)=>{r.onsuccess=()=>done(r.result??null);};
  async function get(id){return tx(['jobs'],'readonly',(t,done)=>request(t.objectStore('jobs').get(id),done));}
  async function list(){return (await tx(['jobs'],'readonly',(t,done)=>request(t.objectStore('jobs').getAll(),done)))||[];}
  async function put(job){if(!validId(job?.id)||job.schema!=='cae.manual-job.v1')throw Error('Invalid manual job.');
    // Reject pathological metadata growth before copying a potentially huge selection.
    if(new TextEncoder().encode(JSON.stringify(job)).length>12*1024*1024)throw Error('Manual job metadata exceeds 12 MiB.');
    await tx(['jobs'],'readwrite',(t,done)=>{t.objectStore('jobs').put(job);done(job);});return job;}
  async function bind(id,dir){if(!validId(id)||!dir)throw Error('Invalid job directory.');
    return tx(['handles'],'readwrite',(t,done)=>{t.objectStore('handles').put(dir,id);done(true);});}
  async function directory(id){return tx(['handles'],'readonly',(t,done)=>request(t.objectStore('handles').get(id),done));}
  async function entry(id,key){return tx(['entries'],'readonly',(t,done)=>request(t.objectStore('entries').get(id+'|'+key),done));}
  async function entries(id){return (await tx(['entries'],'readonly',(t,done)=>request(
    t.objectStore('entries').index('job').getAll(IDBKeyRange.only(id)),done)))||[];}
  async function stage(job,key,path,blob,details={}){
    if(!validId(job.id)||typeof key!=='string'||!root.ChatArchiveVault.validPath(path)||!(blob instanceof Blob))throw Error('Invalid staged file.');
    const old=await entry(job.id,key);
    const total=(job.staged_bytes||0)-(old?.blob?.size||0)+blob.size;
    if(total>(key==='partial-report'?MAX_BYTES:MAX_BYTES-REPORT_RESERVE))throw Object.assign(Error('Manual staging exceeds 128 MiB. Export a smaller selection or use Vault.'),{code:'ZIP_LIMIT'});
    const record={key:job.id+'|'+key,jobId:job.id,entryId:key,path,blob,...details};
    const previous=job.staged_bytes||0;job.staged_bytes=total;
    try {await tx(['jobs','entries'],'readwrite',(t,done)=>{
      t.objectStore('entries').put(record);t.objectStore('jobs').put(job);done(record);
    });}catch(e){job.staged_bytes=previous;throw e;}return record;
  }
  async function dropEntry(job,key){const rec=await entry(job.id,key);if(!rec)return;
    job.staged_bytes=Math.max(0,(job.staged_bytes||0)-rec.blob.size);
    await tx(['jobs','entries'],'readwrite',(t,done)=>{
      t.objectStore('entries').delete(job.id+'|'+key);t.objectStore('jobs').put(job);done(true);
    });}
  async function requestCancel(id){return tx(['controls'],'readwrite',(t,done)=>{t.objectStore('controls').put(true,id);done(true);});}
  async function cancelled(id){return tx(['controls'],'readonly',(t,done)=>request(t.objectStore('controls').get(id),done));}
  async function clearPayload(id){await tx(['entries','handles','controls'],'readwrite',(t,done)=>{
    const r=t.objectStore('entries').index('job').getAll(IDBKeyRange.only(id));
    r.onsuccess=()=>{for(const e of r.result||[])t.objectStore('entries').delete(e.key);
      t.objectStore('handles').delete(id);t.objectStore('controls').delete(id);done(true);};
  });}
  async function remove(id){await clearPayload(id);await tx(['jobs'],'readwrite',(t,done)=>{t.objectStore('jobs').delete(id);done(true);});}
  root.ChatArchiveManualStore={DB,MAX_BYTES,REPORT_RESERVE,get,list,put,bind,directory,entry,entries,stage,dropEntry,clearPayload,remove,validId,requestCancel,cancelled};
})(globalThis);
