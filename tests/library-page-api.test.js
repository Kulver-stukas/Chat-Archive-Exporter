'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A='workspace-A',fid='file_00000000000000000000000000000001',pid='g-p-11111111111111111111111111111111';
let scope=A,flip=false;const calls=[];
const box={window:{},document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/c/example'},console,Map,Set,Date,URL,AbortSignal,setTimeout,clearTimeout,
 fetch:async(path,opts={})=>{
  calls.push({path,opts});
  if(path==='/api/auth/session')return Response.json({accessToken:'PRIVATE-TOKEN',account:{id:scope,name:'Work'}});
  assert.equal(opts.headers['ChatGPT-Account-Id'],A);
  if(flip)scope='workspace-B';
  if(path.startsWith('/backend-api/files/library/nodes'))return Response.json({items:[{id:'libfile_11111111',kind:'file',file_id:fid,name:'test.md',parent_directory_id:'libdir_root',download_url:'PRIVATE-URL',owner_id:'PRIVATE-OWNER'}],cursor:null});
  if(path==='/backend-api/files/'+fid)return Response.json({id:fid,use_case:'caas',size:3,metadata:{source_ip:'PRIVATE-IP',upload_source:'user',use_case:'caas'}});
  if(path.startsWith('/backend-api/files/download/'))return Response.json({download_url:'https://chatgpt.com/backend-api/estuary/content?id='+fid+'&sig=PRIVATE-SIGNATURE'});
  throw Error('Unexpected route '+path);
 }};
vm.createContext(box);for(const f of ['library-inventory','config-inventory','api'])vm.runInContext(fs.readFileSync(__dirname+'/../lib/'+f+'.js','utf8'),box);
(async()=>{
 const api=box.window.ChatArchiveApi;
 let r=await api.libraryPage({kind:'nodes'},A);assert.equal(r.items.length,1);assert(!JSON.stringify(r).includes('PRIVATE'));
 r=await api.libraryPage({kind:'details',fileIds:[fid]},A);assert.equal(r.items[0].detail.use_case,'caas');assert(!JSON.stringify(r).includes('PRIVATE'));
 await assert.rejects(api.libraryPage({kind:'nodes',parent:'../other'},A),/Invalid directory/);
 await assert.rejects(api.libraryPage({kind:'details',fileIds:['notafile']},A),/Invalid descriptor/);
 await assert.rejects(api.libraryPage({kind:'nodes',parent:'libdir_wrong'},A),/mismatched/);
 // Signed URL and auth are only returned to the local content-script reader, never to callers of libraryPage.
 const loc=await api.assetLocation(fid,A);assert(loc.downloadUrl.includes('PRIVATE-SIGNATURE'));assert.equal(loc.headers.Authorization,'Bearer PRIVATE-TOKEN');
 flip=true;await assert.rejects(api.libraryPage({kind:'nodes'},A),/Workspace changed/);
 const count=calls.filter(x=>x.path.startsWith('/backend-api')).length;
 await assert.rejects(api.libraryPage({kind:'details',fileIds:[fid]},A),/Workspace changed/);
 assert.equal(calls.filter(x=>x.path.startsWith('/backend-api')).length,count);
 assert(!calls.some(x=>/accounts\/check|memories|\/backend-api\/pages/.test(x.path)));
 console.log('PASS: bounded Library API, sanitized metadata, strict route validation, pre/post scope checks, isolated original URL resolution');
})().catch(e=>{console.error(e);process.exitCode=1;});
