/* Logical resource identities; no file, browser or provider dependencies.
 * These keys are coordination metadata, NOT a new persisted index format. */
(function(root){
  'use strict';
  const provider=/^[a-z][a-z0-9_-]{0,63}$/;
  const scalar=s=>typeof s==='string'&&s.length>0&&s.length<=512&&!/[\x00-\x1f]/.test(s);
  function key(providerId,workspaceId,kind,id){
    if(!provider.test(providerId||'')||workspaceId!==null&&!scalar(workspaceId)||!scalar(kind)||!scalar(id))throw Error('Invalid resource identity.');
    if(kind==='provider_tree'&&workspaceId!==null||kind==='workspace_tree'&&workspaceId===null)throw Error('Invalid resource scope.');
    return JSON.stringify([providerId,workspaceId,kind,id]);
  }
  function parse(value){
    if(typeof value!=='string'||value.length>1600)throw Error('Invalid resource key.');
    const t=JSON.parse(value);if(!Array.isArray(t)||t.length!==4||key(...t)!==value)throw Error('Invalid resource key.');return t;
  }
  function overlaps(left,right){
    const a=parse(left),b=parse(right);
    if(a[0]!==b[0])return false;
    if(a[2]==='provider_tree'||b[2]==='provider_tree')return true;
    if(a[1]!==b[1])return false;
    if(a[2]==='workspace_tree'||b[2]==='workspace_tree')return true;
    return a[2]===b[2]&&a[3]===b[3];
  }
  function conflicts(left,right){
    // Unknown or empty resource sets never establish disjointness.
    try{if(!Array.isArray(left)||!Array.isArray(right)||!left.length||!right.length||left.length>64||right.length>64)return true;
      left.forEach(parse);right.forEach(parse);return left.some(a=>right.some(b=>overlaps(a,b)));
    }catch{return true;}
  }
  const api=Object.freeze({key,parse,overlaps,conflicts});root.CAEResources=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
