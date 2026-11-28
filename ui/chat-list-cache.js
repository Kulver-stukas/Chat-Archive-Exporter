/* UI-only metadata cache: reads workspace-index and list metadata, never chat bodies.
 * Vault and provider remain authoritative; this module cannot change exports. */
(function(root){
  'use strict';
  const KEY='cae.ui.chat-list.v1.';
  const MAX_ITEMS=15000;
  const isAccount=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{3,120}$/.test(s);
  const validId=id=>typeof id==='string'&&/^[a-z0-9_-]{8,240}$/i.test(id);
  const text=(v,n)=>String(v??'').slice(0,n);
  const key=account=>{if(!isAccount(account))throw Error('Invalid workspace cache scope.');return KEY+account;};
  function normalize(items,projects=[]){
    const seen=new Set(),chats=[];
    for(const raw of (Array.isArray(items)?items:[]).slice(0,MAX_ITEMS)){
      const id=raw?.id||raw?.conversation_id;
      if(!validId(id)||seen.has(id))continue;
      seen.add(id);
      chats.push({id,title:text(raw.title||'Untitled chat',1000),projectId:text(raw.projectId||raw.project_id,240),
        project:text(raw.project||'',350),gptId:text(raw.gptId||raw.gpt_id,240),gptName:text(raw.gptName||raw.gpt_name,350),
        archived:raw.archived===true,updated:raw.updated||null,created:raw.created||null});
    }
    const unique=new Set(),projs=[];
    for(const p of Array.isArray(projects)?projects:[]){
      if(!validId(p?.id)||unique.has(p.id))continue;
      unique.add(p.id);projs.push({id:p.id,name:text(p.name||p.id,350)});
    }
    return {items:chats,projects:projs};
  }
  const profile=()=>root.ChatArchiveStorageProfile||(typeof require==='function'?require('../providers/chatgpt/storage-profile.js'):null);
  function vaultEvidence(ledger,account,prefix){
    if(!isAccount(account)||!profile()?.validPrefix(prefix)||ledger?.schema!==profile().workspaceSchema||ledger.account_id!==account||!ledger.chats||typeof ledger.chats!=='object'||Array.isArray(ledger.chats))return null;
    const records=Object.create(null);
    const entries=Object.entries(ledger.chats);if(entries.length>MAX_ITEMS)return null;
    for(const [id,x] of entries){
      if(!validId(id))continue;
      // Keep the presence of an invalid record separate from missing evidence.
      if(!x||x.conversation_id!==id||typeof x.path!=='string'||!x.path.startsWith(prefix+'/')||x.path.split('/').some(part=>!part||part==='.'||part==='..'||/[\\:*?"<>|\x00-\x1f]/.test(part))||
          !/^[0-9a-f]{64}$/i.test(x.sha256||'')||!Number.isSafeInteger(x.bytes)||x.bytes<=0){records[id]=null;continue;}
      records[id]={title:text(x.title,1000),project_id:text(x.project_id,240),gpt_id:text(x.gpt_id,240),gpt_name:text(x.gpt_name,350),
        archived:x.archived===true,updated_ms:Number.isFinite(x.updated_ms)?x.updated_ms:null,
        listed_updated_ms:Number.isFinite(x.listed_updated_ms)?x.listed_updated_ms:null};
    }
    return {account_id:account,prefix,records};
  }
  function archiveStatus(item,evidence,account,compareLive=true){
    if(!evidence||evidence.account_id!==account||!evidence.records||!validId(item?.id))return 'unknown';
    if(!Object.hasOwn(evidence.records,item.id))return compareLive?'missing':'unknown';
    const record=evidence.records[item.id];if(!record)return 'unknown';
    if(!compareLive)return 'saved';
    const p=profile();
    if(!p||p.chatTimestamp(item.updated)===null||record.updated_ms===null&&record.listed_updated_ms===null)return 'unknown';
    return p.sameChatRevision(item,record)?'current':'outdated';
  }
  function fromIndex(ledger,mirror,account,prefix){
    if(!isAccount(account)||!profile()?.validPrefix(prefix))return null;
    const fromDisk=ledger?.schema===profile().workspaceSchema&&ledger?.account_id===account&&
      ledger?.chats&&typeof ledger.chats==='object'&&!Array.isArray(ledger.chats);
    const fromMirror=mirror?.schema==='cae.background-mirror.v1'&&mirror.account===account&&mirror.prefix===prefix&&
      mirror.chats&&typeof mirror.chats==='object'&&!Array.isArray(mirror.chats);
    if(!fromDisk&&!fromMirror)return null;
    const chatRecords=fromDisk?ledger.chats:mirror.chats;
    const items=[];
    for(const [id,r] of Object.entries(chatRecords).slice(0,MAX_ITEMS)){
      if(!r||!validId(id)||r.conversation_id&&r.conversation_id!==id||
        typeof r.path!=='string'||!r.path.startsWith(prefix+'/'))continue;
      const projectId=text(r.project_id,240);
      const container=projectId&&r.path.slice(prefix.length+1).split('/')[0]||'';
      items.push({id,title:r.title,projectId,project:container,gptId:r.gpt_id,gptName:r.gpt_name,
        archived:r.archived===true,updated:r.updated,created:r.created});
    }
    const projects=fromMirror?mirror.known:[];
    const data=normalize(items,projects);
    return {...data,source:fromDisk?'Vault workspace index':'Vault mirror',captured_at:fromDisk?ledger.updated_at:mirror.verified_at,
      vault:fromDisk?vaultEvidence(ledger,account,prefix):null};
  }
  function envelope(account,source,items,projects,updatedAt=Date.now()){
    if(!isAccount(account))throw Error('Invalid workspace cache scope.');
    const norm=normalize(items,projects);
    return {schema:'cae.ui.chat-list.v1',account_id:account,source:text(source||'cached',50),saved_at:updatedAt,
      items:norm.items,projects:norm.projects};
  }
  function accept(record,account){
    if(!record||record.schema!=='cae.ui.chat-list.v1'||record.account_id!==account||
       !Array.isArray(record.items)||record.items.length>MAX_ITEMS)return null;
    return envelope(account,record.source,record.items,record.projects,record.saved_at);
  }
  const api={key,normalize,fromIndex,envelope,accept,vaultEvidence,archiveStatus};
  root.CAEUIChatListCache=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
