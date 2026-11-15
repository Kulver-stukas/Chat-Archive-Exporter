/* Sequential Project Sources ZIP runner. Transport and destination are injectable.
 * Persistent Vault tracking is implemented separately in lib/vault-transfer.js. */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024,
    maxZipBytes: 128 * 1024 * 1024, delayMs: 750 });
  const key = (projectId, fileId) => `${projectId}:${fileId}`;
  function plan(projects, layout) {
    const jobs = [], seen = new Set();
    for (const p of projects) {
      const used = new Set();
      function add(f, source) {
        const id = f.file_id;
        const k = key(p.id, id || `missing-${jobs.length}`);
        if (id && seen.has(k)) return; // One copy per project, references remain in the inventory.
        seen.add(k);
        const filename = ChatArchivePaths.sourceFilename(f.name || source?.name, id, f.mime_type, used);
        jobs.push({ key: k, projectId: p.id, projectName: p.name, fileId: id,
          name: f.name || source?.name || filename, mimeType: f.mime_type, expectedBytes: f.size_bytes,
          path: `${layout.projectPath(p.id, p.name)}/Sources/${filename}`,
          localPath: `Sources/${filename}`, category: source?.provider || f.category || 'unknown',
          attachedAt: f.attached_at || source?.attached_at || null,
          sourceIdentity: source?.scope_id ? `${source.scope_id}:${f.remote_id || f.file_id}` : f.project_save?.save_id || f.library_file_id || f.id || f.file_id,
          sourceModifiedMs: f.source_last_modified_ms ?? null,
          remoteModifiedTime: f.remote_modified_time || null, sourceLocation: f.location || null });
      }
      for (const f of p.files || []) add(f);
      for (const c of p.connectors || []) {
        if (!c.connector_files?.length) jobs.push({ key: key(p.id, c.scope_id || `scope-${jobs.length}`),
          projectId: p.id, name: c.name || c.scope_id || 'Connector source', fileId: null,
          category: c.provider || 'connector', reason: 'No synchronized file is available in this scope.' });
        for (const f of c.connector_files || []) add(f, c);
      }
    }
    return jobs;
  }
  function decode(base64, expected) {
    if (typeof base64 !== 'string' || base64.length > 350000) throw new Error('Invalid or oversized source chunk.');
    const text = atob(base64);
    if (text.length !== expected || text.length > 256 * 1024) throw new Error('Source chunk length mismatch.');
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }
  async function run(jobs, { transport, sink, expectedAccountId = '', cancelled = () => false,
    progress = () => {}, limits = LIMITS, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
    const results = [], counts = { saved: 0, skipped: 0, failed: 0, cancelled: 0 };
    // The transfer budget counts *all received bytes*, including failed files.
    // The retained ZIP budget is checked independently by the sink.
    let receivedBytes = 0, storedBytes = 0, pauseRemaining = false;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const result = { key: job.key, project_id: job.projectId, file_id: job.fileId || null,
        name: job.name, expected_bytes: Number.isFinite(job.expectedBytes) ? job.expectedBytes : null,
        status: 'not_attempted', local_path: null, downloaded_bytes: 0, sha256: null, size_matches: null };
      results.push(result);
      const skip = (reason, status = 'skipped') => { result.status = status; result.reason = reason; counts[status]++; };
      if (cancelled()) { skip('Stopped by the user.', 'cancelled'); continue; }
      if (pauseRemaining) { skip('Remaining downloads deferred after an authentication/rate-limit error.'); continue; }
      if (!job.fileId) { skip(job.reason || 'No downloadable file_id returned by the API.'); continue; }
      const remaining = Math.min(limits.maxTotalBytes - receivedBytes, sink.remainingBytes - 1024 * 1024);
      const cap = Math.max(0, Math.min(limits.maxFileBytes, remaining));
      if (!cap || (Number.isFinite(job.expectedBytes) && job.expectedBytes > cap)) {
        skip('Test limit: 25 MiB per file, 100 MiB source-transfer budget, 128 MiB ZIP budget.'); continue;
      }
      progress({ index: i + 1, total: jobs.length, name: job.name, phase: 'start' });
      let chunks = [], size = 0;
      try {
        const response = await transport.start({ fileId: job.fileId, projectId: job.projectId,
          maxBytes: cap, expectedAccountId });
        result.content_type = response?.contentType || null;
        while (true) {
          if (cancelled()) { const e = new Error('Stopped by the user.'); e.code = 'CANCELLED'; throw e; }
          const part = await transport.read();
          if (part.done) {
            if (part.totalBytes !== size) throw new Error('Final source byte count mismatch.');
            break;
          }
          const bytes = decode(part.base64, part.byteLength);
          size += bytes.byteLength; receivedBytes += bytes.byteLength;
          if (size > cap || receivedBytes > limits.maxTotalBytes) throw new Error('Source transfer byte budget exceeded.');
          chunks.push(bytes);
          progress({ index: i + 1, total: jobs.length, name: job.name, bytes: size, phase: 'reading' });
        }
        // Only ONE bounded source is materialized for SHA-256. The source is not
        // decoded as text and never inspected to infer a file format.
        const blob = new Blob(chunks); chunks = [];
        const buffer = await blob.arrayBuffer();
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
        if (cancelled()) { const e = new Error('Stopped by the user.'); e.code = 'CANCELLED'; throw e; }
        await sink.add({ path: job.path, bytes: new Uint8Array(buffer), store: true });
        result.status = 'saved'; result.local_path = job.localPath; result.downloaded_bytes = size;
        result.sha256 = Array.from(hash, x => x.toString(16).padStart(2, '0')).join('');
        result.size_matches = Number.isFinite(job.expectedBytes) ? size === job.expectedBytes : null;
        if (result.size_matches === false) result.warning = 'Downloaded byte count differs from API size metadata; actual bytes preserved.';
        storedBytes += size; counts.saved++;
      } catch (error) {
        result.status = cancelled() || error.code === 'CANCELLED' ? 'cancelled' : error.code === 'SOURCE_LIMIT' || error.code === 'ZIP_LIMIT' ? 'skipped' : 'failed';
        result.error_code = error.code || 'SOURCE_ERROR'; result.error_name = error.name;
        result.http_status = error.httpStatus || null; result.retry_after_ms = error.retryAfterMs || null;
        result.reason = String(error.message || error).slice(0, 500);
        result.downloaded_bytes = size; counts[result.status]++;
        if ([401, 429].includes(error.httpStatus) || error.code === 'AUTH_REQUIRED') pauseRemaining = true;
      } finally { chunks = []; await transport.close().catch(() => {}); }
      progress({ index: i + 1, total: jobs.length, name: job.name, phase: 'done', result });
      if (i < jobs.length - 1 && !cancelled() && !pauseRemaining) await pause(limits.delayMs);
    }
    return { limits, counts, received_bytes: receivedBytes, stored_bytes: storedBytes, results };
  }
  const api = { LIMITS, plan, run, key, decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveSources = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
