/* Transitional legacy facade for existing render callers and CommonJS tests.
 * No raw payload parsing here. The raw decoder is absent from worker/UI pages.
 * Remove this facade when generic job routing is migrated in rev.4.
 */
(function(root){
  'use strict';
  const node=typeof module!=='undefined'&&module.exports;
  const profile=root.ChatArchiveChatGPTMarkdownProfile||(node?require('../providers/chatgpt/markdown-profile.js'):null);
  const renderer=root.ChatArchiveMarkdown||(node?require('./markdown.js'):null);
  const decoder=root.ChatArchiveChatGPTNormalize||(node?require('../providers/chatgpt/normalize.js'):null);
  if(!renderer||!profile)throw Error('Markdown dependencies unavailable. Reload extension.');
  const output=renderer.createRenderer(profile);
  const api=Object.freeze({...decoder,...output});
  root.ChatArchiveNormalize=api;
  if(node)module.exports=api;
})(globalThis);
