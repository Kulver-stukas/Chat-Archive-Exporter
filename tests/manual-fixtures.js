'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const {createFakeIndexedDB}=require('./fake-idb');
let mtime=0;
class Missing extends Error{constructor(){super('Missing');this.name='NotFoundError';}}
class FH{
 constructor(name){this.kind='file';this.name=name;this.bytes=new Uint8Array();this.mtime=++mtime;}
 async getFile(){const b=new Blob([this.bytes]);b.lastModified=this.mtime;return b;}
 async createWritable(){const chunks=[],that=this;return {
   write:async x=>chunks.push(typeof x==='string'?new TextEncoder().encode(x):new Uint8Array(x)),
   close:async()=>{const out=new Uint8Array(chunks.reduce((n,x)=>n+x.length,0));let off=0;for(const x of chunks){out.set(x,off);off+=x.length;}that.bytes=out;that.mtime=++mtime;},
   abort:async()=>{}
 };}
}
class Dir{
 constructor(name='Vault'){this.kind='directory';this.name=name;this.children=new Map();this.granted=true;}
 async *entries(){yield* this.children.entries();}
 async getDirectoryHandle(name,opt={}){if(!this.children.has(name)){if(!opt.create)throw new Missing();this.children.set(name,new Dir(name));}return this.children.get(name);}
 async getFileHandle(name,opt={}){if(!this.children.has(name)){if(!opt.create)throw new Missing();this.children.set(name,new FH(name));}return this.children.get(name);}
 async removeEntry(name){if(!this.children.delete(name))throw new Missing();}
 async queryPermission(){return this.granted?'granted':'prompt';}
 async isSameEntry(x){return x===this;}
}
function createEnvironment(){
 const fake=createFakeIndexedDB(),handles=new Map(),root=new Dir(),storage={},calls=[],alarms=new Map(),downloads=[];
 let now=Date.parse('2026-11-12T02:00:00Z'),locked=false,box,controller,err=null;
 const account='workspace-one',pid='g-p-11111111111111111111111111111111';
 const chat=(n,title='Chat '+n)=>({id:`aaaaaaaa-1111-2222-3333-${String(n).padStart(12,'0')}`,title,
   created:'2026-11-01T12:00:00Z',updated:'2026-11-02T12:00:00Z',projectId:pid,project:'Project test'});
 const env={root,handles,storage,calls,downloads,account,pid,chat,context:null,tabAvailable:true,scopeAccount:account,
   blobs:new Map(),remote:new Map(),normalizedChats:new Map(),downloadState:'complete',prepareCalls:0,syncState:{workspaces:{},cooldown_until:0}};
 const chrome={storage:{local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async x=>Object.assign(storage,structuredClone(x))}},
  alarms:{get:async n=>alarms.get(n),create:async(n,x)=>alarms.set(n,x),clear:async n=>alarms.delete(n)},
  tabs:{get:async id=>{if(!env.tabAvailable)throw Error('Missing');return {id,url:'https://chatgpt.com/c/'+chat(1).id,active:true,windowId:1};},query:async()=>[]},
  runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,sendMessage:async m=>{
    if(m.type==='CAE_MANUAL_PREPARE'){env.prepareCalls++;const j=await box.ChatArchiveManualStore.get(m.jobId);
      return {ok:true,result:{url:'blob:chrome-extension://test/'+m.jobId+'-'+env.prepareCalls,filename:j.mode==='current'?'chat.md':'export.zip'}};
    }return {ok:true,result:{held:true}};
  }},
  downloads:{download:async o=>{const d={id:downloads.length+1,url:o.url,state:env.downloadState,...o};downloads.push(d);return d.id;},
    search:async o=>downloads.filter(x=>(o.id==null||x.id===o.id)&&(!o.url||x.url===o.url)),
    cancel:async id=>{const d=downloads.find(x=>x.id===id);if(d)d.state='interrupted';}}
 };
 const locks={request:async(n,o,f)=>{if(locked)return f(null);locked=true;try{return await f({name:n});}finally{locked=false;}}};
 env.reload=()=>{
   const FakeDate=class extends Date{constructor(...x){super(...(x.length?x:[now]));}static now(){return now;}};
   box={console,Blob,Response,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,AbortController,WritableStream,
     structuredClone,atob,btoa,Date:FakeDate,Map,Set,Promise,chrome,crypto:require('node:crypto').webcrypto,
     indexedDB:fake.indexedDB,IDBKeyRange:fake.IDBKeyRange,navigator:{locks},
     setTimeout:(fn,ms)=>{if(ms>800&&ms<=1400){now+=ms;queueMicrotask(fn);}return 1;},clearTimeout(){}};
   vm.createContext(box);
   for(const f of ['export-selection','export-preferences','normalize','hash','paths','meta','sources','vault','vault-transfer','manual-store','manual-attachments'])vm.runInContext(fs.readFileSync(path.join(base,'lib/'+f+'.js'),'utf8'),box);
   box.ChatArchiveManualStore.bind=async(k,h)=>handles.set(k,h);
   box.ChatArchiveManualStore.directory=async k=>handles.get(k)||null;
   box.ChatArchiveVaultContext={ensure:async()=>true,reconcile:async()=>true};
   box.ChatArchiveSync={isRunning:()=>false,_state:()=>env.syncState,wake(){},deferNetwork:async u=>{env.syncState.cooldown_until=u;}};
   box.ChatArchiveSyncRPC={connect:()=>{let source=null,done=false;return {close(){},async call(type,o={}){
     calls.push({type,...structuredClone(o)});
     if(type==='CAE_STATUS')return {accountId:env.scopeAccount,observed:true};
     if(err){const e=err;err=null;throw e;}
     if(env.onCall)await env.onCall(type,o);
     if(type==='CAE_GET_CHAT'){
       if(env.normalizedChats.has(o.chat.id))return structuredClone(env.normalizedChats.get(o.chat.id));
       const x=env.remote.get(o.chat.id)||o.chat;
       return {id:x.id,title:x.title,created:x.created,updated:x.updated,source:'https://chatgpt.com/c/'+x.id,projectId:x.projectId,projectName:x.project,
         messages:[{role:'user',content:'Prompt',time:x.created,text:'Prompt',blocks:[{type:'text',text:'Prompt'}],created:x.created},
                   {role:'assistant',content:x.body||'Response',time:x.updated,text:x.body||'Response',blocks:[{type:'text',text:x.body||'Response'}],created:x.updated}],warnings:[]};
     }
     if(type==='CAE_CONTEXT')return structuredClone(env.context||{captured_at:'2026-11-12T02:00:00Z',projects:[],projects_complete:true,personalization:null,warnings:[]});
     if(type==='CAE_SOURCE_START'||type==='CAE_ATTACHMENT_START'){
       source=env.blobs.get(o.fileId||o.attachment?.fileId||o.attachment?.sandboxPath);done=false;
       if(!source)throw Object.assign(Error('Source HTTP 404'),{httpStatus:404,code:'SOURCE_HTTP'});
       return {contentType:'application/octet-stream'};
     }
     if(type==='CAE_SOURCE_READ'){if(done)return {done:true,totalBytes:source.length};done=true;return {done:false,byteLength:source.length,base64:Buffer.from(source).toString('base64')};}
     if(type==='CAE_SOURCE_CLOSE')return {closed:true};
     throw Error('Unexpected RPC '+type);
   }}}};
   vm.runInContext(fs.readFileSync(path.join(base,'lib/manual-jobs.js'),'utf8'),box);
   controller=box.ChatArchiveManualJobs;env.box=box;env.C=controller;env.S=box.ChatArchiveManualStore;
   return controller;
 };
 env.failNext=e=>{err=e;};env.advance=ms=>{now+=ms;};
 env.opts=(id,items=[chat(1)],destination='vault',mode='all')=>({requestId:id,items,destination,mode,accountId:account,display:'Workspace test',tabId:1,projects:[{id:pid,name:'Project test'}],fullWorkspace:false});
 env.submit=async opts=>{await env.S.bind(opts.requestId,root);return controller.submit(opts);};
 env.drain=async(limit=20)=>{for(let i=0;i<limit;i++){await controller.tick();const j=await controller.inspect();if(!j?.active)return j;
     if(['permission_required','workspace_changed','waiting_for_tab','download_pending','download_failed','delivery_uncertain','error','storage_error','authorization_required','cooldown'].includes(j.status))return j;
     now+=3000;
   }return controller.inspect();};
 env.read=async p=>(await (await box.ChatArchiveVault.lookupFile(root,p)).handle.getFile()).text();
 env.reload();return env;
}
module.exports={createEnvironment,Dir};
