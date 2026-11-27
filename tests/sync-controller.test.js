'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const fakeIDB=require('./fake-idb').createFakeIndexedDB();
let now=Date.parse('2026-11-09T20:00:00Z'),mtime=0;
class Missing extends Error{constructor(){super('Missing');this.name='NotFoundError';}}
class FH{constructor(name){this.name=name;this.bytes=new Uint8Array();this.mtime=++mtime;}
 async getFile(){const b=new Blob([this.bytes]);b.lastModified=this.mtime;return b;}
 async createWritable(){const chunks=[];const that=this;return new WritableStream({write(x){chunks.push(typeof x==='string'?new TextEncoder().encode(x):new Uint8Array(x));},close(){const out=new Uint8Array(chunks.reduce((n,x)=>n+x.length,0));let off=0;for(const x of chunks){out.set(x,off);off+=x.length;}that.bytes=out;that.mtime=++mtime;}});}}
// Production uses writable.write/close, whereas stream copy uses pipeTo. Expose both.
const orig=FH.prototype.createWritable;FH.prototype.createWritable=async function(){const s=await orig.call(this);s.write=async x=>{const w=s.getWriter();try{await w.write(x);}finally{w.releaseLock();}};s.close=async()=>{const w=s.getWriter();try{await w.close();}finally{w.releaseLock();}};return s;};
class Dir{constructor(name='Vault'){this.name=name;this.children=new Map();this.granted=true;}
 async getDirectoryHandle(name,opt={}){if(!this.children.has(name)){if(!opt.create)throw new Missing();this.children.set(name,new Dir(name));}const x=this.children.get(name);if(!(x instanceof Dir))throw Error('Not directory');return x;}
 async getFileHandle(name,opt={}){if(!this.children.has(name)){if(!opt.create)throw new Missing();this.children.set(name,new FH(name));}return this.children.get(name);}
 async removeEntry(name){if(!this.children.delete(name))throw new Missing();}
 async queryPermission(){return this.granted?'granted':'denied';}
 async isSameEntry(x){return x===this;}}
const root=new Dir(),db=new Map(),storage={},calls=[],alarms=new Map();
let lockHeld=false,errNext=null,connectorFail=false;const binarySources=new Map(),detailOverrides=new Map();const waiters=[];
const locks={request:async(name,opts,cb)=>{if(opts.ifAvailable&&lockHeld)return cb(null);if(lockHeld)await new Promise(r=>waiters.push(r));lockHeld=true;try{return await cb({name});}finally{lockHeld=false;waiters.shift()?.();}}};
const account='account-one',pid='g-p-11111111111111111111111111111111';let scopeAccount=account;
let remote=[],projects=[],schedulePrompt='Archived full prompt',scheduleFail=false,activeTab={id:1,active:true,windowId:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444'};
const chrome={storage:{local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async x=>Object.assign(storage,structuredClone(x))}},
 alarms:{get:async n=>alarms.get(n),create:async(n,x)=>alarms.set(n,x),clear:async n=>alarms.delete(n)},
 tabs:{get:async id=>{if(id!==1)throw Error('Missing tab');return activeTab;},query:async()=>[activeTab],sendMessage:async()=>({ok:true})},
 windows:{get:async()=>({focused:true})}};
