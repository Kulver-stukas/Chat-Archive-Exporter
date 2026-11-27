/* Load the same provider composition as the browser entrypoints in VM fixtures. */
'use strict';
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const files=['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'];
function boot(context){
  if(!vm.isContext(context))vm.createContext(context);
  if(!context.ChatArchiveProviders)for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  return context;
}
module.exports={boot,files};
