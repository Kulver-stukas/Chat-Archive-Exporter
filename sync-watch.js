/* Opt-in, bounded latest-turn watcher. No MutationObserver or network hooks.
 * The worker receives only a conversation id, stream status and a signature.
 * Markup is sampled locally; full chat text always comes from the API. */
(()=>{
  'use strict';
  const runningVersion = chrome.runtime.getManifest?.()?.version || '0.1.6.4';
  if (globalThis.__CAE_WATCH_BOOT_VERSION === runningVersion) return;
  globalThis.__CAE_WATCH_BOOT_VERSION = runningVersion;
  const SETTLE_MS=12000, HIDDEN_PENDING_MS=15*60_000;
  let enabled=false,timer=null,last='',observed='',observedRole='',wasStreaming=false;
  let hiddenAt=0,lastEmit=0,settleUntil=0,awaitingUntil=0,retryAfter=0;
  const send=data=>{
    try{return Promise.resolve(chrome.runtime.sendMessage(data)).catch(()=>null);}
    catch{stop();return Promise.resolve(null);}
  };
  const provider=globalThis.ChatArchiveProviders.legacy;
  const cid=()=>provider.observedConversationId(location.pathname);
  const pid=()=>provider.observedProjectId(location.pathname);
  function stop(){
    enabled=false;clearTimeout(timer);timer=null;last='';observed='';observedRole='';
    wasStreaming=false;hiddenAt=0;lastEmit=0;settleUntil=0;awaitingUntil=0;retryAfter=0;
  }
  function latestTurn(area){
    // ChatGPT has used both message attributes and conversation-turn wrappers.
    // Query only the chat main region; never inspect the entire page transcript.
    const nodes=area?.querySelectorAll?.(
      '[data-message-id], [data-chatgpt-search-unit-key], [data-message-author-role], article[data-testid^="conversation-turn-"]'
    );
    return nodes?.length?nodes[nodes.length-1]:null;
  }
  function roleOf(node){
    const own=node?.getAttribute?.('data-message-author-role');
    const inner=node?.querySelector?.('[data-message-author-role]')?.getAttribute?.('data-message-author-role');
    return own||inner||'';
  }
  function publish(data){
    send({type:'CAE_SYNC_SIGNAL',...data}).then(reply=>{
      if(!enabled)return;
      if(reply?.ok===true&&reply?.result?.accepted===false){
        // A worker can restart between samples. Retry a rejected event at a
        // bounded rate rather than permanently treating it as delivered.
        retryAfter=Date.now()+30000;last='';
        send({type:'CAE_SYNC_HELLO'});
      }
    });
  }
  function sample(){
    if(!enabled)return;
    try{if(!chrome.runtime.id){stop();return;}}catch{stop();return;}
    clearTimeout(timer);
    const now=Date.now();
    const hidden=document.visibilityState==='hidden';
    if(hidden){
      hiddenAt ||= now;
      const pending=wasStreaming||now<awaitingUntil||now<settleUntil;
      if((!pending&&now-hiddenAt>60000)||now-hiddenAt>2*3600_000){stop();return;}
    }else hiddenAt=0;
    const id=cid();
    if(id&&!/[?&]temporary-chat=true\b/i.test(location.search)){
      const area=document.querySelector('main');
      const node=latestTurn(area);
      // Buttons may be outside main (the composer is not necessarily in it).
      const stopSelector='[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[title="Stop generating"], [data-is-streaming="true"]';
      const stopButton=Boolean(area?.querySelector?.(stopSelector)||document.querySelector?.(stopSelector));
      const text=node?.textContent||'';
      let hash=2166136261;
      for(const char of text.slice(-512))hash=Math.imul(hash^char.charCodeAt(0),16777619);
      const role=roleOf(node);
      const signature=id+':'+(node?.getAttribute?.('data-message-id')||node?.getAttribute?.('data-chatgpt-search-unit-key')||node?.getAttribute?.('data-testid')||'')+':'+text.length+':'+(hash>>>0);
      const first=!observed;
      if(signature!==observed){
        // Only a change AFTER the first observation is evidence of new text.
        // A recently modified assistant turn may still be streaming even if
        // the current UI uses an unrecognized Stop-button selector.
        if(!first)settleUntil=now+SETTLE_MS;
        if(role==='user'&&(!first||role!==observedRole))awaitingUntil=now+HIDDEN_PENDING_MS;
        if(role==='assistant')awaitingUntil=0;
        observed=signature;observedRole=role;
      }
      const streaming=stopButton || (role==='user'&&now<awaitingUntil) ||
        (role==='assistant'&&now<settleUntil);
      if(signature!==last||streaming!==wasStreaming){
        const initial=!last;
        if(now>=retryAfter&&(!streaming||now-lastEmit>15000||!wasStreaming)){
          publish({conversationId:id,projectId:pid(),streaming,signature,initial,sampledAt:now});
          lastEmit=now;last=signature;
        }else if(now>=retryAfter){last=signature;}
      }
      wasStreaming=streaming;
    }
    timer=setTimeout(sample,hidden?10000:3000);
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(sender.id!==chrome.runtime.id||msg?.type!=='CAE_SYNC_WATCH')return;
    if(msg.enabled){enabled=true;sample();}else stop();
    reply({ok:true});
  });
  document.addEventListener('visibilitychange',()=>{
    if(enabled)sample();
    else if(document.visibilityState==='visible')send({type:'CAE_SYNC_HELLO'});
  });
  window.addEventListener('pageshow',()=>send({type:'CAE_SYNC_HELLO'}));
  send({type:'CAE_SYNC_HELLO'});
})();
