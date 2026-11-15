/* Short-lived, bounded port. Tokens never leave the ChatGPT content script. */
(function(root){
  'use strict';
  function connect(tabId, timeoutMs=60000){
    const port=chrome.tabs.connect(tabId,{name:'CAE_API'}),pending=new Map();let seq=0,closed=false;
    port.onMessage.addListener(msg=>{
      const p=pending.get(msg?.id);if(!p)return;
      if(msg.progress)return;
      pending.delete(msg.id);clearTimeout(p.timer);
      if(msg.error){const e=new Error(msg.error);e.code=msg.errorCode;e.httpStatus=msg.httpStatus;e.retryAfterMs=msg.retryAfterMs;p.reject(e);}
      else p.resolve(msg.result);
    });
    function close(reason){if(closed)return;closed=true;try{port.disconnect();}catch{}
      for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(reason || 'ChatGPT tab disconnected.'));}pending.clear();}
    port.onDisconnect.addListener(()=>{
      // If tabs.connect() had no content-script listener, the error arrives
      // here. Reading lastError prevents an Unchecked runtime.lastError issue.
      const reason=chrome.runtime.lastError?.message;
      close(reason);
    });
    const call=(type,data={})=>new Promise((resolve,reject)=>{
      if(closed){reject(new Error('ChatGPT connection closed.'));return;}
      const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Background API request timed out.'));},timeoutMs);
      pending.set(id,{resolve,reject,timer});
      try{port.postMessage({id,type,...data});}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
    return {call,close};
  }
  root.ChatArchiveSyncRPC={connect};
})(globalThis);
