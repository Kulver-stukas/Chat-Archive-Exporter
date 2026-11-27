# Browser DOM checks for v0.1.6.4 UI automation. All Chrome APIs and the Vault are mocked.
from pathlib import Path
import os, re, tempfile
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
html = re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '',
              (root/'panel.html').read_text(), flags=re.S)
mock = r'''
(() => {
 const event=()=>({listeners:[],addListener(f){this.listeners.push(f);},fire(...args){this.listeners.forEach(f=>f(...args));}});
 window.__syncCalls=[];window.__apiCalls=[];window.__asked=0;window.__vaultGranted=true;window.__permissionOverride=null;
 window.__activeTab={id:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444',active:true,windowId:1};
 window.__activated=event();window.__updated=event();window.__focused=event();
 window.__sessionValues={caeInitialMode:'current'};
 let cfg={enabled:false,status:'disabled'};
 const chats=[{id:'aaaaaaaa-1111-2222-3333-444444444444',title:'Archived Chat A',project:'',projectId:'',updated:'2026-11-10T12:00:00Z'},
              {id:'bbbbbbbb-1111-2222-3333-444444444444',title:'Archived Chat B',project:'',projectId:'',updated:'2026-11-09T12:00:00Z'}];
 const scope={accountId:'workspace-one',observed:true,display:'Workspace test',currentId:chats[0].id};
 window.__mockScope=scope;
 window.chrome={
  runtime:{lastError:null,sendMessage:async m=>{
    __syncCalls.push(m);
    if(m.type==='CAE_MANUAL_STATUS')return {ok:true,result:null};
    if(m.type==='CAE_SYNC_ENABLE')cfg={...m.options,enabled:true,status:'idle',trackedChats:2,queue:0,vaultName:'AI_Vault',since:'2026-11-09T20:00:00Z',startedAt:'2026-11-09T20:00:00Z'};
    if(m.type==='CAE_SYNC_PAUSE')cfg={...cfg,enabled:false,status:'disabled'};
    if(m.type==='CAE_SYNC_WAKE')cfg={...cfg,status:'queued'};
    if(m.type==='CAE_VAULT_READY')return {ok:true,result:{...cfg,access:{worker:'granted',offscreen:'granted',retained:true}}};
    if(m.type==='CAE_VAULT_DIAGNOSTICS')return {ok:true,result:{schema:'cae.vault-permission-log.v1',extensionVersion:'0.1.6.4',events:[{workspace:'workspace_1',event:'panel_open',worker:'granted',offscreen:'granted'}]}};
    return {ok:true,result:cfg};
  }},
  tabs:{onActivated:__activated,onUpdated:__updated,query:async()=>[__activeTab],connect:id=>{
    const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage:m=>{
      __apiCalls.push(m.type);
      let data;
      if(m.type==='CAE_STATUS')data={...__mockScope,currentId:__activeTab.url.includes('/c/')?__mockScope.currentId:null};
      else if(m.type==='CAE_LIST')data={scope:__mockScope,items:chats,projects:[],warnings:[]};
      else data={};
      queueMicrotask(()=>port.onMessage.fire({id:m.id,result:data}));
    }};
    return port;
  }},
  windows:{onFocusChanged:__focused,WINDOW_ID_NONE:-1},
  storage:{onChanged:event(),session:{
    get:(keys,cb)=>{
      let result;
      if(typeof keys==='string')result={[keys]:__sessionValues[keys]};
      else if(Array.isArray(keys))result=Object.fromEntries(keys.map(k=>[k,__sessionValues[k]]));
      else result={...keys,...__sessionValues};
      if(typeof cb==='function'){cb(result);return;}
      return Promise.resolve(result);
    },
    set:async values=>Object.assign(__sessionValues,values)
  }}
 };
 const handle={name:'AI_Vault'};
 window.ChatArchiveVault={restoreDirectory:async()=>handle,restoreWorkspaceDirectory:async()=>handle,
    permissionState:async()=>({state:__permissionOverride||(__vaultGranted?'granted':'prompt')}),
    hasPermission:async(_h,ask)=>{if(ask){__asked++;__vaultGranted=true;}return __vaultGranted;},rememberDirectory:async()=>{}};
 window.ChatArchiveSort={compareGroups:()=>0,compareChats:(a,b)=>String(b.updated||'').localeCompare(a.updated||'')};
})();
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':420,'height':1250})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html)
    page.add_style_tag(content=(root/'styles.css').read_text())
    page.add_script_tag(content=mock)
    for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
        page.add_script_tag(content=(root/provider_file).read_text())
    page.add_script_tag(content=(root/'panel.js').read_text())
    page.wait_for_function("document.querySelector('#scope').textContent.includes('Workspace test')")
    assert page.evaluate("__apiCalls.filter(x=>x==='CAE_STATUS').length") >= 1, 'Initial reconnect must be automatic'
    assert page.locator('#syncApply').is_disabled(), 'No changes: Apply disabled'
    assert page.locator('#pickFolder').inner_text() == 'Change Vault…'
    page.locator('#outputFolder').check()
    assert 'AI_Vault' in page.locator('#folderStatus').inner_text()
    page.locator('#modeAll').click()
    page.wait_for_function("document.querySelector('#listSummary').textContent.includes('2 chats')")
    before=page.evaluate("__apiCalls.filter(x=>x==='CAE_LIST').length")
    assert before==1, 'Opening All conversations must auto-load exactly once'
    page.locator('#modeCurrent').click();page.locator('#modeAll').click()
    assert page.evaluate("__apiCalls.filter(x=>x==='CAE_LIST').length")==1, 'Fresh list should be cached'
    page.locator('#loadAll').click()
    page.wait_for_function("window.__apiCalls.filter(x=>x==='CAE_LIST').length===2")
    page.locator('#syncEnabled').check()
    assert not page.locator('#syncApply').is_disabled(), 'Enable change should activate Apply'
    page.locator('#syncApply').click()
    page.wait_for_function("document.querySelector('#syncStatus').textContent.startsWith('idle')")
    assert page.locator('#syncApply').is_disabled(), 'Applied settings must disable Apply'
    page.locator('#syncScope').select_option('workspace')
    assert not page.locator('#syncApply').is_disabled(), 'Modified scope must activate Apply'
    page.locator('#syncScope').select_option('active')
    assert page.locator('#syncApply').is_disabled(), 'Reverting edits must disable Apply'
    # A passive tab focus must check, never request, Vault permission.
    page.evaluate("() => { __vaultGranted=false; __focused.fire(1); document.dispatchEvent(new Event('visibilitychange')); }")
    page.wait_for_function("document.querySelector('#folderStatus').textContent.includes('browser confirmation required')")
    assert page.evaluate('__asked')==1, 'Only the explicit Apply may request initial permission'
    assert page.locator('#authorizeVault').is_visible(), 'Reauthorization fallback on an active sync'
    page.locator('#authorizeVault').click()
    page.wait_for_function("document.querySelector('#folderStatus').textContent.includes('write access available')")
    assert page.evaluate('__asked')==2, 'Fallback should request only once on a direct gesture'
    page.wait_for_function("window.__syncCalls.some(x=>x.type==='CAE_VAULT_READY')")
    assert 'handle retained' in page.locator('#accessState').inner_text()
    # Typed negative states: no generic prompt banner and no passive permission requests.
    before_asks=page.evaluate('__asked')
    for pstate, label in [('denied','write access denied'),('error','permission check failed'),('unsupported','permission API unavailable')]:
        page.evaluate("s => { __permissionOverride=s; window.dispatchEvent(new Event('focus')); }", pstate)
        page.wait_for_function("label => document.querySelector('#folderStatus').textContent.includes(label)",arg=label)
        assert page.evaluate('__asked')==before_asks
    page.evaluate("() => { __permissionOverride=null; __vaultGranted=true; window.dispatchEvent(new Event('focus')); }")
    page.wait_for_function("document.querySelector('#folderStatus').textContent.includes('write access available')")
    with page.expect_download() as pending:
        page.locator('#exportAccessDiagnostics').click()
    download=pending.value
    assert download.suggested_filename.startswith('CAE-access-diagnostics-')
    import json
    report=json.loads(Path(download.path()).read_text())
    assert report['extensionVersion']=='0.1.6.4'
    assert report['events'][0]['workspace']=='workspace_1'
    qa=Path(os.environ.get('CAE_QA_DIR') or tempfile.mkdtemp(prefix='cae0164-qa-'));qa.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(qa/'panel-access-granted.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'No horizontal overflow'
    # Moving to another site disconnects; returning to ChatGPT reconnects without a click.
    page.evaluate("() => { __activeTab={id:2,url:'https://example.org/',active:true,windowId:1}; __activated.fire({tabId:2,windowId:1}); }")
    page.wait_for_function("document.querySelector('#scope').textContent.includes('Open an active ChatGPT tab')")
    page.wait_for_function("document.querySelector('#syncStatus').textContent.startsWith('idle')")
    assert '2 archived chats' in page.locator('#syncStatus').inner_text(), 'Off-site navigation must keep the verified workspace status'
    assert 'status only' in page.locator('#syncStatus').inner_text(), 'Off-site status must be clearly read-only'
    assert page.locator('#syncApply').is_disabled() and page.locator('#syncPause').is_disabled(), 'Off-site workspace changes must be disabled'
    assert page.locator('#syncEnabled').is_disabled(), 'Cannot modify sync configuration off-site'
    assert page.evaluate("__sessionValues['cae.panel.lastWorkspace.1'].accountId")=='workspace-one', 'Verified identity must survive panel recreation'
    # Simulate opening a fresh side panel while the current tab is still off-site.
    # Each panel has its own JS state, but window-scoped storage.session survives.
    saved=page.evaluate('JSON.stringify(__sessionValues)')
    offline_mock=mock.replace("window.__sessionValues={caeInitialMode:'current'};",
                              "window.__sessionValues="+saved+";")
    # Background controller state survives panel recreation; the fixture's
    # local cfg variable must reflect that persisted controller state.
    offline_mock=offline_mock.replace("let cfg={enabled:false,status:'disabled'};",
      "let cfg={enabled:true,status:'idle',trackedChats:2,queue:0,vaultName:'AI_Vault',since:'2026-11-09T20:00:00Z',startedAt:'2026-11-09T20:00:00Z'};")
    offline_mock=offline_mock.replace(
      "window.__activeTab={id:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444',active:true,windowId:1};",
      "window.__activeTab={id:2,url:'https://example.org/',active:true,windowId:1};")
    offline=browser.new_page(viewport={'width':420,'height':1250})
    offline_errors=[]
    offline.on('pageerror',lambda e:offline_errors.append(str(e)))
    offline.set_content(html)
    offline.add_script_tag(content=offline_mock)
    for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
        offline.add_script_tag(content=(root/provider_file).read_text())
    offline.add_script_tag(content=(root/'panel.js').read_text())
    offline.wait_for_function("document.querySelector('#syncStatus').textContent.startsWith('idle')")
    assert '2 archived chats' in offline.locator('#syncStatus').inner_text(), 'Recreated panel must restore last verified workspace'
    assert 'status only' in offline.locator('#syncStatus').inner_text()
    assert offline.locator('#syncApply').is_disabled() and offline.locator('#syncPause').is_disabled()
    assert not offline_errors,offline_errors
    offline.close()
    page.evaluate("() => { __activeTab={id:1,url:'https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444',active:true,windowId:1}; __activated.fire({tabId:1,windowId:1}); }")
    page.wait_for_function("document.querySelector('#scope').textContent.includes('Workspace test')")
    page.wait_for_function("!document.querySelector('#syncEnabled').disabled")
    assert 'status only' not in page.locator('#syncStatus').inner_text(), 'Return to verified tab should restore controls'
    # A different verified workspace supersedes the last workspace in this window;
    # a later off-site visit must not show the original account instead.
    page.evaluate("""() => {
      __mockScope={...__mockScope,accountId:'workspace-two',display:'Workspace Two'};
      __activeTab={id:3,url:'https://chatgpt.com/c/cccccccc-1111-2222-3333-444444444444',active:true,windowId:1};
      __activated.fire({tabId:3,windowId:1});
    }""")
    page.wait_for_function("document.querySelector('#scope').textContent.includes('Workspace Two')")
    page.wait_for_function("__sessionValues['cae.panel.lastWorkspace.1']?.accountId==='workspace-two'")
    page.evaluate("() => {__activeTab={id:2,url:'https://example.org/',active:true,windowId:1};__activated.fire({tabId:2,windowId:1});}")
    page.wait_for_function("document.querySelector('#syncStatus').textContent.includes('Viewing Workspace Two (status only)')")
    assert not errors, errors
    browser.close()
print('PASS: v0.1.6.6 rev 1 UI including retained background status off-site and after panel recreation')
