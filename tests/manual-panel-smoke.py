"""Browser UI integration: actual panel.js, mocked controller/Chrome/FSA.
The controller is tested separately. Closing this page must NOT call cancellation.
"""
from pathlib import Path
import re, os, tempfile, copy
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>','',(root/'panel.html').read_text(),flags=re.S)
calls=[]; current=None

def backend(m):
    global current
    calls.append(copy.deepcopy(m))
    t=m['type']
    if t=='CAE_MANUAL_SUBMIT':
        assert current is None
        o=m['options'];current=dict(id=o['requestId'],accountId=o['accountId'],workspace=o['display'],mode=o['mode'],destination=o['destination'],status='queued',phase='chats',active=True,message='Manual export accepted. The panel may be closed.',totalChats=len(o['items']),chatsDone=0,counts=dict(saved=0,skipped=0,failed=0,conflict=0),metadata=dict(saved=0,skipped=0,failed=0),sources=None,totalSources=0,sourcesDone=0,logs=[])
    elif t=='CAE_MANUAL_CANCEL':
        current.update(active=False,status='cancelled',message='Stopped. Completed Vault files retained.')
    elif t=='CAE_MANUAL_WAKE':
        if current:current.update(status='queued',message='Vault access restored.')
    if t.startswith('CAE_MANUAL_'):return dict(ok=True,result=copy.deepcopy(current))
    return dict(ok=True,result=dict(enabled=False,status='disabled'))

mock=r'''
(() => {
 const event=()=>({listeners:[],addListener(f){this.listeners.push(f)},fire(...xs){this.listeners.forEach(f=>f(...xs))}});
 window.__events=event();window.__apiCalls=[];window.__bound=[];window.__asked=0;window.__granted=true;
 const handle={name:'AI_Vault'},other={name:'Other Vault'};
 window.ChatArchiveManualStore={bind:async(id,d)=>{__bound.push(id);if(d!==handle)throw Error('Wrong target');},directory:async()=>handle};
 window.ChatArchiveVault={restoreDirectory:async()=>other,restoreWorkspaceDirectory:async()=>handle,
  permissionState:async d=>({state:d===handle&&__granted?'granted':'prompt'}),hasPermission:async(d,ask)=>{if(ask){__asked++;__granted=true}return __granted;}};
 const cid='aaaaaaaa-1111-2222-3333-444444444444';const scope={accountId:'workspace-one',display:'Workspace test',observed:true,currentId:cid};
 const chats=[{id:cid,title:'Test chat',updated:'2026-11-11T12:00:00Z'}];
 if(!crypto.randomUUID)crypto.randomUUID=()=> 'job-manual-ui-12345678';
 window.chrome={runtime:{sendMessage:async m=>{
  if(m.type==='CAE_MANUAL_SUBMIT'&&m.options.destination==='vault'&&!__bound.includes(m.options.requestId))throw Error('Acknowledgement before binding');
  return await window.backend(m);
 }},tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/c/'+cid,active:true,windowId:1}],onActivated:event(),onUpdated:event(),connect:()=>{
   const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage:m=>{
    __apiCalls.push(m.type);let result=m.type==='CAE_LIST'?{scope,items:chats,projects:[],warnings:[]}:scope;
    if(m.type!=='CAE_LIST'&&m.type!=='CAE_STATUS')throw Error('Panel must not retrieve export bodies');
    queueMicrotask(()=>port.onMessage.fire({id:m.id,result}));}};return port;
 }},windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1},storage:{onChanged:__events,session:{get:(d,cb)=>cb(d)}}};
 window.ChatArchiveSort={compareGroups:()=>0,compareChats:()=>0};
})();
'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or '/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 errors=[]
 def new_panel(granted=True):
  page=b.new_page(viewport={'width':420,'height':1200})
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.expose_function('backend',backend)
  page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text());page.add_script_tag(content=mock)
  page.evaluate('(v)=>__granted=v',granted)
  page.add_script_tag(content=(root/'lib/normalize.js').read_text())
  page.add_script_tag(content=(root/'lib/paths.js').read_text())
  for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
      page.add_script_tag(content=(root/provider_file).read_text())
  page.add_script_tag(content=(root/'panel.js').read_text())
  page.wait_for_function("document.querySelector('#scope').textContent.includes('Workspace test')")
  return page
 page=new_panel();page.locator('#outputFolder').check();page.locator('#modeAll').click()
 page.wait_for_function("document.querySelector('#listSummary').textContent.includes('1 chats')")
 page.locator('#selectAll').check();page.locator('#exportSelected').click()
 page.wait_for_function("document.querySelector('#status').textContent.includes('Manual export accepted')")
 assert len([m for m in calls if m['type']=='CAE_MANUAL_SUBMIT'])==1
 assert not page.evaluate("__apiCalls.some(x=>x==='CAE_GET_CHAT')")
 job_id=current['id'];page.close()
 assert not any(m['type']=='CAE_MANUAL_CANCEL' for m in calls),'UI closure must not cancel'
 current.update(status='permission_required',message='Vault permission needed')
 page=new_panel(False)
 page.wait_for_function("document.querySelector('#status').textContent.includes('permission_required')",timeout=5000)
 assert page.locator('#outputFolder').is_checked()
 assert page.locator('#folderControls').is_visible()
 page.wait_for_function("!document.querySelector('#authorizeVault').disabled")
 assert page.locator('#authorizeVault').is_visible()
 assert 'AI_Vault' in page.locator('#folderStatus').inner_text()
 assert page.evaluate('__asked')==0,'No passive prompt'
 assert page.locator('#exportSelected').is_disabled()
 page.locator('#authorizeVault').click()
 page.wait_for_function("document.querySelector('#folderStatus').textContent.includes('write access available')")
 assert any(m['type']=='CAE_MANUAL_WAKE' for m in calls)
 assert len([m for m in calls if m['type']=='CAE_MANUAL_SUBMIT'])==1,'Reopening only attaches'
 current.update(status='completed',active=False,chatsDone=1,counts=dict(saved=1,skipped=0,failed=0,conflict=0),message='Manual Vault export completed.')
 page.evaluate("__events.fire({'cae.manual-status.v1':{newValue:{}}},'local')")
 page.wait_for_function("document.querySelector('#status').textContent.includes('completed')")
 assert page.locator('#cancel').is_hidden()
 assert '1 saved' in page.locator('#status').inner_text()
 assert current['id']==job_id
 qa=Path(os.environ.get('CAE_QA_DIR') or tempfile.mkdtemp(prefix='cae0166-qa-'));qa.mkdir(parents=True,exist_ok=True)
 page.screenshot(path=str(qa/'panel-manual-complete.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 b.close()
 print('PASS: actual panel submit-only, persisted acknowledgement, close/reopen attachment, manual-only permission restoration, no duplicate export, completion view')
