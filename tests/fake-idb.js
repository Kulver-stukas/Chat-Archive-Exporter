'use strict';
/* Tiny deterministic IndexedDB transaction simulator for the CAE stores.
 * Not shipped in the extension. Data survive simulated MV3 worker restarts. */
function createFakeIndexedDB(){
 const databases=new Map();
 const clone=x=>x===undefined?undefined:structuredClone(x);
 const match=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function requestAction(tx,fn){
  const r={result:undefined,error:null,onsuccess:null,onerror:null};
  tx.pending++;
  queueMicrotask(()=>{
   if(tx.aborted)return;
   try{r.result=fn();r.onsuccess?.({target:r});}
   catch(e){r.error=e;r.onerror?.({target:r});tx.abort(e);}
   tx.pending--;tx.maybeComplete();
  });
  return r;
 }
 function getByPath(obj,path){return Array.isArray(path)?path.map(k=>obj[k]):obj[path];}
 class Store {
  constructor(tx,name){this.tx=tx;this.name=name;this.definition=tx.db.stores.get(name);}
  get(key){return requestAction(this.tx,()=>clone(this.tx.drafts.get(this.name).get(JSON.stringify(key))));}
  getAll(){return requestAction(this.tx,()=>[...this.tx.drafts.get(this.name).values()].map(clone));}
  put(value,explicitKey){if(this.tx.mode!=='readwrite')throw Error('Read only');
   return requestAction(this.tx,()=>{
    const key=explicitKey===undefined?getByPath(value,this.definition.keyPath):explicitKey;
    this.tx.drafts.get(this.name).set(JSON.stringify(key),clone(value));return key;
   });
  }
  delete(key){if(this.tx.mode!=='readwrite')throw Error('Read only');
   return requestAction(this.tx,()=>this.tx.drafts.get(this.name).delete(JSON.stringify(key)));
  }
  index(name){const keyPath=this.definition.indexes.get(name);if(!keyPath)throw Error('No index '+name);
   return {getAll:(range,limit)=>requestAction(this.tx,()=>{
     let vals=[...this.tx.drafts.get(this.name).values()].filter(v=>!range||match(getByPath(v,keyPath),range.value));
     if(typeof limit==='number')vals=vals.slice(0,limit);
     return vals.map(clone);
   })};
  }
 }
 class UpgradeStore{
  constructor(def){this.def=def;}
  createIndex(name,path){this.def.indexes.set(name,path);}
 }
 class DB{
  constructor(stores){this.stores=stores;this.objectStoreNames={contains:n=>stores.has(n)};}
  createObjectStore(name,opts={}){const def={keyPath:opts.keyPath,indexes:new Map(),records:new Map()};this.stores.set(name,def);return new UpgradeStore(def);}
  transaction(names,mode='readonly'){
    const list=Array.isArray(names)?names:[names];
    for(const name of list)if(!this.stores.has(name))throw Error('Object store missing: '+name);
    const tx={db:this,mode,pending:0,aborted:false,completeScheduled:false,oncomplete:null,onabort:null,onerror:null,
      drafts:new Map(list.map(n=>[n,new Map(this.stores.get(n).records)])),
      objectStore(name){return new Store(tx,name);},
      abort(error){if(tx.aborted)return;tx.aborted=true;tx.error=error||Error('AbortError');queueMicrotask(()=>tx.onabort?.());},
      maybeComplete(){if(tx.pending||tx.completeScheduled||tx.aborted)return;tx.completeScheduled=true;
        queueMicrotask(()=>{tx.completeScheduled=false;if(tx.pending||tx.aborted)return;
          if(tx.mode==='readwrite')for(const [n,m]of tx.drafts)tx.db.stores.get(n).records=m;
          tx.oncomplete?.();
        });
      }
    };
    tx.maybeComplete();return tx;
  }
  close(){}
 }
 return {
  indexedDB:{open(name,version){
    const r={result:null,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
    queueMicrotask(()=>{
      if(!databases.has(name))databases.set(name,{version:0,stores:new Map()});
      const d=databases.get(name),db=new DB(d.stores);r.result=db;
      if(version>d.version){r.onupgradeneeded?.({target:r});d.version=version;}
      queueMicrotask(()=>r.onsuccess?.({target:r}));
    });return r;
  }},
  IDBKeyRange:{only:value=>({value})},
  databases
 };
}
module.exports={createFakeIndexedDB};
