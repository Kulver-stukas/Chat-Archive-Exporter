/* Provider-neutral contracts. No browser, endpoint, storage or DOM dependencies.
 * The legacy wire records are deliberately unchanged in the 0.2.0 parity series.
 * @typedef {{accountId:string, observed:boolean, display:string, currentId?:string, providerId?:string}} Scope
 * @typedef {{providerId:string, accountId:string}} WorkspaceIdentity
 * @typedef {{id:string,title:string,source:string,messages:Array,branchNode?:string,warnings?:Array}} Conversation
 * @typedef {{id?:string,role:string,content:string,attachments?:Array}} Message
 * @typedef {{key:string,messageId:string,origin:string,name?:string,fileId?:string,sandboxPath?:string}} OriginalReference
 * @typedef {{items:Array,cursor?:string|null,warnings?:Array}} Page
 * IDs and cursors are opaque to the generic layer. Original locators remain
 * provider-owned and must be revalidated against the selected branch/message.
 */
(function(root){
  'use strict';
  const idPattern=/^[a-z][a-z0-9_-]{0,63}$/;
  const knownOperations=Object.freeze(['status','listAll','getChat','getWorkspaceSnapshot','sourceLocation','backgroundPage','libraryInventory','libraryPage','assetLocation','attachmentLocation']);
  function verifiedScope(scope, providerId, expectedAccountId, allowLegacy=false){
    return Boolean(scope?.observed && scope.accountId &&
      (scope.providerId===providerId || (allowLegacy && scope.providerId==null)) &&
      (expectedAccountId===undefined || scope.accountId===expectedAccountId));
  }
  function workspaceIdentity(providerId, scope, allowLegacy=false){
    if(typeof providerId!=='string'||!idPattern.test(providerId)||!verifiedScope(scope,providerId,undefined,allowLegacy)||typeof scope.accountId!=='string')return null;
    return Object.freeze({providerId,accountId:scope.accountId});
  }
  function identityKey(identity){
    if(!identity||typeof identity.providerId!=='string'||!idPattern.test(identity.providerId)||typeof identity.accountId!=='string'||!identity.accountId)throw Error('Invalid workspace identity.');
    return JSON.stringify([identity.providerId,identity.accountId]);
  }
  function defineProvider(spec){
    if(!spec||typeof spec.id!=='string'||!idPattern.test(spec.id)||typeof spec.matchesUrl!=='function'||!Array.isArray(spec.hostPatterns)||!spec.hostPatterns.length||!Array.isArray(spec.bridgeFiles)||!Array.isArray(spec.operations)||!spec.operations.includes('status'))throw Error('Invalid provider descriptor.');
    if(new Set(spec.operations).size!==spec.operations.length||spec.operations.some(op=>!knownOperations.includes(op)))throw Error('Unknown or repeated provider operation.');
    return Object.freeze({...spec,hostPatterns:Object.freeze([...spec.hostPatterns]),bridgeFiles:Object.freeze([...spec.bridgeFiles]),operations:Object.freeze([...spec.operations]),capabilities:Object.freeze({...spec.capabilities})});
  }
  function operationClient(descriptor,getImplementation){
    const result=Object.create(null);
    for(const op of descriptor.operations)result[op]=(...args)=>{
      const impl=getImplementation();
      if(typeof impl?.[op]!=='function')throw Error('Provider operation unavailable: '+op);
      return impl[op](...args);
    };
    return Object.freeze(result);
  }
  function createRegistry(descriptors,legacyId){
    const map=new Map();
    for(const entry of descriptors){const d=defineProvider(entry);if(map.has(d.id))throw Error('Duplicate provider: '+d.id);map.set(d.id,d);}
    const legacy=map.get(legacyId);if(!legacy)throw Error('Legacy provider is not registered.');
    return Object.freeze({legacy,get:id=>map.get(id)||null,list:()=>Array.from(map.values()),
      resolve(url){const candidates=Array.from(map.values()).filter(p=>p.matchesUrl(url));return candidates.length===1?candidates[0]:null;},
      isLegacyUrl:(url,options)=>legacy.matchesUrl(url,options)&&Array.from(map.values()).filter(p=>p.matchesUrl(url)).length===1,
      verified:(scope,expectedAccountId)=>verifiedScope(scope,legacy.id,expectedAccountId,true),
      identity:scope=>workspaceIdentity(legacy.id,scope,true),
      legacyApi:getImplementation=>operationClient(legacy,getImplementation)});
  }
  const api=Object.freeze({knownOperations,verifiedScope,workspaceIdentity,identityKey,defineProvider,operationClient,createRegistry});
  root.ChatArchiveProviderContracts=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
