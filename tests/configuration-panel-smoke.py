"""Actual panel.js: manual configuration snapshot is a user-granted, scope-bound job."""
from pathlib import Path
import re, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root/'panel.html').read_text(), flags=re.S)
mock=r'''
(()=>{
  const event=()=>({listeners:[],addListener(f){this.listeners.push(f)},fire(...args){this.listeners.forEach(f=>f(...args))}});
  window.__submissions=[]; window.__requests=[]; window.__asked=0; window.__binds=[];
  if(!crypto.randomUUID)crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000068';
  const handle={name:'AI_Vault'};
  window.ChatArchiveManualStore={bind:async(id,dir)=>{if(dir!==handle)throw Error('Wrong Vault');__binds.push(id);}};
  window.ChatArchiveVault={restoreDirectory:async()=>handle,restoreWorkspaceDirectory:async()=>handle,
    permissionState:async()=>({state:'granted'}),hasPermission:async(dir,ask)=>{
      if(dir!==handle)throw Error('Wrong Vault'); if(ask)__asked++;return true;}};
  const scope={accountId:'workspace-one',display:'Workspace one',observed:true,currentId:''};
  const chats=[{id:'aaaaaaaa-1111-2222-3333-444444444444',title:'Chat one'}];
  const events=event();
  window.chrome={runtime:{id:'mock',getManifest:()=>({version:'0.1.6.8'}),sendMessage:async m=>{
      __requests.push(m.type);
      if(m.type==='CAE_MANUAL_SUBMIT'){
        __submissions.push(m.options);
        if(!__binds.includes(m.options.requestId))throw Error('Vault not bound');
        return {ok:true,result:{id:m.options.requestId,accountId:m.options.accountId,
          status:'queued',active:true,phase:'context',message:'Manual export accepted.',
          totalChats:m.options.items.length,chatsDone:0,counts:{saved:0,skipped:0,failed:0,conflict:0},
          metadata:{saved:0,skipped:0,failed:0,conflict:0},logs:[]}};
      }
      if(m.type==='CAE_MANUAL_STATUS')return {ok:true,result:null};
      return {ok:true,result:{enabled:false,status:'disabled'}};
    }},
    tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/',active:true,windowId:1}],
      onActivated:event(),onUpdated:event(),connect:()=>{
        const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage:m=>{
          __requests.push(m.type);
          const value=m.type==='CAE_LIST'?{scope,items:chats,projects:[],warnings:[]}:scope;
          queueMicrotask(()=>port.onMessage.fire({id:m.id,result:value}));
        }};return port;
      },get:async()=>({id:1,url:'https://chatgpt.com/',windowId:1})},
    windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1},
    storage:{onChanged:events,session:{get:(k,cb)=>cb({})}}
  };
})();
'''
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or '/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':420,'height':1250})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html)
  page.add_style_tag(content=(root/'styles.css').read_text())
  page.add_script_tag(content=mock)
  for fn in ['markdown-primitives.js','../providers/chatgpt/markdown-profile.js','markdown.js','normalize.js','paths.js','sort.js']:
    page.add_script_tag(content=(root/'lib'/fn).read_text())
  for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
      page.add_script_tag(content=(root/provider_file).read_text())
  page.add_script_tag(content=(root/'panel.js').read_text())
  page.wait_for_function("document.querySelector('#scope').textContent.includes('Workspace one')",timeout=6000)
  page.wait_for_function("!document.querySelector('#snapshotSettings').disabled",timeout=6000)
  page.locator('#snapshotSettings').click(timeout=3000)
  try:
    page.wait_for_function('window.__submissions.length===1',timeout=6000)
  except Exception:
    print('DEBUG',page.evaluate('({submissions:__submissions,requests:__requests,asked:__asked,bindings:__binds,status:document.querySelector("#status").textContent, scope:document.querySelector("#scope").textContent})'),'ERRS',errors)
    raise
  job=page.evaluate('window.__submissions[0]')
  assert job['mode']=='configuration',job
  assert job['destination']=='vault',job
  assert job['items']==[] and job['projects']==[],job
  assert job['fullWorkspace'] is True and job['accountId']=='workspace-one',job
  assert page.evaluate('window.__asked')==1,'Permission must be a user action'
  assert page.evaluate('window.__requests.filter(t=>t===\'CAE_GET_CHAT\').length')==0
  assert not errors,errors
  browser.close()
  print('PASS: current-workspace-only metadata snapshot, manual durable job, permission check, no chats/Sources')
