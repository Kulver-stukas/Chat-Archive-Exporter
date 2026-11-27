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
  const providerApi=globalThis.ChatArchiveProviders.legacyApi(()=>globalThis.ChatArchiveApi);
  const allowedTypes = new Set(['CAE_STATUS', 'CAE_LIST', 'CAE_GET_CHAT', 'CAE_CONTEXT',
    'CAE_SOURCE_START', 'CAE_SOURCE_READ', 'CAE_SOURCE_CLOSE', 'CAE_BG_PAGE', 'CAE_LIBRARY_INVENTORY', 'CAE_LIBRARY_PAGE', 'CAE_LIBRARY_CANCEL', 'CAE_ASSET_START', 'CAE_ATTACHMENT_START']);
  let sourceOwner = null;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'CAE_API' || (port.sender?.id && port.sender.id !== chrome.runtime.id)) return;
    let transfer = null, controller = null, sourceTimer = null, disconnected = false, inventoryController = null;
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
      inventoryController?.abort();
      closeSource().catch(() => {});
    });
    const send = (id, payload) => { if (!disconnected) try { port.postMessage({ id, ...payload }); } catch (_error) {} };
    port.onMessage.addListener(async msg => {
      if (!msg || !allowedTypes.has(msg.type) || !Number.isInteger(msg.id)) return;
      try {
        if (msg.type === 'CAE_SOURCE_CLOSE') { await closeSource(); send(msg.id, { result: { closed: true } }); }
        else if (['CAE_SOURCE_START','CAE_ASSET_START','CAE_ATTACHMENT_START'].includes(msg.type)) {
          if (sourceOwner) throw new Error('Another source transfer is still active in this tab.');
          sourceOwner = port;
          const abort = new AbortController(); controller = abort;
          const vaultTransfer = Number(msg.maxBytes) > 25 * 1024 * 1024;
          sourceTimer = setTimeout(() => abort.abort(), vaultTransfer ? 20 * 60_000 : 120000);
          try {
            const location = msg.type === 'CAE_ATTACHMENT_START'
              ? await providerApi.attachmentLocation(msg.attachment, msg.expectedAccountId || '', abort.signal)
              : msg.type === 'CAE_ASSET_START'
              ? await providerApi.assetLocation(msg.fileId, msg.expectedAccountId || '', abort.signal)
              : await providerApi.sourceLocation(msg.fileId, msg.projectId, msg.expectedAccountId || '', abort.signal, Boolean(msg.background));
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
        } else if (msg.type === 'CAE_LIBRARY_CANCEL') {
          inventoryController?.abort(); send(msg.id, {result:{stopped:true}});
        } else if (msg.type === 'CAE_LIBRARY_PAGE' || msg.type === 'CAE_LIBRARY_INVENTORY') {
          if(inventoryController)throw Error('A Library operation is already active on this connection.');
          inventoryController=new AbortController();
          try {send(msg.id,{result:msg.type==='CAE_LIBRARY_PAGE'
            ? await providerApi.libraryPage(msg.query||{},msg.expectedAccountId||'',inventoryController.signal)
            : await providerApi.libraryInventory(msg.expectedAccountId||'',p=>send(msg.id,{progress:p}),{signal:inventoryController.signal})});}
          finally {inventoryController=null;}
        } else if (msg.type === 'CAE_STATUS') send(msg.id, { result: await providerApi.status(Boolean(msg.force)) });
        else if (msg.type === 'CAE_BG_PAGE') send(msg.id, { result: await providerApi.backgroundPage(msg.query || {}, msg.expectedAccountId || '') });
        else if (msg.type === 'CAE_LIST') {
          const result = await providerApi.listAll(state => send(msg.id, { progress: state }));
          send(msg.id, { result });
        } else if (msg.type === 'CAE_CONTEXT') {
          send(msg.id, { result: await providerApi.getWorkspaceSnapshot(msg.expectedAccountId || '',
            state => send(msg.id, { progress: state }), {
              projectIds: Array.isArray(msg.projectIds) ? msg.projectIds : null,
              includePersonalization: msg.includePersonalization !== false,
              includeConfiguration: msg.includeConfiguration !== false,
              observedGpts: Array.isArray(msg.observedGpts) ? msg.observedGpts : []
            }) });
        } else if (msg.type === 'CAE_GET_CHAT') {
          if (!msg.chat?.id || !/^[a-zA-Z0-9-]{10,100}$/.test(msg.chat.id)) throw new Error('Invalid chat identifier.');
          send(msg.id, { result: await providerApi.getChat(msg.chat, msg.expectedAccountId, {background:Boolean(msg.background)}) });
        }
      } catch (error) { send(msg.id, { error: String(error?.message || error),
        errorCode: error?.code || null, httpStatus: error?.httpStatus || null, retryAfterMs: error?.retryAfterMs || null }); }
    });
  });

  // Export controls live in the popup and side panel. Remove a legacy button
  // left by an older content-script context without installing page UI/timers.
  const retireLegacyButton=()=>document.getElementById('cae-inpage-button')?.remove();
  retireLegacyButton();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',retireLegacyButton,{once:true});
})();
