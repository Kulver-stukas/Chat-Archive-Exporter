'use strict';
const {createEnvironment}=require('./manual-fixtures');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const fid=n=>'file_'+String(n).padStart(32,'0');
const pid='g-p-11111111111111111111111111111111';
function createLibraryEnvironment(){
  const e=createEnvironment(),reload=e.reload;
  e.libHandles=new Map();e.rootRows=[];e.folders={};e.projectRefs=[];e.gallery=[];e.detailMap={};e.assetErrors={};e.assetMime={};e.libCalls=[];
  e.prefix='ChatGPT/Workspace test';
  e.reload=()=>{
    reload();
    for(const f of ['../providers/chatgpt/library-inventory','library-policy','library-store','library-vault'])
      vm.runInContext(fs.readFileSync(path.join(base,'lib/'+f+'.js'),'utf8'),e.box);
    e.LS=e.box.ChatArchiveLibraryStore;
    e.LS.bind=async(id,dir)=>e.libHandles.set(id,dir);
    e.LS.directory=async id=>e.libHandles.get(id)||null;
    e.box.ChatArchiveSyncRPC={connect:()=>{let bytes=null,done=false,closed=false;return {close(){closed=true;},async call(type,o={}){
      if(closed)throw Error('Disconnected');
      e.libCalls.push({type,...structuredClone(o)});
      if(e.beforeLibCall)await e.beforeLibCall(type,o);
      if(type==='CAE_STATUS')return {accountId:e.scopeAccount,observed:true};
      if(o.expectedAccountId!==e.scopeAccount)throw Object.assign(Error('Workspace changed'),{code:'WORKSPACE_CHANGED'});
      if(type==='CAE_LIBRARY_PAGE'){
        const q=o.query,I=e.box.ChatArchiveLibraryInventory;
        if(e.pageError){const x=e.pageError;e.pageError=null;throw x;}
        if(q.kind==='projects')return {items:e.projectRefs.length?[{id:pid,name:'Project test'}]:[],cursor:null};
        if(q.kind==='project_refs')return {refs:structuredClone(e.projectRefs)};
        if(q.kind==='nodes'){
          const rows=q.parent?(e.folders[q.parent]||[]):e.rootRows;
          const n=Number(q.cursor||0),slice=rows.slice(n,n+2);
          return {items:slice.map(x=>I.fromNode(x)).filter(Boolean),cursor:n+2<rows.length?String(n+2):null};
        }
        if(q.kind==='images')return {items:e.gallery.map(I.fromImage).filter(Boolean),cursor:null};
        if(q.kind==='details')return {items:q.fileIds.map(id=>e.detailMap[id]?{file_id:id,detail:I.fromDetail(e.detailMap[id])}:{file_id:id,error:{code:'UNAVAILABLE',http_status:404}})};
        throw Error('Unexpected operation '+q.kind);
      }
      if(type==='CAE_ASSET_START'){
        if(e.assetErrors[o.fileId])throw e.assetErrors[o.fileId];
        bytes=e.blobs.get(o.fileId);done=false;
        if(!bytes)throw Object.assign(Error('Original not found'),{httpStatus:404,code:'SOURCE_HTTP'});
        return {contentType:e.assetMime[o.fileId]||'application/octet-stream',contentLength:bytes.length};
      }
      if(type==='CAE_SOURCE_READ'){
        if(done)return {done:true,totalBytes:bytes.length};done=true;
        return {done:false,base64:Buffer.from(bytes).toString('base64'),byteLength:bytes.length};
      }
      if(type==='CAE_SOURCE_CLOSE')return {};
      throw Error('Unexpected RPC '+type);
    }}}};
    vm.runInContext(fs.readFileSync(path.join(base,'lib/library-jobs.js'),'utf8'),e.box);
    e.L=e.box.ChatArchiveLibraryJobs;
    return e.L;
  };
  e.node=(n,name='file'+n+'.txt',extra={})=>({id:'libfile_'+String(n).padStart(20,'0'),file_id:fid(n),kind:'file',name,
    parent_directory_id:'libdir_root',mime_type:'text/plain',file_size_bytes:3,record_creation_time:'2026-11-01T12:00:00Z',...extra});
  e.image=(n)=>({id:'s_'+String(n).padStart(20,'0'),file_id:fid(n),title:'Image '+n,created_at:'2026-11-01T12:00:00Z'});
  e.ref=(n)=>({type:'project_source',project_id:pid,project_name:'Project test',source_record_id:'source_'+n,
    file_id:fid(n),library_file_id:'libfile_'+String(n).padStart(20,'0')});
  e.start=async(monitor=false)=>{await e.LS.bind(e.account,e.root);return e.L.start({accountId:e.account,display:'Workspace test',tabId:1,monitor});};
  e.drainLib=async(n=20)=>{for(let i=0;i<n;i++){await e.L.tick();const v=await e.L.inspect(e.account);
    if(!v?.job?.active||['waiting_for_tab','permission_required','retry_wait','cooldown'].includes(v.job.status))return v;}
    return e.L.inspect(e.account);
  };
  e.reload();return e;
}
module.exports={createLibraryEnvironment,fid,pid};
