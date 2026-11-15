/* Browser tests: real IndexedDB/Blob/OPFS, simulated Chrome APIs and ChatGPT.
 * OPFS does NOT test permission persistence for a user-picked external directory. */
(()=>{
 const events={listeners:[],addListener(fn){this.listeners.push(fn);}},alarms=new Map();
 window.__calls=[];window.__downloads=[];window.__state=null;
 const account='workspace-browser',pid='g-p-11111111111111111111111111111111';
 window.__item=n=>({id:'aaaaaaaa-1111-2222-3333-'+String(n).padStart(12,'0'),title:'Browser chat '+n,
   updated:'2026-11-01T01:00:00Z',created:'2026-10-01T01:00:00Z',project:'Browser Project',projectId:pid});
 window.__root=()=>navigator.storage.getDirectory().then(d=>d.getDirectoryHandle('test-vault',{create:true}));
 window.__opts=(id,items,destination='vault',mode='all')=>({requestId:id,items,destination,mode,accountId:account,display:'Browser Workspace',tabId:1,
   projects:[{id:pid,name:'Browser Project'}],fullWorkspace:false});
 const bin=Uint8Array.from([0,255,239,187,191,65,13,10,0,128]);
 window.chrome={
   runtime:{id:'test',getURL:p=>location.origin+'/'+p,onMessage:events,
     sendMessage:m=>new Promise((resolve,reject)=>{let accepted=false;for(const fn of events.listeners){if(fn(m,{id:'test'},resolve)){accepted=true;break;}}
       if(!accepted)reject(Error('No mocked receiver'));})},
   tabs:{get:async id=>({id,windowId:1,active:true,url:'https://chatgpt.com/c/'+__item(1).id}),query:async()=>[]},
   storage:{local:{set:async v=>{for(const[k,x]of Object.entries(v))localStorage.setItem(k,JSON.stringify(x));
       if(v['cae.manual-status.v1']){__state=v['cae.manual-status.v1'];document.querySelector('#state').textContent=JSON.stringify(__state,null,2);}},
     get:async k=>({[k]:JSON.parse(localStorage.getItem(k)||'null')})}},
   alarms:{get:async id=>alarms.get(id),create:async(id,x)=>alarms.set(id,x),clear:async id=>alarms.delete(id)},
   downloads:{download:async o=>{const b=new Uint8Array(await(await fetch(o.url)).arrayBuffer());
       let text='';for(const x of b)text+=String.fromCharCode(x);
       const d={id:__downloads.length+1,state:'complete',...o,base64:btoa(text)};__downloads.push(d);return d.id;},
     search:async q=>__downloads.filter(x=>(q.id==null||q.id===x.id)&&(!q.url||x.url===q.url)),cancel:async()=>{}}
 };
 window.ChatArchiveVaultContext={ensure:async()=>true,reconcile:async()=>true};
 window.ChatArchiveSync={isRunning:()=>false,_state:()=>({workspaces:{}}),wake(){}};
 window.ChatArchiveSyncRPC={connect:()=>{let source=false;return {close(){},call:async(type,o={})=>{
   __calls.push(type);
   if(type==='CAE_STATUS')return {observed:true,accountId:account};
   if(type==='CAE_GET_CHAT'){const x=o.chat;return {...x,projectName:x.project,messages:[{role:'user',content:'Question',time:x.created},{role:'assistant',content:'Answer **markdown**.',time:x.updated}],warnings:[]};}
   if(type==='CAE_CONTEXT')return {captured_at:'2026-11-12T00:00:00Z',projects_complete:true,warnings:[],personalization:null,projects:[{
     gizmo:{id:pid,display:{name:'Browser Project'},instructions:'Example project'},
     files:[{id:'attach1',file_id:'file-bin',name:'original.bin',size:10,type:'application/octet-stream'}],connectors:[]}]};
   if(type==='CAE_SOURCE_START'){source=true;return {contentType:'application/octet-stream'};}
   if(type==='CAE_SOURCE_READ'){if(!source)return {done:true,totalBytes:bin.length};source=false;return {done:false,base64:btoa(String.fromCharCode(...bin)),byteLength:bin.length};}
   if(type==='CAE_SOURCE_CLOSE')return {closed:true};
   throw Error('Unexpected mocked RPC '+type);
 }}}};
})();
