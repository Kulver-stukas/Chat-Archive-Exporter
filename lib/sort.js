/* Date-based conversation ordering. Does not read the network or DOM. */
(function (root) {
  'use strict';
  function timestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      const ms = n < 1e11 ? n * 1000 : n;
      return ms > 0 && ms < 8.64e15 ? ms : null;
    }
    if (typeof value === 'string') {
      const n = Date.parse(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  function chatDate(chat) {
    return timestamp(chat.updated) ?? timestamp(chat.created) ?? null;
  }
  function compareChats(a, b) {
    const ta = chatDate(a), tb = chatDate(b);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    }
    return String(a.title || '').localeCompare(String(b.title || '')) || String(a.id || '').localeCompare(String(b.id || ''));
  }
  function compareGroups(a, b) {
    const ma = a[1].entries.reduce((v, c) => Math.max(v, chatDate(c) ?? -1), -1);
    const mb = b[1].entries.reduce((v, c) => Math.max(v, chatDate(c) ?? -1), -1);
    return mb - ma || String(a[1].name || '').localeCompare(String(b[1].name || '')) || String(a[0]).localeCompare(String(b[0]));
  }
  const api = { timestamp, chatDate, compareChats, compareGroups };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
