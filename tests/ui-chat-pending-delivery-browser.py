"""Regression: a canceled browser Save must not block cached or live Chats."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
root=Path(__file__).resolve().parent.parent

def run_scenario(browser,with_cache):
    page=browser.new_page(viewport={'width':340,'height':720})
    page.set_default_timeout(9000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>','',(root/'panel.html').read_text(),flags=re.S)
    page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text())
    page.add_script_tag(content=(root/'tests/ui-fixtures.js').read_text())
    for f in ['lib/export-selection.js','lib/normalize.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js']:
        page.add_script_tag(content=(root/f).read_text())
    page.evaluate('''(withCache) => {
      const t=__ui;
      t.manual={id:'canceled-zip',accountId:t.scope.accountId,workspace:t.scope.display,destination:'download',
        status:'download_failed',active:true,phase:'deliver',message:'Browser download interrupted: USER_CANCELED. Staged bytes retained; use Retry delivery.',
        totalChats:1,chatsDone:1,counts:{saved:1,skipped:0,failed:0},logs:[]};
      if(withCache){
        const cached=CAEUIChatListCache.envelope(t.scope.accountId,'Vault workspace index',
         [{id:'dddddddd-1111-2222-3333-444444444444',title:'Previously saved chat',projectId:''}],[]);
        t.local[CAEUIChatListCache.key(t.scope.accountId)]=cached;
      }
      t.listRequested=0;t.pendingList=null;
      const oldConnect=chrome.tabs.connect;
      chrome.tabs.connect=function(...args){
        const port=oldConnect(...args),original=port.postMessage.bind(port);
        port.postMessage=(msg)=>{
          if(msg.type==='CAE_LIST'){
            t.listRequested++;
            t.pendingList=()=>original(msg);
          }else original(msg);
        };return port;
      };
    }''',with_cache)
    for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
        page.add_script_tag(content=(root/provider_file).read_text())
    page.add_script_tag(content=(root/'panel.js').read_text())
    page.wait_for_function("document.querySelector('#manualSummary').textContent.includes('Download canceled by user')")
    page.locator('#modeAll').click()
    page.wait_for_function('__ui.listRequested===1')
    if with_cache:
        page.wait_for_function("document.querySelector('#listSummary').textContent.includes('saved chats')")
        assert 'Previously saved chat' in page.locator('#groupList').inner_text()
    else:
        assert page.locator('.chat-checkbox').count()==0
    page.evaluate('__ui.pendingList()')
    page.wait_for_function("document.querySelectorAll('.chat-checkbox').length===3")
    assert page.locator('#listSummary').inner_text().startswith('3 current chats')
    assert page.evaluate('__ui.manual.status')=='download_failed', 'UI list must not modify the pending ZIP delivery'
    assert page.evaluate('__ui.manual.active'), 'staged ZIP is still retryable'
    assert not errors,errors
    page.close()
    return 'cached data first' if with_cache else 'cold API-only listing'

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    try:
        for with_cache in [True,False]:
            description=run_scenario(browser,with_cache)
            print('PASS: canceled Save / retained active job does not block',description)
    finally:browser.close()
