"""Real Chromium rendering/interactions; Chrome, provider and filesystem are mocked."""
from pathlib import Path
import json,re,os,traceback,base64
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
qa=Path(os.environ.get('CAE_QA_DIR','/mnt/data/cae_017_qa'));qa.mkdir(exist_ok=True,parents=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 ctx=b.new_context(accept_downloads=True);ctx.set_default_timeout(6000)
 def serve(route):
  rel=route.request.url.split('https://cae.test/',1)[1].split('?')[0]
  f=root/rel
  if not f.is_file(): return route.fulfill(status=404,body='')
  data=f.read_bytes();ctype='image/png' if f.suffix=='.png' else 'text/html'
  if f.suffix=='.html': data=re.sub(rb'<script\b[^>]*>.*?</script>|<link\b[^>]*>',b'',data,flags=re.S)
  route.fulfill(body=data,content_type=ctype)
 ctx.route('https://cae.test/**',serve)
 def page(surface='popup',width=392,dark=False):
  pg=ctx.new_page();pg.set_viewport_size({'width':width,'height':720});pg.emulate_media(color_scheme='dark' if dark else 'light');errs=[]
  pg.on('pageerror',lambda e:errs.append(str(e)))
  html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root/(surface+'.html')).read_text(), flags=re.S)
  iconmap={str(f.relative_to(root)):'data:image/png;base64,'+base64.b64encode(f.read_bytes()).decode() for f in (root/'icons').glob('*.png')}
  for key,value in iconmap.items():html=html.replace('src=\"'+key+'\"','src=\"'+value+'\"')
  pg.set_content(html);pg.add_style_tag(content=(root/'styles.css').read_text())
  pg.add_script_tag(content='const iconmap='+json.dumps(iconmap)+';const srcprop=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,\"src\");Object.defineProperty(HTMLImageElement.prototype,\"src\",{get:srcprop.get,set(v){srcprop.set.call(this,iconmap[v]||v)}});if(!crypto.randomUUID)crypto.randomUUID=()=>\"aaaaaaaa-bbbb-cccc-dddd-\"+String(Math.random()).slice(2,14);')
  pg.add_script_tag(content=(root/'tests/ui-fixtures.js').read_text())
  for f in ['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','lib/markdown.js','lib/normalize.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js','panel.js']:pg.add_script_tag(content=(root/f).read_text())
  pg.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
  pg.wait_for_timeout(300);assert not errs,errs
  return pg,errs
 def check(name,fn):
  try:fn();results.append({'name':name,'pass':True});print('PASS',name)
  except Exception as e:results.append({'name':name,'pass':False,'error':str(e)});raise
 try:
  pg,err=page()
  def popup():
   assert pg.locator('#exportCurrent').is_visible() and pg.locator('#quickVault').is_visible()
   assert not pg.locator('#libraryGroups').is_visible()
   assert pg.evaluate('__ui.starts')==0
   pg.screenshot(path=str(qa/'popup-export.png'),full_page=True)
   pg.locator('#navSettings').click();assert pg.locator('#pickFolder').is_visible()
   pg.locator('#syncEnabled').check();pg.locator('#syncScope').select_option('workspace');pg.locator('#syncApply').click()
   pg.wait_for_function("__ui.calls.some(m=>m.type==='CAE_SYNC_ENABLE')")
   pg.screenshot(path=str(qa/'popup-settings.png'),full_page=True)
   pg.locator('#navActivity').click();pg.locator('#syncPause').click();pg.wait_for_function('!__ui.sync.enabled')
   pg.locator('#openTools').click();assert pg.locator('#snapshotSettings').is_visible()
   before=pg.evaluate('__ui.starts')
   with pg.expect_download():pg.locator('#downloadLibraryCatalog').click()
   assert pg.evaluate('__ui.starts')==before
   pg.screenshot(path=str(qa/'popup-tools.png'),full_page=True)
   pg.locator('#refreshStatus').click();assert not pg.evaluate("__ui.rpc.some(m=>m.type==='CAE_LIST')")
   assert not err,err
  check('Popup operations / settings / Tools; catalog is cached, no implicit scan',popup)
  def manual():
   pg.locator('#navExport').click();pg.locator('#exportCurrent').click();pg.wait_for_function("__ui.manual && __ui.manual.status==='queued'")
   assert pg.evaluate('__ui.manual.destination')=='download'
   pg.locator('#navSettings').click();assert pg.locator('#uiSettings').is_visible(),'accepted task must not force a navigation'
   pg.evaluate('finishUIManual()');pg.wait_for_timeout(150)
   pg.locator('#navExport').click();pg.locator('#quickVault').click();pg.wait_for_function("__ui.manual.destination==='vault'")
   assert pg.evaluate("__ui.calls.filter(m=>m.type==='CAE_MANUAL_SUBMIT').at(-1).options.mode")=='current'
   assert not err,err
  check('Quick MD / Vault submit durable jobs and navigation stays unlocked',manual)
  def access():
   pg.evaluate("finishUIManual();__ui.permission='prompt';chrome.storage.onChanged.fire({'cae.background.v1':{}},'local');window.dispatchEvent(new Event('focus'))")
   pg.wait_for_function("!document.querySelector('#headerReconnect').classList.contains('hidden')")
   pg.locator('#headerReconnect').click();pg.wait_for_function("__ui.permission==='granted'")
   assert pg.evaluate('__ui.starts')==0
   pg.locator('#navSettings').click();pg.locator('#pickFolder').click();assert pg.evaluate("__ui.session['cae.ui.intent.1']?.mode==='settings'")
   pg.locator('#openStableSettings').click();assert pg.evaluate("__ui.opens.some(x=>x.url && x.url.includes('options.html'))")
   assert not err,err
  check('Contextual Reconnect Vault; safe persistent directory picker surface',access)
  def canceled_save():
   pg.evaluate("__ui.manual={id:'cancel-test',accountId:__ui.scope.accountId,workspace:__ui.scope.display,destination:'download',status:'download_failed',active:true,phase:'chats',message:'Browser download interrupted: USER_CANCELED. Staged bytes retained.',totalChats:1,chatsDone:1,counts:{saved:0,skipped:0,failed:0},logs:[]};chrome.storage.onChanged.fire({'cae.manual-status.v1':{newValue:__ui.manual}},'local')")
   pg.locator('#navActivity').click()
   pg.wait_for_function("document.querySelector('#manualSummary').textContent.includes('Download canceled by user')")
   assert 'Need' not in pg.locator('#overallStatus').inner_text()
   assert 'does not affect Vault access' in pg.locator('#manualHint').inner_text()
   pg.evaluate("finishUIManual()")
   pg.locator('#navSettings').click()
   pg.evaluate("__ui.sync={enabled:true,status:'idle',access:{worker:'granted',offscreen:'granted'}};__ui.permission='prompt';chrome.storage.onChanged.fire({'cae.background.v1':{}},'local');window.dispatchEvent(new Event('focus'))")
   pg.wait_for_function("document.querySelector('#vaultBadge').textContent.includes('background connected')")
   assert 'access required' not in pg.locator('#vaultBadge').inner_text()
   pg.evaluate("__ui.permission='granted';window.dispatchEvent(new Event('focus'))")
  check('Canceled Save is neutral; background Vault grant is not confused with UI prompt',canceled_save)

  def claim_recovery():
   pg.evaluate("""()=>{__ui.permission='granted';window.dispatchEvent(new Event('focus'));window.__claimClears=0;ChatArchiveVault.inspectWriterClaims=async()=>[{name:'writer-legacy.lock',owner:'legacy',operation:'unknown',ageSeconds:900,size:0,raw:''}];ChatArchiveVault.writerClaimSummary=rows=>rows.map(x=>({...x,workspace:'unknown'}));ChatArchiveVault.clearWriterClaims=async(d,rows,confirmed)=>{if(!confirmed||rows.length!==1)throw Error('Not confirmed');__claimClears++;return 1;};}""")
   pg.locator('#openTools').click()
   pg.locator('#reviewWriterClaims').click();pg.wait_for_function("document.querySelector('#writerClaimsStatus').textContent.includes('1 writer claim')")
   assert pg.locator('#clearWriterClaims').is_disabled()
   pg.locator('#writerClaimsConfirmed').check();assert pg.locator('#clearWriterClaims').is_enabled()
   pg.locator('#clearWriterClaims').click();pg.wait_for_function('__claimClears===1')
   assert not pg.locator('#writerClaimsConfirm').is_visible() and not err,err
  check('Explicit reviewed writer claim recovery; no delete before confirmation',claim_recovery)
  pg.close()
  pa,errs=page('panel',320)
  def trees():
   pa.locator('#modeAll').click();pa.wait_for_function("document.querySelectorAll('.chat-checkbox').length===3")
   pa.locator('#search').fill('Architecture');assert pa.locator('.chat-checkbox').count()==1
   pa.locator('#groupList .group-checkbox').first.check()
   assert '2 chats' in pa.locator('#selectedCount').inner_text() and 'hidden by filters' in pa.locator('#selectedCount').inner_text()
   pa.locator('#search').fill('');pa.locator('#clearSelection').click();pa.locator('.chat-checkbox').first.check()
   assert pa.locator('.group-checkbox').first.evaluate('(e)=>e.indeterminate')
   pa.screenshot(path=str(qa/'panel-chats-320.png'),full_page=True)
   assert pa.evaluate('document.documentElement.scrollWidth<=innerWidth')
   pa.locator('#modeLibrary').click();pa.wait_for_function("document.querySelectorAll('.library-file-checkbox').length===3")
   pa.locator('#libraryMedia').select_option('image');pa.locator('#librarySelectAll').check()
   assert pa.locator('#librarySelectedCount').inner_text()=='1 selected'
   pa.locator('#libraryMedia').select_option('all')
   pa.screenshot(path=str(qa/'panel-library-320.png'),full_page=True)
   assert not errs,errs
  check('Shared group tri-state, hidden selection count, filters and 320px layout',trees)
  def local_tools():
   before=len(pa.evaluate('__ui.opens'))
   pa.locator('#openTools').click()
   assert pa.locator('#toolsConnection').is_visible()
   assert len(pa.evaluate('__ui.opens'))==before,'Tools must not open new tabs'
   pa.locator('#toolsBack').click()
   assert pa.locator('#librarySection').is_visible(),'Back must return to previous Side Panel list'
   pa.locator('#openSettings').click()
   assert pa.locator('#vaultSettings').is_visible()
   assert len(pa.evaluate('__ui.opens'))==before,'Settings must not open new tabs'
   pa.locator('#modeLibrary').click()
  check('Side Panel Settings/Tools stay local; Back restores list',local_tools)
  def widget_settings():
   before=len(pa.evaluate('__ui.opens'))
   pa.evaluate("chrome.storage.session.set({'cae.ui.intent.1':{mode:'settings',at:Date.now(),nonce:'widget-settings-test'}})")
   pa.wait_for_function("!document.querySelector('#vaultSettings').classList.contains('hidden')")
   assert len(pa.evaluate('__ui.opens'))==before
   pa.locator('#modeLibrary').click()
  check('Widget Settings intent routes to local Side Panel settings',widget_settings)

  def accepting():
   pa.evaluate('__ui.reject=true');pa.locator('#libraryArchive').click()
   pa.wait_for_function("document.querySelector('#status').textContent.includes('rejected')")
   assert pa.evaluate('__ui.closes.length')==0
   pa.evaluate('__ui.reject=false');pa.locator('#libraryArchive').click();pa.wait_for_function('__ui.archives.length===1')
   assert pa.evaluate('__ui.closes.length')==1 and len(pa.evaluate('__ui.archives[0].ids'))==1
   pa.locator('#modeAll').click();assert pa.locator('#allSection').is_visible()
   assert not errs,errs
  check('Auto-close only after accepted selection; no close on rejection',accepting)
  def scan():
   pa.evaluate('finishUILibrary()');pa.locator('#modeLibrary').click();pa.locator('#keepPanelOpen').check();pa.locator('#refreshLibrary').click()
   pa.wait_for_function('__ui.starts===1');pa.locator('#modeCurrent').click();pa.locator('#modeLibrary').click()
   pa.evaluate("window.dispatchEvent(new Event('focus'));chrome.tabs.onActivated.fire({tabId:11})")
   pa.wait_for_timeout(500);assert pa.evaluate('__ui.starts')==1
   pa.locator('#modeMonitor').click();pa.locator('#libraryStop').click();pa.wait_for_function("__ui.lib.job.status==='cancelled'")
   assert not errs,errs
  check('On-demand scan remains single; Stop and monitor navigation',scan)
  def scope_change():
   pa.locator('#modeAll').click();pa.locator('.chat-checkbox').first.check()
   pa.evaluate("__ui.scope.accountId='other-workspace';__ui.scope.display='Other workspace';__ui.items=[];__ui.projects=[];__ui.lib=null;chrome.tabs.onUpdated.fire(11,{url:'https://chatgpt.com/c/changed'},{active:true})")
   pa.wait_for_function("document.querySelector('#scope').textContent.includes('Other workspace')")
   pa.wait_for_timeout(200);assert '0 chats' in pa.locator('#selectedCount').inner_text()
   assert not errs,errs
  check('Workspace change clears prior selection and catalog',scope_change)
  pa.close()
  pd,e=page('panel',400,True)
  def dark():
   pd.locator('#modeLibrary').click();pd.wait_for_timeout(200);pd.screenshot(path=str(qa/'panel-dark.png'),full_page=True)
   assert pd.evaluate('document.documentElement.scrollWidth<=innerWidth')
   pd.evaluate('chrome.sidePanel.close=undefined');pd.locator('#libraryMedia').select_option('image');pd.locator('#librarySelectAll').check();pd.locator('#libraryArchive').click()
   pd.wait_for_function("document.querySelector('#status').textContent.includes('cannot close')")
   assert pd.evaluate('__ui.closes.length')==0
   assert not e,e
  check('Dark theme; older Chrome graceful no-auto-close fallback',dark)
  pd.close()
 finally:
  (qa/'ui-browser-results.json').write_text(json.dumps(results,indent=2));b.close()
