# Optional browser DOM smoke test; Chrome APIs and Vault are mocked.
from pathlib import Path
import re, json, os, tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
qa=Path(tempfile.mkdtemp(prefix='cae016-panel-'))
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root/'panel.html').read_text(), flags=re.S)
mock=r'''
(() => {
 const event=()=>({listeners:[],addListener(f){this.listeners.push(f);}});
 window.syncCalls=[];
 let cfg={enabled:false,status:'disabled'};
 const evt=event();
 window.chrome={
  runtime:{sendMessage:async m=>{
   syncCalls.push(m);
   if(m.type==='CAE_MANUAL_STATUS')return {ok:true,result:null};
   if(m.type==='CAE_SYNC_ENABLE')cfg={...m.options,enabled:true,status:'idle',trackedChats:1,queue:0,vaultName:'AI_Vault',since:'2026-11-09T20:00:00Z',startedAt:'2026-11-09T20:00:00Z'};
   if(m.type==='CAE_SYNC_PAUSE')cfg={...cfg,enabled:false,status:'disabled'};
   return {ok:true,result:cfg};}},
  tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444'}],connect:()=>{
   const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage:m=>queueMicrotask(()=>port.onMessage.listeners.forEach(fn=>fn({id:m.id,result:{accountId:'workspace-one',observed:true,display:'Workspace test',currentId:'aaaaaaaa-1111-2222-3333-444444444444'}})))};
   return port;
  }},
  storage:{onChanged:evt,session:{get:(defaults,fn)=>fn(defaults)}}
 };
 window.ChatArchiveVault={restoreDirectory:async()=>({name:'AI_Vault'}),permissionState:async()=>({state:'granted'}),hasPermission:async()=>true,rememberDirectory:async()=>{}};
})();
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':400,'height':1100},color_scheme='light')
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(html)
    page.add_style_tag(content=(root/'styles.css').read_text())
    page.add_script_tag(content=mock)
    for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
        page.add_script_tag(content=(root/provider_file).read_text())
    page.add_script_tag(content=(root/'panel.js').read_text())
    page.wait_for_function("document.querySelector('#scope').textContent.includes('Workspace test')")
    assert not page.locator('#syncEnabled').is_checked()
    assert not page.evaluate("syncCalls.some(x=>x.type==='CAE_SYNC_ENABLE')")
    page.locator('#syncEnabled').check()
    page.locator('#syncScope').select_option('workspace')
    page.locator('#syncEnrollment').select_option('tracked_and_new')
    page.locator('#syncApply').click()
    page.wait_for_function("document.querySelector('#syncStatus').textContent.startsWith('idle')")
    assert page.locator('#syncEnabled').is_checked()
    assert not page.locator('#syncPause').is_disabled()
    page.screenshot(path=str(qa/'panel-mocked-enabled.png'),full_page=True)
    page.locator('#syncPause').click()
    page.wait_for_function("document.querySelector('#syncStatus').textContent.startsWith('Paused')")
    assert not page.locator('#syncEnabled').is_checked(), 'pause must reset checkbox while it has focus'
    assert page.locator('#syncPause').is_disabled()
    payload=page.evaluate("syncCalls.find(x=>x.type==='CAE_SYNC_ENABLE').options")
    assert payload['accountId']=='workspace-one' and payload['scope']=='workspace' and payload['enrollment']=='tracked_and_new'
    assert payload['sources'] is False
    assert not errors, errors
    print('PASS: Chromium DOM panel smoke with mocked Chrome APIs: default off, explicit scope/policy, enable, status, pause, controls reset; no page exceptions')
    (qa/'panel-ui-result.json').write_text(json.dumps({'passed':True,'real_extension':False,'real_filesystem':False,'authenticated_api':False,'errors':errors,'enable_payload':payload},indent=2))
    browser.close()
