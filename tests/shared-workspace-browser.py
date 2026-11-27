"""Mocked provider/extension APIs; real Chromium UI with separate saved state."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re,os
root=Path(__file__).resolve().parent.parent
qa=Path(os.environ.get('CAE_QA_DIR','/mnt/data/cae-shared-work/qa'));qa.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':385,'height':900});page.set_default_timeout(7000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>','',(root/'panel.html').read_text(),flags=re.S)
 page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text())
 page.add_script_tag(content=(root/'tests/ui-fixtures.js').read_text())
 page.evaluate('''()=>{__ui.savedLib={...__ui.lib,job:null};__ui.lib=null;__ui.sharedActivity={account_id:__ui.scope.accountId,manual:{finished_at:'2026-11-27T20:00:00Z',summary:'Complete - Browser download completed in originating browser; chats: 1/1, 0 failed. (saved history)'},library:{finished_at:'2026-11-27T20:01:00Z',summary:'Complete - Library archival: 55 saved, 0 failed. (saved history)'}};
 const send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async m=>{if(m.type==='CAE_LIBRARY_JOB_REFRESH_ONCE'){window.catalogVisibleAtRefresh=document.querySelector('#libraryGroups').textContent.includes('Generated illustration');}return send(m);};}''')
 for f in ['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','lib/markdown.js','lib/normalize.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js','panel.js']:page.add_script_tag(content=(root/f).read_text())
 page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
 page.locator('#modeLibrary').click()
 page.wait_for_function("window.catalogVisibleAtRefresh===true")
 assert page.locator('#libraryGroups').get_by_text('Generated illustration.png').is_visible()
 assert page.locator('#refreshLibrary').inner_text()=='Refresh inventory'
 assert page.evaluate('__ui.starts')==0
 page.locator('#modeMonitor').click()
 page.wait_for_function("document.querySelector('#manualSummary').textContent.includes('originating browser')&&document.querySelector('#libraryJobStatus').textContent.includes('55 saved')")
 assert not page.locator('#retryManual').is_visible() and not page.locator('#cancel').is_visible()
 assert page.locator('#libraryStop').is_disabled()
 assert not errors,errors
 page.screenshot(path=str(qa/'shared-activity.png'),full_page=True)
 b.close();print('PASS: Files renders Vault rows before API refresh; shared terminal history is display-only; no first scan or imported controls')
