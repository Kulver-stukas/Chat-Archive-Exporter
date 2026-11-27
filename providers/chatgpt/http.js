/* ChatGPT isolated-world HTTP client: session, credentials, scope and cooldown.
 * Constructed only by the provider API; the session object stays in this context.
 */
(function(root){
  'use strict';
  function createClient(provider){
  const accountInfo=provider.accountInfo;
  let sessionCache = null;
  let sessionAt = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function getSession(force = false) {
    if (!force && sessionCache && Date.now() - sessionAt < 4 * 60_000) return sessionCache;
    let r;
    try {r=await fetch('/api/auth/session',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)});}
    catch(e){const timeout=['TimeoutError','AbortError'].includes(e?.name);
      throw Object.assign(Error(timeout?'ChatGPT session request timed out.':'ChatGPT session network request failed.'),{code:timeout?'SESSION_TIMEOUT':'NETWORK_ERROR'});}
    if (!r.ok) { const e = new Error(`Session lookup failed (HTTP ${r.status}).`); e.httpStatus = r.status; if ([401, 403].includes(r.status)) e.code = 'AUTH_REQUIRED'; throw e; }
    let j;try{j=await r.json();}catch(e){throw Object.assign(Error('ChatGPT session response was not valid JSON.'),{code:['TimeoutError','AbortError'].includes(e?.name)?'SESSION_TIMEOUT':'SESSION_INVALID_RESPONSE'});}
    if (!j?.accessToken) { const e = new Error('No access token in ChatGPT session. Sign in and reload the page.'); e.httpStatus = 401; e.code = 'AUTH_REQUIRED'; throw e; }
    sessionAt = Date.now();
    sessionCache = j;
    return j;
  }
  let cooldownUntil = 0;
  let lastBackendRequestAt = 0;
  async function getJSON(path, retry = 0, options = {}) {
    if (cooldownUntil > Date.now()) {
      const e = new Error('API cooldown in progress.'); e.code='API_COOLDOWN'; e.httpStatus=429;
      e.retryAfterMs=cooldownUntil-Date.now(); throw e;
    }
    if (options.signal?.aborted) throw new Error('Request cancelled.');
    const session = await getSession(Boolean(retry) || Boolean(options.expectedAccountId) || options.verifyFreshScope===true);
    const info = accountInfo(session);
    if (options.expectedAccountId && options.expectedAccountId !== info.accountId) {
      const e = new Error('Workspace changed; background request stopped.'); e.code='WORKSPACE_CHANGED'; throw e;
    }
    const headers = { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' };
    if (info.accountId) headers['ChatGPT-Account-Id'] = info.accountId;
    const did = document.cookie.match(/(?:^|;\s*)oai-did=([^;]*)/);
    if (did) headers['oai-device-id'] = decodeURIComponent(did[1]);
    let r;
    if (options.background && Date.now()-lastBackendRequestAt < 2000)
      await sleep(2000 - (Date.now()-lastBackendRequestAt));
    lastBackendRequestAt = Date.now();
    try { r = await fetch(path, { credentials: 'include', headers, signal: options.signal || AbortSignal.timeout(45000), redirect: 'error' }); }
    catch (e) { throw new Error(`Network error: ${e.message || e}`); }
    if (r.status === 401 && retry === 0) {
      sessionCache = null;
      return getJSON(path, 1, options);
    }
    if ([429, 502, 503, 504].includes(r.status) && retry < 3) {
      const retryAfter = r.headers.get('retry-after');
      const numeric = retryAfter != null && retryAfter.trim() !== '' ? Number(retryAfter) : NaN;
      const explicitDelay = Number.isFinite(numeric) ? Math.max(0, numeric * 1000) : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : NaN;
      const delay = Number.isFinite(explicitDelay) ? explicitDelay : 1000 * (2 ** retry);
      if (delay > 30000 || options.background) {
        const error = new Error(`API requested a ${Math.ceil(delay / 1000)}s cooldown. Retry this export later.`);
        error.httpStatus = r.status; error.code = 'API_COOLDOWN';
        error.retryAfterMs = r.status === 429 ? Math.max(delay, 60000) : Math.max(delay, 5000);
        cooldownUntil = Date.now() + error.retryAfterMs; throw error;
      }
      await sleep(delay);
      if (options.signal?.aborted) throw new Error('Request cancelled.');
      return getJSON(path, retry + 1, options);
    }
    if (!r.ok) {
      const e = new Error(`ChatGPT API HTTP ${r.status} at ${new URL(path, location.origin).pathname}`);
      e.httpStatus = r.status;
      throw e;
    }
    const type = r.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error(`Unexpected response from ${path} (not JSON).`);
    return await r.json();
  }
  return Object.freeze({getSession,getJSON,sleep});
  }
  root.ChatArchiveChatGPTHttp=Object.freeze({createClient});
})(globalThis);