let s;
function instance(){
 const FakeDate=class extends Date{constructor(...x){super(...(x.length?x:[now]));}static now(){return now;}};
 const sandbox={console,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,AbortController,WritableStream,
  structuredClone,atob,btoa,Date:FakeDate,Map,Set,Promise,chrome,
  indexedDB:fakeIDB.indexedDB,IDBKeyRange:fakeIDB.IDBKeyRange,navigator:{locks},crypto:require('node:crypto').webcrypto,
  setTimeout:(fn,ms)=>{if(ms===2000){now+=ms;queueMicrotask(fn);}return 1;},clearTimeout(){}};
 vm.createContext(sandbox);
 for(const f of ['normalize','config-inventory','hash','paths','meta','sources','vault','vault-transfer','sync-policy','sync-spool'])vm.runInContext(fs.readFileSync(path.join(base,'lib/'+f+'.js'),'utf8'),sandbox);
 sandbox.ChatArchiveVault.rememberDirectory=async h=>db.set('selected',h);
 sandbox.ChatArchiveVault.restoreDirectory=async()=>db.get('selected')||null;
 sandbox.ChatArchiveVault.rememberWorkspaceDirectory=async(a,h)=>db.set(a,h);
 sandbox.ChatArchiveVault.restoreWorkspaceDirectory=async a=>db.get(a)||null;
 sandbox.ChatArchiveSyncRPC={connect:()=>{let transfer=null;return {close(){},async call(type,opts={}){
   calls.push({type,...structuredClone(opts)});
   if(type==='CAE_STATUS')return {accountId:scopeAccount,observed:true,display:'Workspace test',currentId:activeTab.url.split('/').at(-1)};
   if(errNext){const e=errNext;errNext=null;throw e;}
   if(type==='CAE_BG_PAGE'){
     const q=opts.query;
     if(q.kind==='config_identity')return {account_id:account,scope_type:'workspace',user_name:'Test User',
       workspace_name:'Test Workspace',display_name:'Test Workspace (Test User)',complete:true};
     if(q.kind==='config_gpts')return {status:'partial',complete:false,items:[
       {id:'g-bundled123456',name:'GPT sample',source:'current_scope_bootstrap'}]};
     if(q.kind==='config_schedules'){
       if(scheduleFail&&q.bucket==='paused')throw Error('Schedules API temporarily unavailable');
       return {items:q.bucket==='scheduled'&&schedulePrompt?[{id:'Automation_d1',
         title:'Current schedule',prompt:schedulePrompt,bucket:'scheduled',
         is_enabled:true,schedule:'BEGIN:VEVENT\nRRULE:FREQ=DAILY\nEND:VEVENT'}]:[],cursor:null};
     }
     if(q.kind==='config_plugins')return {items:q.scope==='GLOBAL'?[{id:'plugin-id',slug:'demo',name:'User Plugin',
       status:'ENABLED',scope:'GLOBAL',workspace_id:null,version:'1.0',installed_at:'2026-11-11T00:00:00Z',
       skills:[{id:'skill-id',name:'bundle',display_name:'Bundled Skill'}]}]:[],next_page_token:null};
     if(q.kind==='projects')return {items:projects,cursor:null};
     if(q.kind==='connectors'){if(connectorFail)throw Error('Simulated incomplete connector inventory');return {items:[],cursor:null};}
     if(['chats','project_chats'].includes(q.kind))return {items:q.archived?[]:remote,cursor:null,nextOffset:null};
     throw Error('Unexpected operation '+q.kind);
   }
   if(type==='CAE_GET_CHAT'){
     const x=detailOverrides.get(opts.chat.id)||remote.find(x=>x.id===opts.chat.id)||opts.chat;
     return {id:x.id,title:x.title,created:x.created,updated:x.updated,projectId:x.projectId||'',projectName:x.project||'',source:'https://chatgpt.com/c/'+x.id,messages:[{role:'user',text:x.detailText||'test body',blocks:[{type:'text',text:x.detailText||'test'}],created:x.created}],warnings:[]};
   }
   if(type==='CAE_SOURCE_START'){transfer=binarySources.get(opts.fileId);if(!transfer)throw Error('No fixture bytes');return {contentType:'application/octet-stream'};}
   if(type==='CAE_SOURCE_READ'){if(!transfer)return {done:true,totalBytes:17};const b=transfer;transfer=null;return {done:false,base64:Buffer.from(b).toString('base64'),byteLength:b.length};}
   if(type==='CAE_SOURCE_CLOSE')return {closed:true};
   throw Error('Unexpected RPC '+type);
 }}}};
 vm.runInContext(fs.readFileSync(path.join(base,'lib/sync.js'),'utf8'),sandbox);
 s=sandbox;return sandbox.ChatArchiveSync;
}
const chat=(id,title,created,updated)=>({id,title,created,updated,projectId:pid,project:'Project test'});
const archived=chat('aaaaaaaa-1111-2222-3333-444444444444','Archived','2026-01-01T00:00:00Z','2026-11-01T00:00:00Z');
const old=chat('bbbbbbbb-1111-2222-3333-444444444444','Old untracked','2026-01-01T00:00:00Z','2026-11-09T20:00:00Z');
const markdown=x=>'---\ntitle: '+JSON.stringify(x.title)+'\nprovider: chatgpt\nworkspace: "Workspace test"\nproject: "Project test"\nconversation_id: '+JSON.stringify(x.id)+'\nsource: "https://chatgpt.com/g/'+pid+'/c/'+x.id+'"\ncreated: '+JSON.stringify(x.created)+'\nupdated: '+JSON.stringify(x.updated)+'\nexported: "2026-11-09T19:00:00Z"\n---\n\nBody\n';
async function drain(C){for(let n=0;n<30;n++){await C.tick();const c=C._state()?.workspaces[account];if(!c?.queue?.length)break;now+=60000;}}
(async()=>{
 let C=instance();await C.startup();await C.tick();assert.equal(calls.length,0,'default off must not contact ChatGPT');assert.equal(alarms.size,0);
 await s.ChatArchiveVault.rememberDirectory(root);
 const opts={accountId:account,display:'Workspace test',tabId:1,scope:'workspace',enrollment:'tracked',sources:false};
 await assert.rejects(C.enable(opts),/at least one chat/);
 let vault=await s.ChatArchiveVault.openStore(root);const layout=s.ChatArchivePaths.createLayout('Workspace test',[{id:pid,name:'Project test'}]);
 await vault.useWorkspace(layout.prefix,account);
 // A metadata-only first export (empty Project or configuration snapshot)
 // is a verified seed; it never permits importing unrelated old chats.
 const configPath=layout.prefix+'/_workspace_configuration.json';
 const seed=s.ChatArchiveMeta.renderWorkspaceConfiguration({active_scope:{account_id:account},
   projects:[],projects_complete:true},'2026-11-09T20:00:00Z');
 await vault.writeText(configPath,seed,{kind:'metadata',key:account+'|'+configPath});
 await C.enable({...opts,display:'Workspace account fallback',enrollment:'tracked_and_new'});
 assert.equal(C._state().workspaces[account].prefix,layout.prefix,'reconnect existing configuration under changed display name');
 assert.equal((await C.inspect(account)).enabled,true,'configuration-only seed can enable background tracking');
 await C.pause(account);await new Promise(r=>setImmediate(r));
 await vault.writeText(layout.chatPath(archived),markdown(archived),{kind:'chats',key:account+'|'+archived.id,remoteChat:archived});
 const rawProject={gizmo:{id:pid,workspace_id:account,display:{name:'Project test'},created_at:'2026-01-01T00:00:00Z'},files:[],connectors:[],connector_scopes_complete:true};
 const pp=layout.projectPath(pid,'Project test')+'/_project.md';
 await vault.writeText(pp,s.ChatArchiveMeta.renderProject(s.ChatArchiveMeta.normalizeProject(rawProject),'2026-11-09'),{kind:'metadata',key:account+'|'+pp});
 assert.equal((await vault.knownProjects(layout.prefix,account)).length,1,'must recognize existing table-based project metadata');
 projects=[rawProject];remote=[archived,old];calls.length=0;
 await C.enable(opts);
 // Older versions could enqueue GPT gizmo IDs as Project conversation inventories.
 C._state().workspaces[account].queue.push({id:'project-chats:g-EngflyTutor123456:0',
   kind:'project_chats',projectId:'g-EngflyTutor123456',cursor:'0',page:0,seen:[]});
 await drain(C);
 assert(!C._state().workspaces[account].queue.some(x=>x.kind==='project_chats'&&x.projectId==='g-EngflyTutor123456'),
   'stale GPT-as-Project jobs are removed without retry');
 assert(!calls.some(x=>x.query?.kind==='project_chats'&&x.query?.projectId==='g-EngflyTutor123456'),
   'invalid GPT Project endpoint is never called');
 assert.equal(calls.filter(x=>x.type==='CAE_GET_CHAT').length,0,'unchanged tracked and historical untracked chat must not fetch content');
 assert.equal(alarms.size,1);
 const conf=await s.ChatArchiveVault.readJson(root,layout.prefix+'/_workspace_configuration.json');
 assert(conf?.plugins?.items?.some(x=>x.name==='User Plugin'),
   'background controller must persist the current-scope explicit plugin inventory');
 assert(conf.skills.items.some(x=>x.name==='bundle'),'bundled Skills must be recorded');
 assert(conf.schedules.complete===true&&conf.schedules.items.length===1,
   'background configuration includes active-scope Schedules');
 assert.equal(conf.active_scope.account_id,account);
 assert(!JSON.stringify(conf).includes('memories'));
 assert(!calls.some(x=>String(x.query?.kind||'').includes('accounts/check')));
 const since=C._state().workspaces[account].started_at;
 await C.pause(account);await new Promise(r=>setImmediate(r));
 const before=calls.length;await C.tick();assert.equal(calls.length,before);assert.equal(alarms.size,0);
 now+=60000;await C.enable({...opts,enrollment:'tracked_and_new'});
 assert.equal(C._state().workspaces[account].started_at,since,'first activation is durable');
 const cutoff=C._state().workspaces[account].new_since;
 now+=1000;
 const fresh=chat('cccccccc-1111-2222-3333-444444444444','New chat',new Date(now).toISOString(),new Date(now).toISOString());
 remote=[archived,old,fresh];calls.length=0;await drain(C);
 assert(!calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===fresh.id),
   'new placeholder title must not create a permanent New chat file');
 remote=[archived,old,{...fresh,title:'Final published chat title'}];
 C._state().workspaces[account].next_chat_scan=0;
 await drain(C);
 assert(calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===fresh.id),
   'eligible chat is saved once the actual title is available');
 assert(!calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===old.id),'old updated remains excluded');
 let ws=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');assert(ws.chats[fresh.id]);
 C=instance();await C.startup();assert.equal(C._state().workspaces[account].new_since,cutoff,'worker restart retains cutoff');
 // A verified IndexedDB mirror permits metadata capture even without Vault permission.
 C._state().workspaces[account].next_config_scan=0;
 root.granted=false;const n=calls.length;await C.tick();
 assert(!calls.slice(n).some(x=>x.query?.kind?.startsWith('config_')),
   'no configuration polling without a writable Vault');
 assert(!calls.slice(n).some(x=>x.type==='CAE_GET_CHAT'),'unchanged chats do not trigger unnecessary body requests while denied');
 assert.equal((await C.inspect(account)).status,'permission_denied');
 // Capture a complete archived chat while the selected Vault is denied.
 // The user may update/reload the extension without losing this response.
 const beforeOffline=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 const offlineItem={...archived,updated:new Date(now+5000).toISOString()};
 const newWhileDenied=chat('dddddddd-1111-2222-3333-444444444444','Created without Vault',
   new Date(now+2000).toISOString(),new Date(now+3000).toISOString());
 remote=[offlineItem,old,fresh,newWhileDenied];detailOverrides.set(archived.id,{...offlineItem,detailText:'reply received while Vault permission denied'});
 let offlineCfg=C._state().workspaces[account];
 offlineCfg.queue=[{id:'chat:'+archived.id,kind:'chat',item:offlineItem,notBefore:0,attempts:0},
   {id:'chat:'+old.id,kind:'chat',item:{...old,updated:new Date(now+5000).toISOString()},notBefore:0,attempts:0},
   {id:'chat:'+newWhileDenied.id,kind:'chat',item:newWhileDenied,notBefore:0,attempts:0}];
 offlineCfg.next_chat_scan=offlineCfg.next_project_scan=now+99999999;
 calls.length=0;await C.tick();
 assert(calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===archived.id),
   'verified mirror permits content capture with no Vault permission');
 assert.equal((await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json')).chats[archived.id].sha256,
   beforeOffline.chats[archived.id].sha256,'disk index is not modified while access denied');
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).pending,2,'archived and newly created chats are buffered');
 assert(!calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===old.id),
   'old unarchived chat updated while offline is still excluded');
 C=instance();await C.startup();
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).pending,2,'worker restart retains completed captures');
 const recoveredCfg=C._state().workspaces[account];
 recoveredCfg.queue=[{id:'chat:'+archived.id,kind:'chat',item:offlineItem,notBefore:0,attempts:0},
   {id:'chat:'+newWhileDenied.id,kind:'chat',item:newWhileDenied,notBefore:0,attempts:0}];
 recoveredCfg.next_chat_scan=recoveredCfg.next_project_scan=now+99999999;
 calls.length=0;await C.tick();
 assert(!calls.some(x=>x.type==='CAE_GET_CHAT'),'identical remote revision is not downloaded twice while buffered');
 // Drain requires only the Vault grant, not a currently connected ChatGPT tab.
 root.granted=true;activeTab.url='https://example.invalid/';now+=120000;
 await C.tick();
 const afterOffline=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 assert.notEqual(afterOffline.chats[archived.id].sha256,beforeOffline.chats[archived.id].sha256,
   'buffered Markdown is committed when permission returns');
 assert(afterOffline.chats[newWhileDenied.id], 'post-cutoff newly created chat can be buffered and committed');
 assert(!afterOffline.chats[old.id], 'old unarchived history is not accidentally enrolled');
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).pending,0,'spool is removed after verified disk/index commit');
 assert.equal(C._state().workspaces[account].status,'waiting_for_tab',
   'subsequent API jobs wait for a ChatGPT tab while disk draining succeeds');
 activeTab.url='https://chatgpt.com/c/'+archived.id;detailOverrides.delete(archived.id);
 now+=120000;C._state().workspaces[account].blocked_until=0;
 // Prior tests below continue with the original normal background scenarios.

 let cfg=C._state().workspaces[account];cfg.queue=[{id:'chat:'+archived.id,kind:'chat',item:{...archived,updated:new Date(now).toISOString()},notBefore:0,attempts:0}];cfg.next_chat_scan=cfg.next_project_scan=now+99999999;
 errNext=Object.assign(Error('Cooldown'),{code:'API_COOLDOWN',httpStatus:429,retryAfterMs:44000});
 await C.tick();assert.equal(cfg.status,'cooldown');assert(cfg.queue.some(t=>t.id==='chat:'+archived.id),'cooldown retains the chat job');
 const count=calls.length;await C.tick();assert.equal(calls.length,count,'cooldown does not cascade through other jobs');
 now+=120000;cfg.blocked_until=0;C._state().cooldown_until=0;
 const lock=await s.ChatArchiveVault.acquireLock();const lockCalls=calls.length;await C.tick();assert.equal(calls.length,lockCalls);assert.equal(cfg.status,'manual_export');lock();
 // A suspended tab may time out even while the disk grant remains valid.
 // Preserve its remote job as a recoverable tab wait, not a red fatal error.
 cfg.queue=[{id:'chat:'+archived.id,kind:'chat',item:{...archived,updated:new Date(now+240000).toISOString()},notBefore:0,attempts:0}];
 cfg.blocked_until=0;errNext=Error('Background API request timed out.');
 await C.tick();assert.equal(cfg.status,'waiting_for_tab');
 assert(cfg.queue.some(x=>x.kind==='chat'&&x.item?.id===archived.id),
   'suspended tab timeout keeps the pending remote job');
 assert(cfg.logs.at(-1).message.includes('task retained'), 'timeout is a retryable wait');
 cfg.queue=[];cfg.blocked_until=0;
 await C.pause(account);await new Promise(r=>setImmediate(r));

 // Active/previously active streaming chat: no full body until completion.
 now+=120000;await C.enable({...opts,scope:'active'});
 calls.length=0;await C.armTab(1);
 remote=[{...archived,updated:new Date(now).toISOString()},old];
 await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'stream',streaming:true,sampledAt:now});
 await C.tick();assert(!calls.some(x=>x.type==='CAE_GET_CHAT'));
 now+=10000;
 // Simulate MV3 worker termination. The previous tab is now hidden and the
 // in-memory armed Map is gone. A completion event must restore its binding
 // from the persisted pending/last-active state without a tab activation.
 activeTab.active=false;
 C=instance();
 const scopeChecksBefore=calls.filter(x=>x.type==='CAE_STATUS').length;
 const recovered=await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'final',streaming:false,sampledAt:now});
 assert(recovered?.accepted,'post-restart message from the formerly active tab is accepted');
 assert.equal(calls.filter(x=>x.type==='CAE_STATUS').length,scopeChecksBefore+1,
   'cold tab binding is authenticated once');
 await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'final',streaming:false,sampledAt:now});
 assert.equal(calls.filter(x=>x.type==='CAE_STATUS').length,scopeChecksBefore+1,
   'subsequent signals reuse the recovered binding');
 now+=10000;await drain(C);
 assert(calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===archived.id),'completion retained even after the worker restarts and tab is hidden');
 // Another workspace must never inherit a durable tab id.
 C=instance();scopeAccount='other-account';
 const rejected=await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'unauthorized',streaming:false,sampledAt:now+1});
 assert.equal(rejected.accepted,false,'workspace mismatch rejects a resurrected tab binding');
 scopeAccount=account;activeTab.active=true;
 await C.pause(account);await new Promise(r=>setImmediate(r));
 // The UI can finish a new answer before the conversation-list updated marker
 // propagates. One bounded recheck must eventually fetch the archived chat.
 now+=120000;C=instance();await C.enable({...opts,scope:'active'});
 const cfgStale=C._state().workspaces[account];
 cfgStale.next_chat_scan=cfgStale.next_project_scan=now+99999999;cfgStale.queue=[];
 await C.armTab(1);
 const previousLedger=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 const oldVersion=previousLedger.chats[archived.id];
 remote=[{...archived,updated:oldVersion.updated},old];
 detailOverrides.set(archived.id,{...archived,updated:new Date(now+40000).toISOString(),detailText:'fresh model answer'});
 calls.length=0;
 await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'new-stream',streaming:true,sampledAt:now});
 now+=20000;
 await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'new-final',streaming:false,sampledAt:now});
 now+=10000;await C.tick();
 assert(!calls.some(x=>x.type==='CAE_GET_CHAT'), 'initial unchanged list marker does not fetch full detail');
 assert(cfgStale.queue.some(x=>x.id.startsWith('hint-recheck:')), 'one targeted metadata retry is queued');
 now+=25000;await drain(C);
 assert.equal(calls.filter(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===archived.id).length,1,
   'stale list marker forces exactly one detail verification after retry');
 const latest=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 assert(latest.chats[archived.id].updated_ms>oldVersion.updated_ms,
   'fresh model answer is committed even when list metadata was stale');
 // A cosmetic page change can emit a completion-like signal. A forced detail
 // check must preserve an identical archived file and its original export time.
 now+=120000;
 await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'cosmetic-stream',streaming:true,sampledAt:now});
 now+=20000;
 await C.signal(1,{conversationId:archived.id,projectId:pid,signature:'cosmetic-final',streaming:false,sampledAt:now});
 now+=10000;await C.tick();now+=25000;await drain(C);
 const unchanged=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 assert.equal(unchanged.chats[archived.id].sha256,latest.chats[archived.id].sha256,
   'unchanged chat content keeps the same SHA even after a forced verification');
 assert.equal(unchanged.chats[archived.id].exported,latest.chats[archived.id].exported,
   'an event-only verification never alters the archived export timestamp');
 detailOverrides.delete(archived.id);
 await C.pause(account);await new Promise(r=>setImmediate(r));
 // Binary Sources: registered old file + a new attachment + an old untracked
 // attachment. Only the truly new attachment is downloaded in future mode.
 now+=120000;await C.enable({...opts,enrollment:'tracked_and_new',sources:true});
 const freshCutoff=Date.parse(C._state().workspaces[account].new_since);now=Math.max(now,freshCutoff+1000);
 const source=(id,name,created)=>({file_id:id,id:id+'_attachment',name,type:'application/octet-stream',size:17,
   created_at:created,last_modified:123,location:'fs',metadata:{knowledge_store_info:{source_kind:'uploaded_file'}}});
 const saved=source('file_saved','original.bin','2026-01-01T00:00:00Z'),never=source('file_old','old.bin','2026-01-01T00:00:00Z'),added=source('file_new','new.bin',new Date(now).toISOString());
 const bytes=new Uint8Array(17).fill(219);binarySources.set('file_new',bytes);
 let v=await s.ChatArchiveVault.openStore(root);await v.useWorkspace(layout.prefix,account);
 const j=s.ChatArchiveSources.plan([s.ChatArchiveMeta.normalizeProject({...rawProject,files:[saved]})],layout)[0];
 const d=await v.decideSource(j,account),target=await v.beginSource(d);await target.stream.write(bytes);await target.stream.close();await v.completeSource(j,d,target,s.ChatArchiveHash.hex(bytes),17);
 projects=[{...rawProject,files:[saved,never,added]}];calls.length=0;await drain(C);
 const starts=calls.filter(x=>x.type==='CAE_SOURCE_START').map(x=>x.fileId);
 assert.deepEqual(starts,['file_new'],'only post-cutoff new source is transferred');
 v=await s.ChatArchiveVault.openStore(root);assert.equal(v.index.sources[account+'|'+pid+':file_new'].bytes,17);
 assert(!v.index.sources[account+'|'+pid+':file_old']);
 // Source removal requires two COMPLETE inventories, not two retries or one
 // incomplete connector response; the old file is copied and verified first.
 projects=[{...rawProject,files:[never,added]}];cfg=C._state().workspaces[account];
 now+=6*3600_000;cfg.next_project_scan=0;await drain(C);
 v=await s.ChatArchiveVault.openStore(root);assert(!v.index.sources[account+'|'+pid+':file_saved'].deleted_at);
 connectorFail=true;now+=6*3600_000;cfg.next_project_scan=0;await C.tick();
 v=await s.ChatArchiveVault.openStore(root);assert(!v.index.sources[account+'|'+pid+':file_saved'].deleted_at,'incomplete inventories never remove');
 connectorFail=false;now+=6*3600_000;cfg.next_project_scan=0;await drain(C);
 v=await s.ChatArchiveVault.openStore(root);const removed=v.index.sources[account+'|'+pid+':file_saved'];
 assert(removed.deleted_at&&removed.path.includes('/deleted/'));
 assert.equal(await s.ChatArchiveVault.lookupFile(root,removed.previous_path),null);
 assert.equal((await (await s.ChatArchiveVault.lookupFile(root,removed.path)).handle.getFile()).size,17);
 // Missing completion events (same-tab navigation / frozen renderer): bounded
 // fallback still verifies enrollment and saves a server-finished tracked chat.
 remote=remote.map(x=>x.id===archived.id?{...x,updated:new Date(now+1000).toISOString()}:x);
 await C.signal(1,{conversationId:archived.id,projectId:pid,streaming:true,signature:'stale-stream'});
 calls.length=0;now+=3*60_000;await drain(C);
 assert(calls.some(x=>x.type==='CAE_GET_CHAT'&&x.chat.id===archived.id),'stale pending must recover without a DOM completion event');
 // A locally edited file must not be overwritten when a pending full Markdown
 // capture drains. The conflicting capture is retained, not marked committed.
 let dLedger=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 const archivedPath=dLedger.chats[archived.id].path;
 const localModification='USER LOCAL EDIT: do not overwrite';
 root.granted=false;cfg=C._state().workspaces[account];cfg.status='permission_denied';cfg.blocked_until=0;
 cfg.queue=[{id:'chat:'+archived.id,kind:'chat',
   item:{...archived,updated:new Date(now+30000).toISOString()},notBefore:0,attempts:0}];
 cfg.next_chat_scan=cfg.next_project_scan=now+99999999;
 detailOverrides.set(archived.id,{...archived,updated:new Date(now+30000).toISOString(),detailText:'buffered text not yet delivered'});
 await C.tick();
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).pending,1,'edited-file test creates staged response');
 await s.ChatArchiveVault.writeFile(root,archivedPath,new TextEncoder().encode(localModification));
 root.granted=true;activeTab.url='https://example.invalid/';now+=120000;
 await C.tick();
 assert.equal(await (await s.ChatArchiveVault.lookupFile(root,archivedPath)).handle.getFile().then(f=>f.text()),
   localModification,'local edit preserved after regrant');
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).conflicts,1,
   'conflicting capture retained and removed from automatic retry');
 detailOverrides.delete(archived.id);
 // Crash after writing a valid staged file but before its index update:
 // compare exact bytes and recover the index without losing the payload.
 dLedger=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 const freshPath=dLedger.chats[fresh.id].path,priorHash=dLedger.chats[fresh.id].sha256;
 const orphanItem={...fresh,updated:new Date(now+60000).toISOString()};
 const orphanText=markdown(orphanItem).replace('Body','BUFFERED BEFORE INTERRUPTED INDEX COMMIT');
 const stagedOrphan=await s.ChatArchiveSyncSpool.stage(account,layout.prefix,
   {item:orphanItem,text:orphanText,path:freshPath,projectId:pid});
 await s.ChatArchiveVault.writeFile(root,freshPath,new TextEncoder().encode(orphanText));
 now+=120000;cfg.blocked_until=0;await C.tick();
 dLedger=await s.ChatArchiveVault.readJson(root,layout.prefix+'/.workspace.json');
 assert.notEqual(dLedger.chats[fresh.id].sha256,priorHash,'orphaned file index recovered');
 assert.equal(dLedger.chats[fresh.id].sha256,stagedOrphan.record.sha256);
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).pending,0);
 assert.equal((await s.ChatArchiveSyncSpool.stats(account)).conflicts,1,'unrelated conflict never silently cleared');
 activeTab.url='https://chatgpt.com/c/'+archived.id;
 // Configuration changes are detected even if no chat has changed.
 cfg=C._state().workspaces[account];cfg.queue=[];cfg.next_config_scan=0;
 schedulePrompt='Updated recurring instructions';now+=180000;
 await drain(C);
 let scheduleConfig=await s.ChatArchiveVault.readJson(root,layout.prefix+'/_workspace_configuration.json');
 assert.equal(scheduleConfig.schedules.items[0].prompt,'Updated recurring instructions',
   'background inventory must update changed Schedules');
 // A confirmed, complete empty response is a removal; a failed bucket isn't.
 cfg=C._state().workspaces[account];cfg.queue=[];cfg.next_config_scan=0;
 schedulePrompt=null;now+=180000;await drain(C);
 scheduleConfig=await s.ChatArchiveVault.readJson(root,layout.prefix+'/_workspace_configuration.json');
 assert.equal(scheduleConfig.schedules.items.length,0,'confirmed removed Schedule recorded');
 cfg=C._state().workspaces[account];cfg.queue=[];cfg.next_config_scan=0;
 scheduleFail=true;now+=180000;await drain(C);
 scheduleConfig=await s.ChatArchiveVault.readJson(root,layout.prefix+'/_workspace_configuration.json');
 assert.equal(scheduleConfig.schedules.complete,true,'partial failure cannot erase prior complete inventory');
 assert.equal(scheduleConfig.schedules.items.length,0);
 await C.pause(account);await new Promise(r=>setImmediate(r));
 console.log('PASS: real controller with filesystem mocks - default off, seeded workspace gate, stable cutoff, no old backfill, no-detail skip, metadata reuse, worker restart, denied permission, shared lock, durable cooldown queue, pending stream completion, source admission, original bytes, two-inventory deletion, partial-inventory safety');
})().catch(e=>{console.error(e);process.exitCode=1;});
