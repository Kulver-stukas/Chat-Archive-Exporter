"""Actual panel JS/CSS in Chromium with delayed, controlled extension API fixtures.
Tests tab navigation, stale replies, workspace boundaries and available-height layout.
No authenticated network access or Vault writes.
"""
from pathlib import Path
import base64, json, os, re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
qa=Path(os.environ.get('CAE_QA_DIR',str(root.parent/'qa')));qa.mkdir(parents=True,exist_ok=True)
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>','',(root/'panel.html').read_text(),flags=re.S)
icons={str(f.relative_to(root)):'data:image/png;base64,'+base64.b64encode(f.read_bytes()).decode() for f in (root/'icons').glob('*.png')}
for name,data in icons.items():html=html.replace('src="'+name+'"','src="'+data+'"')
fixture=(root/'tests/ui-fixtures.js').read_text()+r'''
(()=>{
 const t=__ui, ids=['aaaaaaaa','bbbbbbbb','cccccccc','dddddddd','eeeeeeee','ffffffff'].map(x=>x+'-1111-2222-3333-444444444444');
 const a='test-workspace', b='other-workspace';
 const tabs=ids.map((id,i)=>({id:11+i,windowId:1,url:'https://chatgpt.com/c/'+id,title:'Conversation '+i+' - ChatGPT',active:true,scope:{accountId:i===4?b:a,display:i===4?'Other workspace':'Test workspace',observed:true,currentId:id}}));
 t.local['cae.export.preferences.v1']={questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:false,_revision:1};
 t.active=tabs[0];t.held=[];t.statusHeld=[];t.holdStatus=false;
 t.activate=i=>{t.active=i===-1?{id:99,windowId:1,url:'https://example.com/',active:true}:tabs[i];chrome.tabs.onActivated.fire({tabId:t.active.id,windowId:1})};
 t.navigate=i=>{const next={...tabs[i],id:t.active.id};t.active=next;chrome.tabs.onUpdated.fire(next.id,{url:next.url},next)};
 t.finishStatus=()=>{for(const reply of t.statusHeld.splice(0))reply()};
 const chatFor=(id)=>{const i=ids.indexOf(id);return {id,title:'Conversation '+i,branchNode:'a100',messages:Array.from({length:200},(_,j)=>({id:(j%2?'a':'q')+Math.floor(j/2+1),role:j%2?'assistant':'user',textContent:'Chat '+i+' message '+j+' '+('long message preview '.repeat(5)),attachments:[]}))}};
 t.deliver=(id,error=false)=>{const ix=t.held.findIndex(x=>x.id===id);if(ix<0)throw Error('No held chat '+id);const x=t.held.splice(ix,1)[0];x.port.onMessage.fire({id:x.requestId,...(error?{error:'Fixture: messages unavailable'}:{result:chatFor(id)})})};
 t.ids=ids;
 chrome.tabs.query=async()=>[t.active];chrome.tabs.get=async()=>t.active;
 const origConnect=chrome.tabs.connect;
 chrome.tabs.connect=(tabId,...args)=>{
  const port=origConnect(tabId,...args),post=port.postMessage;const connected=structuredClone(t.active);
  port.postMessage=m=>{
   if(m.type==='CAE_STATUS'){
    t.rpc.push({...m,tabId});const send=()=>port.onMessage.fire({id:m.id,result:connected.scope});if(t.holdStatus)t.statusHeld.push(send);else queueMicrotask(send);
   }else if(m.type==='CAE_GET_CHAT'){
    t.rpc.push({...m,tabId});t.held.push({id:m.chat.id,requestId:m.id,port});
   }else post(m);
  };return port;
 };
})();
'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CAE_CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':376,'height':1024});page.set_default_timeout(9000);errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text())
  page.add_script_tag(content='const iconmap='+json.dumps(icons)+';const srcprop=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");Object.defineProperty(HTMLImageElement.prototype,"src",{get:srcprop.get,set(v){srcprop.set.call(this,iconmap[v]||v)}});if(!crypto.randomUUID)crypto.randomUUID=()=>"aaaaaaaa-bbbb-cccc-dddd-"+String(Math.random()).slice(2,14);')
  page.add_script_tag(content=fixture)
  for f in ['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/normalize.js','lib/hash.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js','panel.js']:page.add_script_tag(content=(root/f).read_text())
  page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace') && !document.querySelector('#exportCurrent').disabled")
  wait_read=lambda i:page.wait_for_function(f'__ui.held.some(x=>x.id===__ui.ids[{i}])')
  deliver=lambda i:page.evaluate(f'__ui.deliver(__ui.ids[{i}])')
  wait_rows=lambda i:page.wait_for_function(f"document.querySelectorAll('.message-row').length===200 && document.querySelector('.message-snippet')?.textContent.startsWith('Chat {i} message 0')")
  count=lambda:page.evaluate("__ui.rpc.filter(x=>x.type==='CAE_GET_CHAT').length")
  bar=page.locator('#messageLoadProgress');button=page.locator('#downloadMessages')
  page.locator('#exportCurrent').click();wait_read(0)
  assert bar.is_visible() and bar.get_attribute('value') is None and button.is_disabled()
  assert page.locator('#messageSelectionStatus').inner_text()=='Loading messages…'
  page.screenshot(path=str(qa/'selector-loading.png'))
  deliver(0);wait_rows(0);assert not bar.is_visible() and button.is_enabled()
  print('PASS: indeterminate progress during a held API response; disappears after actual messages arrive')
  def layout():return page.evaluate('''()=>{const r=document.querySelector('#messageRows').getBoundingClientRect(),c=document.querySelector('#currentSection').getBoundingClientRect(),f=document.querySelector('.footer-status').getBoundingClientRect(),m=document.querySelector('main'),b=document.querySelector('#downloadMessages').getBoundingClientRect();return {rows:r.height,cardBottom:c.bottom,footerTop:f.top,actionBottom:b.bottom,mainHeight:m.clientHeight,mainScroll:m.scrollHeight,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}}''')
  tall=layout();assert tall['rows']>350 and tall['footerTop']-tall['cardBottom']<20 and tall['actionBottom']<tall['footerTop'] and tall['mainScroll']<=tall['mainHeight']+1 and not tall['overflow'],tall
  page.screenshot(path=str(qa/'selector-full-height-1024.png'))
  page.set_viewport_size({'width':376,'height':1300});page.wait_for_timeout(120);larger=layout();assert larger['rows']-tall['rows']>=270 and larger['footerTop']-larger['cardBottom']<20,larger
  page.set_viewport_size({'width':320,'height':440});page.wait_for_timeout(100);short=layout();assert short['rows']>=64 and not short['overflow'],short
  button.scroll_into_view_if_needed();assert button.bounding_box()['y']+button.bounding_box()['height']<=440,short
  page.set_viewport_size({'width':376,'height':1024});page.evaluate("document.querySelector('main').scrollTop=0")
  print('PASS: list expands with viewport (+276 px); short viewport scrolls to actions',tall,larger,short)
  page.locator('[data-message-selection="none"]').click();assert button.is_disabled()
  page.locator('#reloadMessages').click();wait_read(0)
  page.evaluate('__ui.activate(1)');assert button.is_disabled() and page.locator('.message-row').count()==0
  wait_read(1);assert bar.is_visible();deliver(1);wait_rows(1);assert page.locator('.message-checkbox:checked').count()==200
  deliver(0);page.wait_for_timeout(150);wait_rows(1);assert button.is_enabled() and not bar.is_visible()
  print('PASS: same-workspace tab switch refreshes automatically, resets choices and rejects late old-chat reply')
  # Two rapid navigations, with an old workspace-status reply held.
  page.evaluate('__ui.holdStatus=true;__ui.activate(2)')
  page.wait_for_function('__ui.statusHeld.length>0');page.evaluate('__ui.activate(3)');page.wait_for_timeout(350)
  page.evaluate('__ui.holdStatus=false;__ui.finishStatus()');wait_read(3);deliver(3);wait_rows(3)
  assert not page.evaluate('__ui.rpc.some(x=>x.type==="CAE_GET_CHAT"&&x.chat.id===__ui.ids[2])')
  print('PASS: rapid navigation during CAE_STATUS cannot apply stale binding or load superseded chat')
  # Cross-workspace requires a new explicit action.
  n=count();page.evaluate('__ui.activate(4)')
  page.wait_for_function("document.querySelector('#messageSelectionStatus').textContent.startsWith('Workspace changed.')")
  page.wait_for_timeout(700);assert count()==n and not bar.is_visible() and button.is_disabled()
  page.locator('#reloadMessages').click();wait_read(4);deliver(4);wait_rows(4)
  assert page.evaluate('__ui.rpc.filter(x=>x.type==="CAE_GET_CHAT").at(-1).expectedAccountId')=='other-workspace'
  print('PASS: different workspace never auto-fetches, explicit Refresh uses newly verified account')
  # Back across the workspace boundary is explicit as well.
  page.evaluate('__ui.activate(3)');page.wait_for_function("document.querySelector('#messageSelectionStatus').textContent.startsWith('Workspace changed.')")
  page.locator('#reloadMessages').click();wait_read(3);deliver(3);wait_rows(3)
  # Non-chat and hidden selector do not fetch. Returning to Current follows navigation.
  n=count();page.evaluate('__ui.activate(-1)');page.wait_for_function("document.querySelector('#messageSelectionStatus').textContent.includes('Open a ChatGPT conversation')")
  assert not bar.is_visible() and button.is_disabled()
  page.locator('#modeMonitor').click();page.evaluate('__ui.activate(5)');page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
  page.wait_for_timeout(700);assert count()==n
  page.locator('#modeCurrent').click();wait_read(5);deliver(5);wait_rows(5)
  print('PASS: unrelated tabs and hidden selector do not fetch; returning to visible Current resumes same-workspace selection')
  # Same-tab SPA, API error and manual recovery.
  page.evaluate('__ui.navigate(0)');wait_read(0);page.evaluate('__ui.deliver(__ui.ids[0],true)')
  page.wait_for_function("document.querySelector('#messageSelectionStatus').textContent.includes('unavailable')")
  assert not bar.is_visible() and button.is_disabled();n=count();page.wait_for_timeout(700);assert count()==n
  page.locator('#reloadMessages').click();wait_read(0);deliver(0);wait_rows(0)
  print('PASS: same-tab chat navigation, failure without retry loop, and explicit Refresh recovery')
  # Disabling selective mode during a held response discards that response.
  page.locator('#reloadMessages').click();wait_read(0);page.locator('#currentSelect').check();deliver(0)
  page.wait_for_function("document.querySelector('#messageSelector').classList.contains('hidden')")
  n=count();page.evaluate('__ui.activate(1)');page.wait_for_timeout(900);assert count()==n
  # Old popup intents must not arm automatic loading in an unintended chat.
  page.locator('#currentSelect').uncheck();page.wait_for_timeout(100)
  n=count();page.evaluate("chrome.storage.session.set({'cae.ui.intent.1':{mode:'current',selectMessages:true,accountId:'test-workspace',conversationId:__ui.ids[0],tabId:11,at:Date.now(),nonce:'old-intent'}})")
  page.wait_for_function("document.querySelector('#messageSelectionStatus').textContent.includes('active chat changed')")
  page.wait_for_timeout(500);assert count()==n
  page.evaluate("chrome.storage.session.set({'cae.ui.intent.1':{mode:'current',selectMessages:true,accountId:'test-workspace',conversationId:__ui.ids[1],tabId:12,at:Date.now(),nonce:'valid-intent'}})")
  wait_read(1);deliver(1);wait_rows(1)
  print('PASS: stale popup intent cannot auto-fetch an unintended chat; verified intent works')
  assert not errors,errors
  assert page.evaluate("!__ui.calls.some(x=>['CAE_MANUAL_SUBMIT','CAE_LIBRARY_JOB_START','CAE_LIBRARY_JOB_ARCHIVE'].includes(x.type))")
  print('PASS: Complete conversation disables following; no downloads or inventory triggered by navigation')
 finally:browser.close()
