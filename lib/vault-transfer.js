/* Sequential byte streaming from the content-script transport to a user-selected
 * File System Access directory, with a durable on-disk index and backpressure.
 * Deliberately no background jobs, deletion or overwrite of locally edited files. */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ maxFileBytes: 512 * 1024 * 1024,
    maxTotalBytes: 1024 * 1024 * 1024, delayMs: 750 });
  async function run(jobs, { transport, vault, expectedAccountId, cancelled = () => false,
    progress = () => {}, limits = LIMITS, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
    if (!expectedAccountId) throw new Error('Vault export requires a verified ChatGPT workspace ID.');
    let receivedBytes = 0, storedBytes = 0, pauseRemaining = false;
    const results = [], counts = { saved: 0, skipped: 0, changed: 0, conflict: 0, failed: 0, cancelled: 0 };
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const r = { key: job.key, project_id: job.projectId, file_id: job.fileId || null,
        name: job.name, expected_bytes: Number.isFinite(job.expectedBytes) ? job.expectedBytes : null,
        status: 'not_attempted', local_path: null, downloaded_bytes: 0, sha256: null, size_matches: null };
      results.push(r);
      const finish = (status, reason) => { r.status = status; if (reason) r.reason = reason; counts[status]++; };
      if (cancelled()) { finish('cancelled', 'Stopped by the user.'); continue; }
      if (pauseRemaining) { finish('skipped', 'Downloads paused after authentication/rate-limit failure.'); continue; }
      if (!job.fileId) { finish('skipped', job.reason || 'No downloadable file ID.'); continue; }
      let decision;
      try { decision = await vault.decideSource(job, expectedAccountId); }
      catch (e) { r.error_name=e.name; finish('failed', 'Vault preflight failed: ' + String(e.message || e).slice(0, 240)); continue; }
      if (decision.path) r.local_path = 'Sources/' + decision.path.split('/Sources/').at(-1);
      if (decision.action === 'skip') {
        finish(decision.status || 'skipped', decision.reason);
        r.sha256 = decision.sha256 || null;
        r.stored_bytes = decision.downloadedBytes ?? null;
        continue;
      }
      const cap = Math.min(limits.maxFileBytes, limits.maxTotalBytes - receivedBytes);
      if (cap <= 0 || (Number.isFinite(job.expectedBytes) && job.expectedBytes > cap)) {
        finish('skipped', `Transfer limit: ${Math.floor(limits.maxFileBytes / 1048576)} MiB/file, ${Math.floor(limits.maxTotalBytes / 1048576)} MiB/run.`); continue;
      }
      progress({ index: i + 1, total: jobs.length, name: job.name, phase: 'start' });
      let target = null, bytes = 0, sourceOpened = false, committed = false;
      try {
        const info = await transport.start({ fileId: job.fileId, projectId: job.projectId,
          maxBytes: cap, expectedAccountId });
        sourceOpened = true;
        r.content_type = info?.contentType || null;
        target = await vault.beginSource(decision, job);
        // The browser may require an inert alias even after initial preflight.
        r.local_path = 'Sources/' + decision.path.split('/Sources/').at(-1);
        const sha = new ChatArchiveHash.Sha256();
        while (true) {
          if (cancelled()) { const err = new Error('Stopped by the user.'); err.code = 'CANCELLED'; throw err; }
          const part = await transport.read();
          if (part.done) {
            if (part.totalBytes !== bytes) throw new Error('Final transfer byte count mismatch.');
            break;
          }
          const chunk = ChatArchiveSources.decode(part.base64, part.byteLength);
          bytes += chunk.byteLength; receivedBytes += chunk.byteLength;
          if (bytes > cap || receivedBytes > limits.maxTotalBytes) {
            const err = new Error('Vault transfer byte limit reached.'); err.code = 'SOURCE_LIMIT'; throw err;
          }
          await target.stream.write(chunk);
          sha.update(chunk);
          progress({ index: i + 1, total: jobs.length, name: job.name, bytes, phase: 'reading' });
        }
        if (cancelled()) { const e = Error('Stopped by the user.'); e.code = 'CANCELLED'; throw e; }
        const sha256 = sha.hex();
        await vault.stageSourceCommit(job, decision, sha256, bytes);
        await target.stream.close();
        committed = true;
        await vault.completeSource(job, decision, target, sha256, bytes);
        r.sha256 = sha256; r.downloaded_bytes = bytes;
        r.size_matches = Number.isFinite(job.expectedBytes) ? bytes === job.expectedBytes : null;
        if (r.size_matches === false) r.warning = 'Downloaded byte count differs from the size returned by the API.';
        r.status = 'saved'; counts.saved++; storedBytes += bytes;
      } catch (e) {
        const code = e.code || 'SOURCE_ERROR';
        const status = cancelled() || code === 'CANCELLED' ? 'cancelled' : code === 'SOURCE_LIMIT' ? 'skipped' : 'failed';
        finish(status, String(e.message || e).slice(0, 350));
        r.error_code = code; r.error_name = e.name; r.http_status = e.httpStatus || null; r.retry_after_ms = e.retryAfterMs || null;
        r.downloaded_bytes = bytes;
        if (committed) r.reason += ' File was written, but the durable index was not updated; inspect the Vault before retrying.';
        if (!committed && target) await vault.abortSource(target);
        if ([401, 403, 429].includes(e.httpStatus) || code === 'AUTH_REQUIRED' || code === 'API_COOLDOWN') pauseRemaining = true;
      } finally {
        if (sourceOpened) await transport.close().catch(() => {});
      }
      progress({ index: i + 1, total: jobs.length, name: job.name, phase: 'done', result: r });
      if (i < jobs.length - 1 && !cancelled() && !pauseRemaining) await pause(limits.delayMs);
    }
    return { limits, counts, received_bytes: receivedBytes, stored_bytes: storedBytes,
      destination: 'vault', results };
  }
  const api = { LIMITS, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveVaultTransfer = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
