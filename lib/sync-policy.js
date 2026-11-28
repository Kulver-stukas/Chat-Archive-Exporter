/* Pure enrollment rules. A later update does NOT make an old object new. */
(function(root) {
  'use strict';
  const INTERVALS = Object.freeze({ alarmMinutes: 1, chatsMs: 15*60_000, projectsMs: 6*3600_000, configMs: 24*3600_000,
    activeDebounceMs: 5000, activeMinMs: 60000, requestGapMs: 2000, retryMs: 2*60_000,
    maxTasks: 4, maxTickMs: 25000, maxQueue: 10000, maxSourceBytes: 128*1024*1024 });
  function timestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
      const n=Number(value); return Number.isFinite(n)&&n>0 ? Math.round(n<1e11?n*1000:n) : null;
    }
    const n=Date.parse(value); return Number.isFinite(n)?n:null;
  }
  function eligible(config, exists, created, now=Date.now()) {
    if (exists) return true;
    const since=timestamp(config.new_since), at=timestamp(created);
    return config.enrollment==='tracked_and_new' && since!==null && at!==null && at>since && at<=now+300000;
  }
  function sameRevision(item, record) {
    const updated=timestamp(item.updated);
    return !!record && updated!==null && (record.listed_updated_ms===updated ||
      (Number.isFinite(record.updated_ms)&&updated<=record.updated_ms)) &&
      String(record.title||'')===String(item.title||'') &&
      String(record.project_id||'')===String(item.projectId||'') &&
      (typeof item.archived!=='boolean'||Boolean(record.archived)===item.archived) &&
      (!item.gptId||String(record.gpt_id||'')===String(item.gptId)) &&
      (!item.gptName||String(record.gpt_name||'')===String(item.gptName));
  }
  function enqueue(cfg, task) {
    cfg.queue ||= [];
    const prior=cfg.queue.find(t=>t.id===task.id);
    if (prior) {
      // Keep the server cooldown/retry deadline. Fresh payload may replace stale
      // list metadata, but a hint must not bypass a bounded retry.
      Object.assign(prior, task, {notBefore:Math.max(prior.notBefore||0,task.notBefore||0), attempts:prior.attempts||0,_revision:(prior._revision||0)+1});
      return false;
    }
    if(cfg.queue.length>=INTERVALS.maxQueue) throw new Error('Background queue limit reached; pause and reduce the tracked scope.');
    cfg.queue.push({...task, attempts:0,_revision:1}); return true;
  }
  function backoff(attempt) { return Math.min(30*60_000, INTERVALS.retryMs * 2**Math.max(0,attempt-1)); }
  function retryDelay(error, attempt=1) {
    if(error.code==='API_COOLDOWN'||[429,502,503,504].includes(error.httpStatus))
      return Math.max(60000, Number(error.retryAfterMs)||0) + 1500;
    return backoff(attempt);
  }
  function publicState(cfg) {
    if (!cfg) return {enabled:false,status:'disabled',queue:0};
    return {enabled:cfg.enabled, scope:cfg.scope, enrollment:cfg.enrollment, sources:!!cfg.enabled&&!!cfg.sources,
      since:cfg.new_since||cfg.started_at, startedAt:cfg.started_at, status:cfg.status||'idle',
      message:cfg.message||'', vaultName:cfg.vault_name, trackedChats:cfg.tracked_chats||0,
      queue:cfg.queue?.length||0, buffer:cfg.buffer||{pending:0,conflicts:0,bytes:0}, nextAttempt:cfg.blocked_until||null,
      lastRun:cfg.last_run||null, access:cfg.access||null, totals:cfg.totals||{}, logs:(cfg.logs||[]).slice(-8)};
  }
  const api={INTERVALS,timestamp,eligible,sameRevision,enqueue,backoff,retryDelay,publicState};
  root.ChatArchiveSyncPolicy=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
