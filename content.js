(() => {
  'use strict';
  // A running tab survives extension updates, but its previous content-script
  // context does not. Programmatic re-injection is safe and idempotent.
  const runningVersion = chrome.runtime.getManifest?.()?.version || '0.1.6.4';
  if (globalThis.__CAE_CONTENT_BOOT_VERSION === runningVersion) return;
  globalThis.__CAE_CONTENT_BOOT_VERSION = runningVersion;
  chrome.runtime.onMessage?.addListener((msg, sender, reply) => {
    if (msg?.type !== 'CAE_BRIDGE_PING' ||
        (sender?.id && sender.id !== chrome.runtime.id)) return false;
    reply({ ok: true, version: runningVersion });
    return false;
  });
  const allowedTypes = new Set(['CAE_STATUS', 'CAE_LIST', 'CAE_GET_CHAT', 'CAE_CONTEXT',
    'CAE_SOURCE_START', 'CAE_SOURCE_READ', 'CAE_SOURCE_CLOSE', 'CAE_BG_PAGE']);
  let sourceOwner = null;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'CAE_API' || (port.sender?.id && port.sender.id !== chrome.runtime.id)) return;
    let transfer = null, controller = null, sourceTimer = null, disconnected = false;
    const closeSource = async () => {
      controller?.abort(); controller = null; clearTimeout(sourceTimer);
      if (transfer) await transfer.close();
      transfer = null;
      if (sourceOwner === port) sourceOwner = null;
    };
    port.onDisconnect?.addListener(() => {
      // Consume a Port transport error when the opposite context disappears.
      void chrome.runtime.lastError?.message;
      disconnected = true;
      closeSource().catch(() => {});
    });
    const send = (id, payload) => { if (!disconnected) try { port.postMessage({ id, ...payload }); } catch (_error) {} };
    port.onMessage.addListener(async msg => {
      if (!msg || !allowedTypes.has(msg.type) || !Number.isInteger(msg.id)) return;
      try {
        if (msg.type === 'CAE_SOURCE_CLOSE') { await closeSource(); send(msg.id, { result: { closed: true } }); }
        else if (msg.type === 'CAE_SOURCE_START') {
          if (sourceOwner) throw new Error('Another source transfer is still active in this tab.');
          sourceOwner = port;
          const abort = new AbortController(); controller = abort;
          const vaultTransfer = Number(msg.maxBytes) > 25 * 1024 * 1024;
          sourceTimer = setTimeout(() => abort.abort(), vaultTransfer ? 20 * 60_000 : 120000);
          try {
            const location = await ChatArchiveApi.sourceLocation(msg.fileId, msg.projectId, msg.expectedAccountId || '', abort.signal, Boolean(msg.background));
            if (abort.signal.aborted || disconnected) throw new Error('Source transfer cancelled.');
            transfer = ChatArchiveSourceTransfer.createTransport({ timeoutMs: vaultTransfer ? 20 * 60_000 : 120000 });
            send(msg.id, { result: await transfer.open({ ...location, maxBytes: msg.maxBytes, signal: abort.signal }) });
          } catch (error) { await closeSource(); throw error; }
        } else if (msg.type === 'CAE_SOURCE_READ') {
          if (!transfer) throw new Error('No source transfer is open.');
          try {
            const result = await transfer.read();
            if (result.done) await closeSource();
            send(msg.id, { result });
          } catch (error) { await closeSource(); throw error; }
        } else if (msg.type === 'CAE_STATUS') send(msg.id, { result: await ChatArchiveApi.status(Boolean(msg.force)) });
        else if (msg.type === 'CAE_BG_PAGE') send(msg.id, { result: await ChatArchiveApi.backgroundPage(msg.query || {}, msg.expectedAccountId || '') });
        else if (msg.type === 'CAE_LIST') {
          const result = await ChatArchiveApi.listAll(state => send(msg.id, { progress: state }));
          send(msg.id, { result });
        } else if (msg.type === 'CAE_CONTEXT') {
          send(msg.id, { result: await ChatArchiveApi.getWorkspaceSnapshot(msg.expectedAccountId || '',
            state => send(msg.id, { progress: state }), {
              projectIds: Array.isArray(msg.projectIds) ? msg.projectIds : null,
              includePersonalization: msg.includePersonalization !== false,
              includeConfiguration: msg.includeConfiguration !== false,
              observedGpts: Array.isArray(msg.observedGpts) ? msg.observedGpts : []
            }) });
        } else if (msg.type === 'CAE_GET_CHAT') {
          if (!msg.chat?.id || !/^[a-zA-Z0-9-]{10,100}$/.test(msg.chat.id)) throw new Error('Invalid chat identifier.');
          send(msg.id, { result: await ChatArchiveApi.getChat(msg.chat, msg.expectedAccountId, {background:Boolean(msg.background)}) });
        }
      } catch (error) { send(msg.id, { error: String(error?.message || error),
        errorCode: error?.code || null, httpStatus: error?.httpStatus || null, retryAfterMs: error?.retryAfterMs || null }); }
    });
  });

  function inject() {
    if (!document.body) return;
    const previous = document.getElementById('cae-inpage-button');
    if (previous?.dataset?.caeVersion === runningVersion) return;
    // Retire a stale button installed by a previous extension version. Its
    // click handler belongs to an invalidated extension context.
    previous?.remove();
    const btn = document.createElement('button');
    btn.id = 'cae-inpage-button';
    if (btn.dataset) btn.dataset.caeVersion = runningVersion;
    btn.type = 'button';
    btn.textContent = '↓ MD';
    btn.title = 'Export the current ChatGPT conversation as Markdown';
    Object.assign(btn.style, { position: 'fixed', zIndex: '2147483640', bottom: '112px', right: '22px',
      padding: '8px 12px', borderRadius: '11px', border: '1px solid #7775', background: '#282b30',
      color: 'white', font: '600 12px system-ui,sans-serif', cursor: 'pointer', boxShadow: '0 4px 16px #0003' });
    btn.addEventListener('click', async ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Exporting…';
      try {
        const response=await chrome.runtime.sendMessage({type:'CAE_MANUAL_QUICK'});
        if(!response?.ok)throw new Error(response?.error||'Manual export controller unavailable.');
        btn.textContent='Queued';
        btn.title='Export accepted. You may close the panel; keep a ChatGPT tab available for pending reads.';
      } catch (e) {
        btn.title = String(e?.message || e);
        btn.textContent = 'Error';
        console.warn('Chat Archive Exporter:', e);
      } finally {
        setTimeout(() => { btn.textContent = '↓ MD'; btn.disabled = false; }, 1600);
      }
    });
    document.body.appendChild(btn);
  }
  function refresh() {
    // Polling the route at a bounded cadence avoids observing the full dynamic
    // ChatGPT DOM. No export or network activity is triggered by this routine.
    const hasChat = /\/c\/[0-9a-f-]{36}(?:\/|$)/i.test(location.pathname);
    const button = document.getElementById('cae-inpage-button');
    if (!hasChat) { if (button) button.remove(); return; }
    if (!button || button.dataset?.caeVersion !== runningVersion) inject();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
  window.addEventListener('popstate', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  // SPA route transitions do not necessarily generate popstate events.
  // 1.5s polling is fixed-cost and skips hidden tabs.
  const routeTimer = setInterval(() => {
    // Old extension contexts are invalidated on an update. A new build may
    // re-inject its own bridge; do not let this obsolete timer run forever.
    let usable = false;
    try { usable = Boolean(chrome.runtime?.id); } catch (_) {}
    if (!usable) { clearInterval(routeTimer); return; }
    if (document.visibilityState === 'visible' && document.body) refresh();
  }, 1500);
})();
