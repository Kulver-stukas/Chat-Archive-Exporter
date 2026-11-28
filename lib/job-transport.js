/* Generic browser job transport. Provider-specific wire names, scope and URL
 * eligibility are supplied by a profile; the browser port remains the security boundary. */
(function(root){
  'use strict';
  function create(profile,io){
    if(!profile?.descriptor||!profile.wire||typeof profile.verified!=='function')throw Error('Job transport profile required.');
    const descriptor=profile.descriptor;
    function connect(tabId,timeout){
      const raw=io.connect(tabId,timeout);
      return {call(operation,args={}){
        if(!Object.hasOwn(profile.wire,operation))throw Error('Unknown job operation: '+operation);
        return raw.call(profile.wire[operation],args);
      },close:()=>raw.close()};
    }
    async function findVerified({tabId,accountId,timeout,requirePath=false,checkpoint=()=>{},retryable=e=>e.code==='API_COOLDOWN',message}){
      const candidates=[],eligible=t=>!!t&&!t.discarded&&profile.matches(t.url,{requirePath});
      try{const t=await io.get(tabId);if(eligible(t))candidates.push(t);}catch{}
      const tabs=await io.query({active:true,lastFocusedWindow:true}).catch(()=>[]);
      for(const t of tabs)if(eligible(t)&&!candidates.some(x=>x.id===t.id))candidates.push(t);
      for(const t of candidates){
        checkpoint();await io.ensure(t.id).catch(()=>{});const rpc=connect(t.id,timeout);
        try{const scope=await rpc.call('status',{force:true});if(profile.verified(scope,accountId))return {rpc,tabId:t.id,scope};}
        catch(e){rpc.close();if(retryable(e))throw e;continue;}rpc.close();
      }
      throw Object.assign(Error(message||'Waiting for an authenticated '+descriptor.displayName+' tab in the original workspace.'),{code:'WAIT_TAB'});
    }
    return Object.freeze({connect,findVerified});
  }
  function legacy(){return create(root.ChatArchiveJobProfile,{connect:(...a)=>root.ChatArchiveSyncRPC.connect(...a),get:id=>chrome.tabs.get(id),query:q=>chrome.tabs.query(q),ensure:async id=>root.ChatArchiveTabBootstrap?.ensure?.(id)});}
  const api=Object.freeze({create,legacy});root.ChatArchiveJobTransport=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
