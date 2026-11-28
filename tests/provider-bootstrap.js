/* Load the same provider composition as the browser entrypoints in VM fixtures. */
'use strict';
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const files=['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'];
function boot(context){
  if(!vm.isContext(context))vm.createContext(context);
  if(!context.ChatArchiveProviders)for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  for(const file of ["contracts/resources.js", "providers/chatgpt/storage-profile.js", "providers/chatgpt/job-profile.js", "providers/chatgpt/background-inventory.js", "providers/chatgpt/library-scan.js", "lib/job-transport.js", "providers/chatgpt/project-metadata.js", "lib/markdown-primitives.js", "providers/chatgpt/markdown-profile.js", "lib/markdown.js", "providers/chatgpt/normalize.js", "lib/normalize.js", "providers/chatgpt/config-inventory.js", "providers/chatgpt/library-inventory.js", "providers/chatgpt/http.js", "providers/chatgpt/original-policy.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  return context;
}
module.exports={boot,files};
