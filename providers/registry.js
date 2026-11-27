/* Composition root. Only ChatGPT is registered in the parity release.
 * All persisted records are legacy ChatGPT records; do not route a legacy job
 * to a newly installed adapter merely because its host matches. */
(function(root){
  'use strict';
  root.ChatArchiveProviders=root.ChatArchiveProviderContracts.createRegistry([root.ChatArchiveChatGPTDescriptor],'chatgpt');
})(globalThis);
