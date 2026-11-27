/* ChatGPT original URL allowlist and credential routing. Isolated content only. */
(function(root){
  'use strict';
  function error(code, message, status) {
    const e = new Error(message); e.code = code;
    if (status) e.httpStatus = status;
    return e;
  }
  function policy(downloadUrl, origin, headers) {
    let url;
    try { url = new URL(downloadUrl, origin); } catch { throw error('SOURCE_URL_INVALID', 'Invalid source download URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw error('SOURCE_URL_INVALID', 'Source URL must use HTTPS without embedded credentials.');
    if (url.origin === origin && url.pathname === '/backend-api/estuary/content') {
      return { url: url.href, headers, credentials: 'include', redirect: 'error', cache: 'no-store' };
    }
    const external = /(^|\.)(oaiusercontent\.com|blob\.core\.windows\.net)$/i.test(url.hostname);
    if (external) return { url: url.href, headers: {}, credentials: 'omit', redirect: 'error', cache: 'no-store' };
    throw error('SOURCE_ORIGIN_UNSUPPORTED', 'Unsupported download origin/path; no credentials were sent.');
  }
  root.ChatArchiveChatGPTOriginalPolicy=policy;
  if(typeof module!=='undefined'&&module.exports)module.exports=policy;
})(globalThis);
