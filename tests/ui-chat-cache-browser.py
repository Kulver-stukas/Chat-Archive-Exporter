"""Chromium: last saved chats appear before provider listing and survive API errors."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re,os
root=Path(__file__).resolve().parent.parent
qa=Path(os.environ.get('CAE_QA_DIR','/mnt/data/cae017r3/qa'));qa.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':340,'height':720});page.set_default_timeout(7000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>','',(root/'panel.html').read_text(),flags=re.S)
 page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text())
 page.add_script_tag(content=(root/'tests/ui-fixtures.js').read_text())
 for f in ['lib/export-selection.js','lib/normalize.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js']:
  page.add_script_tag(content=(root/f).read_text())
 page.evaluate('''() => {
   const current=__ui.items[0];const old={id:'dddddddd-1111-2222-3333-444444444444',title:'Older Vault chat',projectId:current.projectId,project:'Engineering'};
   const C=CAEUIChatListCache;
   __ui.local[C.key('test-workspace')]=C.envelope('test-workspace','Vault workspace index',[current,old],__ui.projects);
   const oldConnect=chrome.tabs.connect;
   __ui.pendingList=null;__ui.listRequested=0;
   chrome.tabs.connect=function(...args){
     const port=oldConnect(...args),original=port.postMessage.bind(port);
     port.postMessage=(msg)=>{
       if(msg.type==='CAE_LIST'){
         __ui.listRequested++;
         __ui.pendingList=(error=false)=>error?port.onMessage.fire({id:msg.id,error:'Simulated API outage'}):original(msg);
       }else original(msg);
     };
     return port;
   };
 }''')
 page.add_script_tag(content=(root/'panel.js').read_text());page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
 page.locator('#modeAll').click()
 page.wait_for_function("__ui.listRequested===1 && document.querySelectorAll('.chat-checkbox').length===2")
 assert 'saved chats' in page.locator('#listSummary').inner_text()
 assert 'Older Vault chat' in page.locator('#groupList').inner_text()
 page.locator('#groupList .chat-checkbox').first.check()
 assert page.locator('#exportSelected').is_enabled(),'saved list is usable while API request runs'
 page.screenshot(path=str(qa/'panel-cached-before-api.png'))
 page.evaluate('__ui.pendingList()')
 page.wait_for_function("document.querySelectorAll('.chat-checkbox').length===3")
 assert 'current chats' in page.locator('#listSummary').inner_text()
 assert 'Older Vault chat' not in page.locator('#groupList').inner_text()
 assert page.locator('#selectedCount').inner_text().startswith('1 chats')
 page.evaluate("__ui.listRequested=0")
 # Trigger an explicit refresh, then fail it. Previously loaded rows must remain.
 page.locator('#openTools').click()
 page.locator('#loadAll').click()
 page.wait_for_function('__ui.listRequested===1')
 page.evaluate('__ui.pendingList(true)')
 page.wait_for_function("document.querySelector('#listSummary').textContent.includes('update unavailable')")
 assert page.locator('#selectedCount').inner_text().startswith('1 chats')
 assert not errors,errors
 print('PASS: 2 cached Vault rows displayed before API reply; selection usable; 3 current rows replace; selection preserved; outage keeps cached rows')
 b.close()
