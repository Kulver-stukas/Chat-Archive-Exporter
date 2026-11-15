/* One filename/layout policy shared by chat, metadata and source export. */
(function (root) {
  'use strict';
  const safe = (s, max = 65) => {
    let value = ChatArchiveNormalize.safeFilename(s, max).replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = '_' + value;
    return value || 'Untitled';
  };
  const canonical = id => String(id || '').match(/^g-p-[a-f0-9]{32}(?=-|$)/i)?.[0] || String(id || '');
  const isProject = id => /^g-p-[a-f0-9]{32}$/i.test(canonical(id));
  const isGPT = id => /^g-(?!p-)[a-z0-9_-]{6,128}$/i.test(String(id || ''));
  const gptId = id => isGPT(id) ? String(id) : '';
  function gptLabel(id, name) {
    const value=String(name||'').trim();
    return value || ('GPT ['+String(id).slice(-10)+']');
  }
  function createLayout(workspaceName, projects = []) {
    const prefix = 'ChatGPT/' + safe(workspaceName || 'Current workspace');
    const groups = new Map();
    const used = new Set(['_unassigned']);
    // Sort by ID, not selection order, for repeatable collision resolution.
    const sorted = [...projects].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    function folder(id, name) {
      id = canonical(id);
      if (!id) return '_Unassigned';
      if (groups.has(id)) return groups.get(id);
      const base = safe(name || `Project_${id.slice(-12)}`);
      let value = base;
      if (used.has(value.toLowerCase())) value = `${base} [${safe(id.slice(-12), 12)}]`;
      let count = 2;
      while (used.has(value.toLowerCase())) value = `${base} [${safe(id.slice(-12), 12)}-${count++}]`;
      groups.set(id, value); used.add(value.toLowerCase()); return value;
    }
    for (const p of sorted) if (p.id) folder(p.id, p.name);
    const projectPath = (id, name) => `${prefix}/${folder(id, name)}`;
    const gptPath = (id, name) => `${prefix}/_GPTs/${safe(gptLabel(id,name),75)} [${safe(String(id).slice(-12),12)}]`;
    return { prefix, folder, projectPath, gptPath, chatPath(item) {
      const base=gptId(item.gptId) ? gptPath(item.gptId,item.gptName) : projectPath(item.projectId,item.project);
      return `${base}/${safe(item.title || 'Untitled chat', 100)} [${safe(item.id, 80)}].md`;
    }};
  }
  const MIME_EXT = {
    'text/plain': '.txt', 'text/markdown': '.md', 'text/html': '.html', 'text/css': '.css',
    'text/csv': '.csv', 'application/json': '.json', 'application/pdf': '.pdf',
    'application/zip': '.zip', 'application/x-zip-compressed': '.zip', 'application/gzip': '.gz',
    'application/msword': '.doc', 'application/vnd.ms-excel': '.xls', 'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
    'image/svg+xml': '.svg', 'application/rtf': '.rtf', 'text/rtf': '.rtf', 'text/x-python': '.py'
  };
  function sourceFilename(name, id, mimeType, used = new Set()) {
    let raw = String(name || id || 'source').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[.\s]+$/g, '').trim();
    const explicitMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
    if (!/\.[^./\\\s]{1,20}$/.test(raw)) raw += MIME_EXT[explicitMime] || '';
    const match = /^(.*?)(\.[^./\\\s]{1,20})$/.exec(raw);
    const extension = match ? match[2] : '';
    let base = safe(match ? match[1] : raw, 120 - extension.length);
    let result = base + extension;
    if (used.has(result.toLowerCase())) result = `${base} [${safe(String(id || 'source').slice(-12), 12)}]${extension}`;
    let n = 2;
    while (used.has(result.toLowerCase())) result = `${base} [${safe(String(id || 'source').slice(-12), 12)}-${n++}]${extension}`;
    used.add(result.toLowerCase()); return result;
  }
  const api = { createLayout, sourceFilename, canonical, safe, isProject, isGPT, gptId, gptLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchivePaths = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
