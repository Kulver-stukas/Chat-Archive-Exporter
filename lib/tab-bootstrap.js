/* Recover the content-script bridge in ChatGPT tabs already open when an MV3
 * extension is installed or updated. No page reload, fetch hooks or MAIN-world
 * injection; never inject into unsupported or discarded tabs. */
(function(root) {
  'use strict';
  const FILES = ['lib/normalize.js','lib/config-inventory.js','lib/source-transfer.js','lib/library-inventory.js','lib/api.js','content.js','sync-watch.js'];
  const URL_OK = /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i;
  const inflight = new Map();
  const lastFailed = new Map();
  const VERSION = () => chrome.runtime.getManifest().version;
  const MAX_PROBE_MS = 3000;
  function bounded(promise, ms=MAX_PROBE_MS) {
    let timeout;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timeout=setTimeout(() => reject(new Error('Bridge probe timed out.')),ms); })
    ]).finally(()=>clearTimeout(timeout));
  }
  async function probe(tabId) {
    const response = await bounded(chrome.tabs.sendMessage(tabId,{type:'CAE_BRIDGE_PING'},{frameId:0}));
    return response?.ok === true && response?.version === VERSION();
  }
  async function ensure(tabId, options={}) {
    if(!Number.isInteger(tabId)||tabId<0)return {ok:false,reason:'invalid_tab'};
    if(inflight.has(tabId))return inflight.get(tabId);
    const p=(async()=>{
      const tab=await chrome.tabs.get(tabId).catch(()=>null);
      if(!tab || !URL_OK.test(tab.url||'') || tab.discarded)return {ok:false,reason:'ineligible_tab'};
      // Pages still loading receive the declarative script as usual.
      if(tab.status==='loading')return {ok:false,reason:'page_loading'};
      try { if(await probe(tabId)) {lastFailed.delete(tabId);return {ok:true,already:true};} }
      catch(_) { /* This is exactly the expected condition on an old open tab. */ }
      if(lastFailed.get(tabId) > Date.now()-10000 && !options.force)
        return {ok:false,reason:'backoff'};
      if(!chrome.scripting?.executeScript) return {ok:false,reason:'scripting_unavailable'};
      try{
        await chrome.scripting.executeScript({
          target:{tabId,frameIds:[0]},files:FILES,world:'ISOLATED'
        });
        if(!(await probe(tabId)))throw new Error('Injected script did not answer the versioned bridge probe.');
        lastFailed.delete(tabId);
        return {ok:true,injected:true};
      }catch(error){
        lastFailed.set(tabId,Date.now());
        return {ok:false,reason:'injection_failed',error:String(error?.message||error)};
      }
    })().finally(()=>inflight.delete(tabId));
    inflight.set(tabId,p);
    return p;
  }
  async function eligibleOpenTabs() {
    const tabs=await chrome.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*']}).catch(()=>[]);
    // This is only called on install/update, never periodically. Two at a time
    // avoid a burst of injections in profiles with many ChatGPT tabs.
    let cursor=0,seen=0,restored=0;
    const work=async()=>{
      while(cursor<tabs.length){
        const tab=tabs[cursor++];
        if(!tab?.id||tab.discarded||tab.status==='loading')continue;
        const result=await ensure(tab.id);
        seen++;if(result.injected)restored++;
      }
    };
    await Promise.all([work(),work()]);
    return {seen,restored};
  }
  root.ChatArchiveTabBootstrap={ensure,eligibleOpenTabs,probe};
})(typeof globalThis==='object'?globalThis:this);
