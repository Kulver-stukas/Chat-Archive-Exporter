"""Render the actual selector in Chromium with synthetic messages and extension APIs.
No network navigation or authorized ChatGPT/Vault access is required.
"""
from pathlib import Path
import base64, json, os, re
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
qa = Path(os.environ.get('CAE_QA_DIR', str(root.parent / 'qa')))
qa.mkdir(parents=True, exist_ok=True)
html = re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root / 'panel.html').read_text(), flags=re.S)
icons = {str(f.relative_to(root)): 'data:image/png;base64,' + base64.b64encode(f.read_bytes()).decode() for f in (root / 'icons').glob('*.png')}
for name, data in icons.items():
    html = html.replace('src="'+name+'"', 'src="'+data+'"')
fixture = (root / 'tests/ui-fixtures.js').read_text() + r'''
(() => {
 const t=__ui;
 t.local['cae.export.preferences.v1']={questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:false,_revision:1};
 const messages=[];
 for(let i=1;i<=100;i++){
   messages.push({id:'q'+i,role:'user',textContent:'Question '+i+': '+('Long first line of question. '.repeat(10))+'\nSecond line.',attachments:[]});
   messages.push({id:'t'+i,role:'thinking',content:'THOUGHT SUMMARY '+i,attachments:[]});
   messages.push({id:'a'+i,role:'assistant',textContent:'Answer '+i+': '+('Long first line of answer. '.repeat(10))+'\nSecond line of response.',attachments:[]});
 }
 // A generated-image-only reply must display its title, and the footer
 // must announce a ZIP while the corresponding reference is selected.
 const imageReply=messages.find(m=>m.id==='a2');
 imageReply.textContent='';imageReply.attachments=[{key:'file:file_generated',fileId:'file_generated',name:'Generated illustration',origin:'generated',mediaClass:'image',messageId:'a2'}];
 messages.find(m=>m.id==='q3').attachments=[{key:'file:file_uploaded',fileId:'file_uploaded',name:'Uploaded original.jpg',origin:'uploaded',mediaClass:'image',messageId:'q3'}];
 t.testChat={id:t.scope.currentId,title:'Long conversation test',branchNode:'a100',messages};
 const connect=chrome.tabs.connect;
 chrome.tabs.connect=(...args)=>{
  const port=connect(...args),post=port.postMessage;
  port.postMessage=m=>{
   if(m.type==='CAE_GET_CHAT')queueMicrotask(()=>port.onMessage.fire({id:m.id,result:structuredClone(t.testChat)}));
   else post(m);
  };return port;
 };
})();
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CAE_CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    try:
        for width,dark in [(320,False),(400,True)]:
            page=browser.new_page(viewport={'width':width,'height':850},color_scheme='dark' if dark else 'light')
            page.set_default_timeout(6000)
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(html)
            page.add_style_tag(content=(root/'styles.css').read_text())
            page.add_script_tag(content='const iconmap='+json.dumps(icons)+';const srcprop=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");Object.defineProperty(HTMLImageElement.prototype,"src",{get:srcprop.get,set(v){srcprop.set.call(this,iconmap[v]||v)}});if(!crypto.randomUUID)crypto.randomUUID=()=>"aaaaaaaa-bbbb-cccc-dddd-"+String(Math.random()).slice(2,14);')
            page.add_script_tag(content=fixture)
            for f in ['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','lib/markdown.js','lib/normalize.js','lib/hash.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js','panel.js']:
                page.add_script_tag(content=(root/f).read_text())
            page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace') && !document.querySelector('#exportCurrent').disabled")
            page.locator('#exportCurrent').click()
            page.wait_for_function("document.querySelectorAll('.message-row').length === 200")
            rows=page.locator('.message-row')
            layout=rows.evaluate_all("rows=>rows.map(r=>({h:r.getBoundingClientRect().height,x:r.querySelector('input').getBoundingClientRect().left,text:r.querySelector('.message-snippet').textContent,line:getComputedStyle(r.querySelector('.message-snippet')).whiteSpace}))")
            assert all(25<=r['h']<=32 and r['line']=='nowrap' for r in layout),layout[:4]
            assert layout[1]['x']-layout[0]['x']==15,layout[:2]
            assert layout[1]['text'].startswith('Answer 1:'),layout[1]
            assert all('\n' not in r['text'] and 'THOUGHT SUMMARY' not in r['text'] for r in layout)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('.message-copy[open]').count()==0
            assert page.locator('.message-checkbox:checked').count()==200
            assert page.locator('#exportCurrent').is_disabled()
            assert page.locator('#exportMenuToggle').is_enabled()
            assert not page.locator('#quickVault').is_visible()
            assert not page.locator('#messageSelectionStatus').is_visible()
            assert 'Generated illustration' in rows.nth(3).locator('.message-snippet').inner_text()
            assert page.locator('#downloadMessages').inner_text()=='Download selection as .zip'
            assert page.locator('#exportContentSummary').bounding_box()['height']<=1
            page.screenshot(path=str(qa/f'compact-selector-{width}.png'))
            a=rows.nth(1)
            a.locator('summary').click()
            assert a.locator('.message-preview').inner_text().startswith('Answer 1:')
            assert 'Second line of response.' in a.locator('.message-preview').inner_text()
            assert 'THOUGHT SUMMARY' not in a.locator('.message-preview').inner_text()
            assert rows.nth(2).bounding_box()['height']<=32
            page.screenshot(path=str(qa/f'compact-expanded-{width}.png'))
            a.locator('summary').click()
            page.locator('#exportMenuToggle').click()
            page.locator('#exportThinking').uncheck()
            page.wait_for_function("!document.querySelector('#exportThinking').checked")
            assert rows.nth(1).locator('.message-snippet').inner_text().startswith('Answer 1:')
            page.locator('#exportUploaded').uncheck()
            page.locator('#exportGenerated').uncheck()
            page.wait_for_function("!document.querySelector('#exportGenerated').checked && document.querySelector('#downloadMessages').textContent==='Download selection as .md'")
            assert rows.nth(3).locator('.message-checkbox').is_disabled()
            assert page.locator('[data-message-selection="files"]').is_disabled()
            page.locator('#exportGenerated').check()
            page.wait_for_function("document.querySelector('#exportGenerated').checked && document.querySelector('#downloadMessages').textContent==='Download selection as .zip'")
            page.keyboard.press('Escape')
            page.locator('[data-message-selection="files"]').click()
            assert page.locator('.message-checkbox:checked').count()==1
            assert page.locator('.message-row:has(.message-checkbox:checked)').get_attribute('data-row-id')=='t2'
            page.locator('#exportMenuToggle').click();page.locator('#exportUploaded').check();page.keyboard.press('Escape')
            page.wait_for_function("document.querySelector('#exportUploaded').checked")
            page.locator('[data-message-selection="files"]').click()
            assert page.locator('.message-checkbox:checked').count()==2
            assert '2 files' in page.locator('#messageSelectedCount').inner_text()
            assert page.locator('#downloadMessages').inner_text()=='Download selection as .zip'
            assert page.evaluate("[...document.querySelectorAll('button')].every(b=>b.title.trim())")
            page.locator('[data-message-selection="answer"]').click()
            assert page.locator('.message-checkbox:checked').count()==100
            page.locator('[data-message-selection="none"]').click()
            assert page.locator('#downloadMessages').is_disabled()
            assert not errors, errors
            print(f'PASS: {width}px {"dark" if dark else "light"}; 200 rows, height={layout[0]["h"]}px, 15px answer indent, actual response, selection and no horizontal overflow')
            page.close()
    finally:
        browser.close()
