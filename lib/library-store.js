/* Private extension storage. Auth, signed URLs and original bytes never enter this database. */
(function(root){
  'use strict';
  const NAME='cae-library-jobs', STORE='state';
  function db(){return new Promise((resolve,reject)=>{
    const r=indexedDB.open(NAME,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });}
  async function tx(mode,fn){const d=await db();try{return await new Promise((resolve,reject)=>{
    const t=d.transaction(STORE,mode);let result;
    const r=fn(t.objectStore(STORE));r.onsuccess=()=>{result=r.result;};
    t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Library state transaction aborted.'));
  });}finally{d.close();}}
  const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(s);
  const key=id=>{if(!validId(id))throw Error('Invalid workspace ID.');return 'workspace:'+id;};
  const api={validId,get:async id=>(await tx('readonly',s=>s.get(key(id))))||null,
    put:record=>tx('readwrite',s=>s.put(record,key(record.account_id))),
    list:async()=>(await tx('readonly',s=>s.getAll())).filter(x=>x?.schema==='cae.library-state.v1'),
    bind:(id,handle)=>tx('readwrite',s=>s.put(handle,'directory:'+key(id))),
    directory:id=>tx('readonly',s=>s.get('directory:'+key(id)))};
  root.ChatArchiveLibraryStore=api;
})(globalThis);
