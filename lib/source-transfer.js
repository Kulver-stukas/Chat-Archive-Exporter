/* Authenticated source reader with backpressure. Loaded in the ISOLATED content
 * script; bearer tokens and signed URLs are never sent to the panel. */
(function (root) {
  'use strict';
  const MAX_FILE_BYTES = 512 * 1024 * 1024; // Vault upper safety bound; ZIP supplies its own 25 MiB cap.
  const CHUNK_BYTES = 256 * 1024;
  function error(code, message, status) {
    const e = new Error(message); e.code = code;
    if (status) e.httpStatus = status;
    return e;
  }
  function encodeChunk(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  function createTransport({ fetchImpl = (...args) => fetch(...args), timeoutMs = 120000, authorize } = {}) {
    if(typeof authorize!=='function')throw error('SOURCE_POLICY_REQUIRED','A provider original-transfer policy is required.');
    let active = null;
    async function close() {
      const value = active; active = null;
      if (!value) return;
      value.controller.abort(); clearTimeout(value.timer);
      value.signal?.removeEventListener('abort', value.abort);
      value.pending = null;
      try { await value.reader?.cancel(); } catch { /* Already closed. */ }
    }
    async function open({ downloadUrl, origin, headers, maxBytes = MAX_FILE_BYTES, signal }) {
      if (active) throw error('SOURCE_BUSY', 'Another source is still downloading in this tab.');
      const opts = authorize(downloadUrl, origin, headers);
      const cap = Math.min(MAX_FILE_BYTES, Number(maxBytes));
      if (!Number.isFinite(cap) || cap < 0) throw error('SOURCE_LIMIT', 'No source byte budget remains.');
      const controller = new AbortController();
      const transfer = { controller, reader: null, pending: null, offset: 0, received: 0, sent: 0, cap, reading: false, signal };
      transfer.abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', transfer.abort, { once: true });
      transfer.timer = setTimeout(() => controller.abort(), timeoutMs);
      active = transfer;
      try {
        const { url, ...options } = opts;
        const res = await fetchImpl(url, { ...options, signal: controller.signal });
        if (!res.ok) {
          const retryAfter = res.headers.get('retry-after');
          const number = retryAfter != null && retryAfter.trim() !== '' ? Number(retryAfter) : NaN;
          const delay = Number.isFinite(number) ? number * 1000 : Date.parse(retryAfter || '') - Date.now();
          try { await res.body?.cancel(); } catch {}
          const e = error('SOURCE_HTTP', `Source content HTTP ${res.status}.`, res.status);
          if (Number.isFinite(delay)) e.retryAfterMs = Math.max(0, delay);
          throw e;
        }
        if (!res.body?.getReader) throw error('SOURCE_STREAM_UNAVAILABLE', 'Streaming response is not available.');
        const length = res.headers.get('content-length');
        const expectedLength = length != null && /^\d+$/.test(length) ? Number(length) : null;
        // Content-Length can refer to compressed HTTP bytes; enforce the cap again
        // against the actual decoded byte stream. No MIME sniffing is performed.
        if (!res.headers.get('content-encoding') && expectedLength != null && expectedLength > cap) {
          try { await res.body.cancel(); } catch {}
          throw error('SOURCE_LIMIT', 'Source exceeds the configured file/remaining-byte limit.');
        }
        transfer.reader = res.body.getReader();
        return { contentType: res.headers.get('content-type') || null, contentLength: expectedLength };
      } catch (e) {
        const aborted = controller.signal.aborted;
        await close();
        if (typeof e.code === 'string' && e.code.startsWith('SOURCE_')) throw e;
        if (aborted) throw error('SOURCE_ABORTED', 'Source transfer cancelled or timed out.');
        // Never put signed URLs or arbitrary response payloads into diagnostics.
        throw error('SOURCE_NETWORK', 'Source request failed (network, CORS, or a blocked redirect).');
      }
    }
    async function read() {
      const t = active;
      if (!t?.reader) throw error('SOURCE_NOT_OPEN', 'No source transfer is open.');
      if (t.reading) throw error('SOURCE_BUSY', 'A source chunk is already being read.');
      t.reading = true;
      try {
        if (t.controller.signal.aborted) throw error('SOURCE_ABORTED', 'Source transfer cancelled or timed out.');
        while (!t.pending || t.offset === t.pending.byteLength) {
          const next = await t.reader.read();
          if (next.done) { const totalBytes = t.sent; await close(); return { done: true, totalBytes }; }
          if (!(next.value instanceof Uint8Array)) throw error('SOURCE_STREAM_INVALID', 'Unexpected source stream chunk.');
          t.received += next.value.byteLength;
          if (t.received > t.cap) throw error('SOURCE_LIMIT', 'Source exceeded the configured file/remaining-byte limit while reading.');
          t.pending = next.value; t.offset = 0;
        }
        const end = Math.min(t.pending.byteLength, t.offset + CHUNK_BYTES);
        const part = t.pending.subarray(t.offset, end);
        const base64 = encodeChunk(part);
        t.offset = end; t.sent += part.byteLength;
        return { done: false, base64, byteLength: part.byteLength, totalBytes: t.sent };
      } catch (e) {
        const aborted = t.controller.signal.aborted;
        await close();
        if (typeof e.code === 'string' && e.code.startsWith('SOURCE_')) throw e;
        throw error(aborted ? 'SOURCE_ABORTED' : 'SOURCE_NETWORK', 'Source stream stopped or timed out.');
      } finally { t.reading = false; }
    }
    return { open, read, close };
  }
  const api = { createTransport, MAX_FILE_BYTES, CHUNK_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveSourceTransfer = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
