/* Legacy ChatGPT presentation policy and generated-file link syntax.
 * No network or browser dependencies. No authorization is conferred by a link.
 */
(function(root){
  'use strict';
  const {outsideCode}=root.ChatArchiveMarkdownPrimitives||require('../../lib/markdown-primitives.js');
  function safeSandboxPath(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    let path = value.replace(/^sandbox:/, '');
    try { path = decodeURIComponent(path); } catch { return null; }
    if (!path.startsWith('/mnt/data/') || /[\\\x00-\x1f\x7f?#]/.test(path) ||
        path.split('/').slice(1).some(part => part === '.' || part === '..' || !part)) return null;
    if (path.endsWith('/')) return null;
    return path;
  }

  // Read only real Markdown links in prose. Examples inside fenced/inline code
  // remain examples and cannot authorize a file read.
  function mapSandboxLinks(text, transform) {
    return outsideCode(String(text || ''), prose => prose.replace(
      /(!?)\[([^\]\n]*(?:\\\][^\]\n]*)*)\]\(\s*(?:<(sandbox:\/[^>\r\n]+)>|(sandbox:\/(?:\\.|[^()\s]|\([^()]*\))+))\s*\)/g,
      (whole, image, label, angle, plain) => transform({whole, image:!!image, label,
        raw:angle || plain, path:safeSandboxPath(angle || plain)})));
  }

  const profile=Object.freeze({providerId:'chatgpt',displayName:'ChatGPT',
    defaultSource:chat=>'https://chatgpt.com/c/'+chat.id,
    mapSandboxLinks,safeSandboxPath});
  root.ChatArchiveChatGPTMarkdownProfile=profile;
  if(typeof module!=='undefined'&&module.exports)module.exports=profile;
})(globalThis);
