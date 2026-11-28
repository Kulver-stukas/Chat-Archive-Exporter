"""Actual Chromium list/filter UI with synthetic provider and Vault results."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':1050});page.set_default_timeout(7000);errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>','',(root/'panel.html').read_text(),flags=re.S)
 page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text());page.add_script_tag(content=(root/'tests/ui-fixtures.js').read_text())
 for f in ['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','lib/markdown.js','lib/normalize.js','contracts/resources.js','providers/chatgpt/storage-profile.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js']:
  page.add_script_tag(content=(root/f).read_text())
 page.evaluate('''()=>{const t=__ui,prefix='ChatGPT/Test',updated='2026-11-27T10:00:00Z',ms=Date.parse(updated);
 t.items=[{id:'manual-0001',title:'Manual saved',updated},{id:'background-0002',title:'Background saved',updated},{id:'outdated-0003',title:'Older copy',updated},{id:'provider-0004',title:'Provider archived only',updated,archived:true}];
 t.projects=[];const chats={};for(const [i,c] of t.items.slice(0,3).entries())chats[c.id]={conversation_id:c.id,title:c.title,project_id:'',archived:false,path:prefix+'/'+c.id+'.md',sha256:'a'.repeat(64),bytes:99,updated_ms:ms-(i===2?1000:0),listed_updated_ms:ms-(i===2?1000:0)};
 t.chatVault=CAEUIChatListCache.fromIndex({schema:'cae.workspace-chats.v1',account_id:t.scope.accountId,chats},null,t.scope.accountId,prefix);
 }''')
 page.add_script_tag(content=(root/'panel.js').read_text());page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
 page.locator('#modeAll').click();page.wait_for_function("document.querySelectorAll('.chat-row').length===4 && document.querySelectorAll('.chat-checkbox[data-archived=true]').length===2")
 assert page.locator('.chat-row').filter(has_text='Provider archived only').locator('.item-badge').count()==0
 assert 'ChatGPT archive' in page.locator('.chat-row').filter(has_text='Provider archived only').inner_text()
 assert 'update pending' in page.locator('.chat-row').filter(has_text='Older copy').inner_text()
 page.locator('#chatArchived').select_option('archived');assert page.locator('.chat-row').count()==2
 assert 'Manual saved' in page.locator('#groupList').inner_text() and 'Background saved' in page.locator('#groupList').inner_text()
 page.locator('#chatArchived').select_option('active');assert page.locator('.chat-row').count()==2
 assert 'Provider archived only' in page.locator('#groupList').inner_text() and 'Older copy' in page.locator('#groupList').inner_text()
 assert not errors,errors
 print('PASS: actual Chats UI archived filter uses saved current Vault revision, not provider archive flag')
 b.close()
