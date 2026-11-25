/* Pure selective-export policy. Stored preferences never contain chat content. */
(function(root){
  'use strict';
  const DEFAULTS=Object.freeze({questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:true});
  const FIELDS=Object.keys(DEFAULTS),MAX_MESSAGES=20000;
  const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
  const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
  function preferences(raw){return Object.fromEntries(FIELDS.map(k=>[k,typeof raw?.[k]==='boolean'?raw[k]:DEFAULTS[k]]));}
  function normalize(raw){
    if(raw!=null&&(typeof raw!=='object'||Array.isArray(raw)))fail('INVALID_SELECTION','Invalid export selection.');
    raw ||= {};
    for(const k of FIELDS)if(Object.prototype.hasOwnProperty.call(raw,k)&&typeof raw[k]!=='boolean')
      fail('INVALID_SELECTION','Invalid export preference: '+k+'.');
    const out={...preferences(raw),conversationId:null,branchNode:null,messageIds:null};
    for(const k of ['conversationId','branchNode'])if(raw[k]!=null){
      if(!validId(raw[k]))fail('INVALID_SELECTION','Invalid selection identity.');out[k]=raw[k];
    }
    if(!out.completeConversation){
      if(!out.conversationId||!out.branchNode||!Array.isArray(raw.messageIds)||raw.messageIds.length>MAX_MESSAGES||!raw.messageIds.every(validId))
        fail('INVALID_SELECTION','Choose messages from a loaded conversation.');
      out.messageIds=[...new Set(raw.messageIds)];
      if(!out.messageIds.length)fail('EMPTY_SELECTION','Select at least one message.');
    }
    return out;
  }
  function textEnabled(message,p){return message.role==='user'?p.questions:message.role==='assistant'?p.answers:message.role==='thinking'?p.thinking:false;}
  function textOf(message){return typeof message.textContent==='string'?message.textContent:String(message.content||'');}
  function fileEnabled(a,p){return a?.origin==='uploaded'?p.uploadedFiles:a?.origin==='generated'?p.generatedFiles:false;}
  function messageFiles(m,p){return (Array.isArray(m?.attachments)?m.attachments:[]).filter(a=>fileEnabled(a,p));}
  function messageEligible(m,p){return !!(textEnabled(m,p)&&textOf(m).trim()||messageFiles(m,p).length);}
  function groups(chat){
    const result=[];
    for(const m of chat?.messages||[]){
      if(!['user','assistant','thinking'].includes(m?.role))continue;
      if(m.role==='user'||!result.length||result.at(-1)[0].role==='user')result.push([m]);
      else result.at(-1).push(m);
    }
    return result;
  }
  // Display text is independent of export categories. Never use a Thinking
  // block as an answer preview, even if Thinking is the only selected category.
  function previewText(group){
    const role=group[0]?.role==='user'?'user':'assistant';
    const body=group.filter(m=>m.role===role).map(textOf).filter(t=>t.trim()).join('\n\n').trim();
    if(body)return body;
    const files=[...new Set(group.flatMap(m=>m.attachments||[]).map(a=>a.name||a.fileId||'Unnamed file'))];
    if(files.length)return (role==='user'?'Uploaded or referenced files: ':'Response files: ')+files.join(', ');
    return role==='user'?'No question text available':'No response text available';
  }
  function rows(chat,raw){
    const p=preferences(raw);
    return groups(chat).map(group=>{
      const ids=group.map(m=>m.id).filter(validId),files=new Set(group.flatMap(m=>messageFiles(m,p)).map(a=>a.key));
      return {id:ids[0]||'',role:group[0].role==='user'?'question':'answer',messageIds:ids,
        preview:previewText(group).split(/\r\n|\r|\n/,1)[0].slice(0,280),
        hasThinking:group.some(m=>m.role==='thinking'&&textOf(m).trim()),attachmentCount:files.size,
        eligible:ids.length===group.length&&group.some(m=>messageEligible(m,p))};
    });
  }
  function selectedMessages(chat,raw){
    const p=normalize(raw),ids=p.completeConversation?null:new Set(p.messageIds);
    return (chat?.messages||[]).filter(m=>(!ids||ids.has(m.id))&&['user','assistant','thinking'].includes(m.role));
  }
  function validate(chat,raw){
    const p=normalize(raw);
    if(!chat||!Array.isArray(chat.messages))fail('INVALID_SELECTION','Conversation is unavailable.');
    if(p.conversationId&&p.conversationId!==chat.id)fail('SELECTION_CHANGED','The selected conversation changed. Reload the message selector.');
    if(p.branchNode&&p.branchNode!==chat.branchNode)fail('SELECTION_CHANGED','The conversation branch changed. Reload the message selector.');
    if(!p.completeConversation){
      const known=new Set(chat.messages.map(m=>m.id));
      if(p.messageIds.some(id=>!known.has(id)))fail('SELECTION_CHANGED','A selected message is no longer available. Reload the message selector.');
    }
    if(!selectedMessages(chat,p).some(m=>messageEligible(m,p)))fail('EMPTY_SELECTION','No available content matches the selected categories and messages.');
    return p;
  }
  function attachments(chat,raw){
    const p=normalize(raw),result=new Map();
    for(const m of selectedMessages(chat,p))for(const a of messageFiles(m,p)){
      if(!a||typeof a.key!=='string')continue;
      // A file ID proves identity. Sandbox files are scoped to a conversation
      // and their producing message; equal names alone do not prove identity.
      const key=a.fileId?'file:'+a.fileId:a.sandboxPath?'sandbox:'+chat.id+':'+m.id+':'+a.sandboxPath:a.key;
      const old=result.get(key);
      if(old){if(!old.messageIds.includes(m.id))old.messageIds.push(m.id);if(!old.keys.includes(a.key))old.keys.push(a.key);}
      else result.set(key,{...a,conversationId:chat.id,messageId:a.messageId||m.id,messageIds:[m.id],keys:[a.key]});
    }
    return [...result.values()];
  }
  const api={DEFAULTS,FIELDS,MAX_MESSAGES,preferences,normalize,validate,rows,attachments,selectedMessages,
    groups,previewText,textEnabled,textOf,fileEnabled,messageFiles,messageEligible};
  root.ChatArchiveExportSelection=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
