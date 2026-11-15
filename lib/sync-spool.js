/* Background capture spool (v0.1.6.5). The Vault remains authoritative.
 * All records are scoped to a verified workspace. No tokens or source bytes.
 * IndexedDB transactions commit capture metadata and Markdown atomically. */
(function(root){
  'use strict';
  const DB='cae-background-capture-v1', VERSION=1;
  const PER_CHAT=12*1024*1024, PER_WORKSPACE=64*1024*1024, MAX_ITEMS=250;
  const MIRROR_LIMIT=12*1024*1024;
  const encoder=new TextEncoder();
  const isAccount=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{3,120}$/.test(s);
  const validPrefix=s=>typeof s==='string'&&/^ChatGPT\/[^/]+$/.test(s)&&s.length<300;
  const clone=x=>JSON.parse(JSON.stringify(x));
  function assertion(account,prefix){
    if(!isAccount(account)||!validPrefix(prefix))throw new Error('Invalid workspace identity for background buffer.');
  }
  function open(){
    if(typeof indexedDB==='undefined')return Promise.reject(new Error('IndexedDB unavailable: offline capture is disabled.'));
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB,VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('mirrors'))db.createObjectStore('mirrors',{keyPath:'account'});
        if(!db.objectStoreNames.contains('captures')){
          const st=db.createObjectStore('captures',{keyPath:'key'});
          st.createIndex('byAccount','account',{unique:false});
          st.createIndex('byAccountState',['account','state'],{unique:false});
        }
        if(!db.objectStoreNames.contains('bodies'))db.createObjectStore('bodies');
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Cannot open background buffer.'));
      req.onblocked=()=>reject(new Error('Background buffer database upgrade is blocked.'));
    });
  }
  async function transact(stores,mode,setup){
    const db=await open();
    try{return await new Promise((resolve,reject)=>{
      let value,reason=null;
      let tx;
      try {tx=db.transaction(stores,mode);}catch(e){reject(e);return;}
      const result=x=>{value=x;};
      tx.oncomplete=()=>resolve(value);
      tx.onabort=()=>reject(reason||tx.error||new Error('Background buffer transaction aborted.'));
      tx.onerror=()=>reject(tx.error||new Error('Background buffer transaction failed.'));
      try{setup(tx,result,e=>{reason=e;tx.abort();});}catch(e){reason=e;try{tx.abort();}catch{}reject(e);}
    });}finally{db.close();}
  }
  function mirrorRecord(account,prefix,ledger,known=[],globalIndex={}){
    assertion(account,prefix);
    if(ledger?.schema!=='cae.workspace-chats.v1'||ledger.account_id!==account ||
       !ledger.chats || typeof ledger.chats!=='object'||Array.isArray(ledger.chats))
      throw new Error('Cannot mirror an unverified workspace index.');
    const chats=Object.create(null);
    for(const [id,record] of Object.entries(ledger.chats)){
      if(!record?.path?.startsWith(prefix+'/')||!root.ChatArchiveVault.validPath(record.path)||
         !/^[0-9a-f]{64}$/i.test(record.sha256||''))continue;
      chats[id]={conversation_id:id,path:record.path,title:record.title,
        project_id:record.project_id||'',gpt_id:record.gpt_id||'',gpt_name:record.gpt_name||'',
        updated:record.updated||null,updated_ms:record.updated_ms??null,listed_updated_ms:record.listed_updated_ms??null,
        exported:record.exported||null,sha256:record.sha256,bytes:record.bytes,saved_at:record.saved_at||null,
        created:record.created||null};
    }
    const projects=(Array.isArray(known)?known:[]).filter(p=>p?.id&&p?.path?.startsWith(prefix+'/'))
      .map(p=>({id:String(p.id),path:String(p.path),name:String(p.name||'')}));
    const sources=Object.create(null);
    for(const [key,record] of Object.entries(globalIndex?.sources||{})){
      if(!key.startsWith(account+'|')||!record?.path?.startsWith(prefix+'/'))continue;
      sources[key]={project_id:record.project_id,file_id:record.file_id,
        path:record.path,source_identity:record.source_identity||null,sha256:record.sha256||null};
    }
    const mirror={schema:'cae.background-mirror.v1',account,prefix,verified_at:new Date().toISOString(),
      disk_index_created_at:globalIndex?.created_at||null,disk_ledger_updated_at:ledger.updated_at||null,
      chats,known:projects,sources};
    if(encoder.encode(JSON.stringify(mirror)).length>MIRROR_LIMIT)
      throw new Error('Workspace mirror exceeds the 12 MiB safety limit.');
    return mirror;
  }
  async function seed(account,prefix,ledger,known,index){
    const mirror=mirrorRecord(account,prefix,ledger,known,index);
    await transact(['mirrors'],'readwrite',(tx,done)=>{
      tx.objectStore('mirrors').put(mirror);done(mirror);
    });
    return mirror;
  }
  async function readMirror(account,prefix){
    assertion(account,prefix);
    const mirror=await transact(['mirrors'],'readonly',(tx,done)=>{
      const req=tx.objectStore('mirrors').get(account);
      req.onsuccess=()=>done(req.result||null);
    });
    return mirror?.schema==='cae.background-mirror.v1'&&mirror.account===account&&mirror.prefix===prefix?mirror:null;
  }
  function token(){return root.crypto?.randomUUID?.()||'c'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
  function limitError(message){const e=Error(message);e.code='SPOOL_FULL';return e;}
  async function stage(account,prefix,entry){
    assertion(account,prefix);
    const {item,text,path,projectId,vaultId}=entry||{};
    if(!item?.id||typeof item.id!=='string'||item.id.length>240||typeof text!=='string'||
       !path?.startsWith(prefix+'/')||!root.ChatArchiveVault.validPath(path))
      throw new Error('Unsafe background chat capture.');
    const bytes=encoder.encode(text);
    if(bytes.byteLength>PER_CHAT)throw limitError('Chat exceeds the 12 MiB offline buffer per-file limit.');
    const header=await root.ChatArchiveVault.readChatHeader(new Blob([bytes]));
    if(!header||header.conversation_id!==item.id)throw new Error('Offline Markdown header does not match the conversation.');
    const key=account+'|'+item.id,hash=root.ChatArchiveHash.hex(bytes);
    const updatedMs=root.ChatArchiveVault.chatTimestamp(header.updated);
    const rec={key,account,conversation_id:item.id,state:'pending',token:token(),path,
      vault_id:vaultId||null,
      title:String(item.title||header.title||'').slice(0,250),project_id:projectId||'',
      created:item.created??null,listed_updated_ms:root.ChatArchiveVault.chatTimestamp(item.updated),
      content_updated_ms:updatedMs,sha256:hash,bytes:bytes.byteLength,
      captured_at:new Date().toISOString(),error:null};
    // The count/size check and both puts are in ONE transaction. On a quota
    // failure neither the body nor its metadata may be acknowledged as staged.
    return transact(['captures','bodies'],'readwrite',(tx,done,abort)=>{
      const records=tx.objectStore('captures'),bodies=tx.objectStore('bodies');
      const req=records.getAll();
      req.onsuccess=()=>{
        try{
          const all=req.result||[],previous=all.find(x=>x.key===key);
          if(previous?.state==='conflict')throw Object.assign(Error('Buffered chat has an unresolved local conflict.'),{code:'SPOOL_CONFLICT'});
          if(previous?.vault_id&&rec.vault_id&&previous.vault_id!==rec.vault_id)
            throw Object.assign(Error('Buffered chat belongs to another Vault.'),{code:'SPOOL_CONFLICT'});
          if(previous && previous.content_updated_ms!==null && updatedMs!==null &&
             previous.content_updated_ms>updatedMs){done({status:'newer_pending',record:previous});return;}
          if(previous?.sha256===hash){done({status:'unchanged',record:previous});return;}
          const workspace=all.filter(x=>x.account===account);
          if(!previous&&workspace.length>=MAX_ITEMS)throw limitError('Workspace offline buffer has 250 pending/conflicting chats.');
          const total=workspace.reduce((n,x)=>n+(x.bytes||0),0)-(previous?.bytes||0)+rec.bytes;
          if(total>PER_WORKSPACE)throw limitError('Workspace offline buffer exceeds 64 MiB.');
          records.put(rec);bodies.put(text,key);
          done({status:'captured',record:rec});
        }catch(e){abort(e);}
      };
    });
  }
  async function metadata(account,id){
    if(!isAccount(account)||typeof id!=='string'||id.length>240)throw new Error('Invalid buffered conversation ID.');
    return transact(['captures'],'readonly',(tx,done)=>{
      const req=tx.objectStore('captures').get(account+'|'+id);
      req.onsuccess=()=>done(req.result||null);
    });
  }
  async function pending(account,limit=2){
    if(!isAccount(account))throw new Error('Invalid workspace.');
    return transact(['captures','bodies'],'readonly',(tx,done)=>{
      const st=tx.objectStore('captures'),out=[];
      const req=st.index('byAccountState').getAll(IDBKeyRange.only([account,'pending']),Math.max(1,Math.min(10,limit)));
      req.onsuccess=()=>{
        const records=req.result||[];
        if(!records.length){done([]);return;}
        let remaining=records.length;
        for(const rec of records){
          const r=tx.objectStore('bodies').get(rec.key);
          r.onsuccess=()=>{out.push({...rec,text:r.result});if(!--remaining)done(out.sort((a,b)=>a.captured_at.localeCompare(b.captured_at)));};
        }
      };
    });
  }
  async function stats(account){
    if(!isAccount(account))throw new Error('Invalid workspace.');
    return transact(['captures'],'readonly',(tx,done)=>{
      const req=tx.objectStore('captures').index('byAccount').getAll(IDBKeyRange.only(account));
      req.onsuccess=()=>{
        const list=req.result||[];
        done({pending:list.filter(x=>x.state==='pending').length,
          conflicts:list.filter(x=>x.state==='conflict').length,
          bytes:list.reduce((n,x)=>n+(x.bytes||0),0)});
      };
    });
  }
  async function finish(account,rec,status='committed',reason=''){
    if(!isAccount(account)||!rec?.key?.startsWith(account+'|')||!rec.token)throw new Error('Invalid buffered commit identity.');
    return transact(['captures','bodies'],'readwrite',(tx,done)=>{
      const st=tx.objectStore('captures'),r=st.get(rec.key);
      r.onsuccess=()=>{
        const stored=r.result;
        if(!stored||stored.token!==rec.token){done(false);return;}
        if(status==='conflict'){
          st.put({...stored,state:'conflict',error:String(reason).slice(0,200)});
        }else{
          st.delete(rec.key);tx.objectStore('bodies').delete(rec.key);
        }
        done(true);
      };
    });
  }
  const api={seed,readMirror,mirrorRecord,stage,metadata,pending,stats,finish,
    LIMITS:{PER_CHAT,PER_WORKSPACE,MAX_ITEMS},DB};
  root.ChatArchiveSyncSpool=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
