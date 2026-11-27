/* ChatGPT-specific URL, route, session and capability rules. Pure functions.
 * The two route recognizers intentionally preserve Beta 2's distinct API and
 * observer semantics; do not broaden the injection allowlist in a refactor. */
(function(root){
  'use strict';
  const C=root.ChatArchiveProviderContracts;
  const hosts=Object.freeze(['https://chatgpt.com/*','https://chat.openai.com/*']);
  const withPath=/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i;
  const eligible=/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i;
  function matchesUrl(url,options={}){return (options.requirePath?withPath:eligible).test(url||'');}
  function accountInfo(session){
    const account=session.account||{};
    const accountId=account.id||session.accountId||'';
    let display=account.name||account.display_name||'';
    if(!display&&accountId)display=`Workspace ${accountId.slice(0,8)}`;
    return {accountId,display:display||'Current workspace',observed:Boolean(account.id)};
  }
  const conversationId=pathname=>(pathname.match(/\/c\/([0-9a-f-]{36})/i)||[])[1]||'';
  const routeProjectId=pathname=>(pathname.match(/\/g\/(g-p-[a-z0-9-]+)\/c\//i)||[])[1];
  const observedConversationId=pathname=>/\/c\/([a-f0-9-]{36})(?:\/|$)/i.exec(pathname)?.[1]||'';
  const observedProjectId=pathname=>/\/g\/(g-p-[a-f0-9]{32})(?:[-/]|$)/i.exec(pathname)?.[1]||'';
  const descriptor=C.defineProvider({id:'chatgpt',displayName:'ChatGPT',hostPatterns:hosts,matchesUrl,
    accountInfo,conversationId,routeProjectId,observedConversationId,observedProjectId,
    // Declarative and recovery injection use the same ordered bridge files.
    bridgeFiles:['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','providers/chatgpt/normalize.js','providers/chatgpt/config-inventory.js','providers/chatgpt/original-policy.js','lib/source-transfer.js','providers/chatgpt/library-inventory.js','providers/chatgpt/http.js','providers/chatgpt/api.js','content.js','sync-watch.js'],
    operations:C.knownOperations,
    capabilities:{conversations:true,projects:true,customGpts:true,library:true,images:true,configuration:true,schedules:true,backgroundMonitoring:true,selectiveExport:true,originals:true,visibleThinking:true}});
  root.ChatArchiveChatGPTDescriptor=descriptor;
})(globalThis);
