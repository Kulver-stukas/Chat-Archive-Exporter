"""Selective export UI in real Chromium; provider, extension APIs and jobs are fixtures."""
from pathlib import Path
import json, os, mimetypes, re
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
qa = Path(os.environ.get('CAE_QA_DIR', str(root.parent / 'qa-selective')))
qa.mkdir(parents=True, exist_ok=True)
results = []
fixture = (root / 'tests/ui-fixtures.js').read_text() + r'''
(() => {
 const key='cae.export.preferences.v1', t=__ui;
 const defaults={questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:true};
 const read=()=>({_revision:0,...defaults,...JSON.parse(localStorage.getItem(key)||'{}')});
 const notify=value=>{t.local[key]=value;chrome.storage.onChanged.fire({[key]:{newValue:value}},'local')};
 window.addEventListener('storage',event=>{if(event.key===key)notify(read())});
 const send=chrome.runtime.sendMessage;
 chrome.runtime.sendMessage=async m=>{
  if(m.type==='CAE_EXPORT_PREFS_GET')return {ok:true,result:read()};
  if(m.type==='CAE_EXPORT_PREFS_PATCH'){
   t.calls.push(structuredClone(m));
   const saved=read(),value={...saved,...m.patch,_revision:saved._revision+1};localStorage.setItem(key,JSON.stringify(value));notify(value);
   return {ok:true,result:value};
  }
  return send(m);
 };
 t.testChat={id:t.scope.currentId,title:'Selection test',branchNode:'a2',messages:[
  {id:'q1',role:'user',content:'First question with <script>literal text</script>',textContent:'First question with <script>literal text</script>',attachments:[]},
  {id:'t1',role:'thinking',content:'Available thought summary.',attachments:[]},
  {id:'a1',role:'assistant',content:'First answer\n'+('More response text. '.repeat(90)),textContent:'First answer\n'+('More response text. '.repeat(90)),attachments:[]},
  {id:'q2',role:'user',content:'Second question',textContent:'Second question',attachments:[{key:'file:upload',fileId:'file_upload',origin:'uploaded',name:'upload.txt',messageId:'q2'}]},
  {id:'a2',role:'assistant',content:'Second answer',textContent:'Second answer',attachments:[{key:'file:generated',fileId:'file_generated',origin:'generated',name:'result.txt',messageId:'a2'}]}
 ]};
 const connect=chrome.tabs.connect;
 chrome.tabs.connect=(...args)=>{
  const port=connect(...args), post=port.postMessage;
  port.postMessage=m=>{
   if(m.type==='CAE_GET_CHAT'){
    t.rpc.push(structuredClone(m));
    queueMicrotask(()=>port.onMessage.fire({id:m.id,...(t.chatError?{error:'Fixture: chat unavailable'}:{result:structuredClone(t.testChat)})}));
   }else post(m);
  };return port;
 };
})();
'''

with sync_playwright() as p:
    executable = os.environ.get('CAE_CHROMIUM_PATH')
    browser = p.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox'])
    context = browser.new_context()
    context.set_default_timeout(8000)
    context.add_init_script(script=fixture)

    def serve(route):
        relative = route.request.url.split('https://cae.test/', 1)[1].split('?', 1)[0]
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            return route.fulfill(status=404, body='')
        data=file.read_bytes()
        if file.suffix=='.html':
            data=re.sub(rb'<script src="lib/(?:vault|manual-store|library-store)\.js"></script>',b'',data)
        route.fulfill(body=data, content_type=mimetypes.guess_type(file.name)[0] or 'application/octet-stream')

    context.route('https://cae.test/**', serve)

    def page(surface, width=392, dark=False):
        pg = context.new_page()
        pg.set_viewport_size({'width': width, 'height': 850})
        pg.emulate_media(color_scheme='dark' if dark else 'light')
        errors = []
        pg.on('pageerror', lambda error: errors.append(str(error)))
        pg.goto('https://cae.test/' + surface + '.html')
        pg.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
        pg.wait_for_function("!document.querySelector('#exportMenuToggle').disabled")
        assert not errors, errors
        return pg, errors

    def record(name):
        results.append({'name': name, 'pass': True})
        print('PASS', name)

    try:
        popup, popup_errors = page('popup')
        assert popup.locator('#currentSelect').is_visible() and popup.locator('#currentSelect').is_checked()
        popup.locator('#exportMenuToggle').click()
        assert popup.locator('#exportAll').is_checked()
        popup.locator('#exportThinking').uncheck()
        popup.wait_for_function("document.querySelector('#exportAll').indeterminate")
        popup.screenshot(path=str(qa / 'selective-popup-options.png'), full_page=True)
        popup.keyboard.press('Escape')
        assert not popup.locator('#exportContentMenu').is_visible()
        popup.locator('#exportCurrent').click()
        popup.wait_for_function("__ui.calls.some(x=>x.type==='CAE_MANUAL_SUBMIT')")
        selected = popup.evaluate("__ui.calls.find(x=>x.type==='CAE_MANUAL_SUBMIT').options.exportSelection")
        assert selected['completeConversation'] and not selected['thinking'] and selected['questions']
        record('Split button, mixed All, keyboard close and current export settings snapshot')

        popup.evaluate('finishUIManual()')
        popup.locator('#navExport').click()
        popup.locator('#currentSelect').uncheck()
        popup.wait_for_function("!document.querySelector('#exportCurrent').disabled")
        before = popup.evaluate("__ui.calls.filter(x=>x.type==='CAE_MANUAL_SUBMIT').length")
        popup.locator('#exportCurrent').click()
        intent = popup.evaluate("__ui.session['cae.ui.intent.1']")
        assert intent['selectMessages'] and intent['conversationId'] and intent['tabId'] == 11
        assert popup.evaluate("__ui.calls.filter(x=>x.type==='CAE_MANUAL_SUBMIT').length") == before
        record('Incomplete conversation opens panel with bound chat intent without submitting a job')

        panel, panel_errors = page('panel', 320)
        panel.evaluate('(intent)=>chrome.storage.session.set({"cae.ui.intent.1":intent})', intent)
        panel.wait_for_selector('.message-checkbox')
        assert panel.locator('.message-checkbox').count() == 4
        assert not panel.locator('#currentSelect').is_checked()
        assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth')
        # Every collapsed question/answer has one line. Answer checkboxes are nested visually only.
        layout=panel.locator('.message-row').evaluate_all("rows=>rows.map(r=>({height:r.getBoundingClientRect().height,x:r.querySelector('input').getBoundingClientRect().left,text:r.querySelector('.message-snippet').textContent,line:getComputedStyle(r.querySelector('.message-snippet')).whiteSpace}))")
        assert all(25 <= row['height'] <= 32 and row['line']=='nowrap' for row in layout),layout
        assert layout[1]['x']-layout[0]['x']==15,layout
        assert layout[1]['text']=='First answer',layout
        # Preview the answer whether Thinking is enabled or disabled.
        answer=panel.locator('.message-row[data-role="answer"]').first
        answer.locator('summary').click()
        assert answer.locator('.message-preview').inner_text().startswith('First answer')
        assert 'Available thought summary.' not in answer.locator('.message-preview').inner_text()
        answer.locator('summary').click()
        popup.locator('#exportMenuToggle').click()
        popup.locator('#exportThinking').check()
        panel.wait_for_function("document.querySelector('#exportThinking').checked")
        assert panel.locator('.message-row[data-role="answer"] .message-snippet').first.inner_text()=='First answer'
        popup.keyboard.press('Escape')
        panel.screenshot(path=str(qa / 'compact-selector-320.png'), full_page=True)
        record('One-line rows, indented answers, answer-only previews with Thinking on and off')
        panel.locator('[data-message-selection="answer"]').click()
        assert panel.locator('.message-checkbox:checked').count() == 2
        panel.locator('[data-message-selection="invert"]').click()
        assert panel.locator('.message-checkbox:checked').count() == 2
        panel.locator('[data-message-selection="none"]').click()
        assert panel.locator('#downloadMessages').is_disabled()
        panel.locator('[data-message-selection="all"]').click()
        panel.locator('.message-copy summary').first.click()
        assert panel.locator('.message-preview').first.inner_text().startswith('First question with <script>')
        panel.screenshot(path=str(qa / 'selective-panel-320.png'), full_page=True)
        record('Logical response grouping, bulk selection, empty guard, safe previews and 320px layout')

        popup.locator('#exportMenuToggle').click()
        popup.locator('#exportAll').uncheck()
        popup.locator('#exportUploaded').check()
        panel.wait_for_function("document.querySelector('#exportUploaded').checked && !document.querySelector('#exportQuestions').checked")
        assert panel.locator('.message-checkbox:enabled').count() == 1
        assert panel.locator('.message-checkbox:checked').count() == 1
        panel.locator('#keepPanelOpen').check()
        panel.locator('#downloadMessages').click()
        panel.wait_for_function("__ui.calls.some(x=>x.type==='CAE_MANUAL_SUBMIT')")
        request = panel.evaluate("__ui.calls.find(x=>x.type==='CAE_MANUAL_SUBMIT').options.exportSelection")
        assert request['messageIds'] == ['q2'] and request['uploadedFiles'] and not request['questions'] and not request['completeConversation']
        assert request['branchNode'] == 'a2'
        record('Preferences synchronize across surfaces; attachment-only exports include selected message IDs')

        panel.evaluate('finishUIManual()')
        panel.locator('#modeCurrent').click()
        panel.evaluate("__ui.scope.currentId='bbbbbbbb-1111-2222-3333-444444444444'; __ui.testChat.id=__ui.scope.currentId; __ui.testChat.messages[0].textContent='New chat question'; chrome.tabs.onUpdated.fire(11,{url:'https://chatgpt.com/c/'+__ui.scope.currentId},{active:true})")
        panel.wait_for_function("document.querySelectorAll('.message-checkbox').length===0")
        assert panel.locator('#downloadMessages').is_disabled()
        panel.wait_for_function("document.querySelector('.message-snippet')?.textContent==='New chat question'")
        assert panel.locator('#downloadMessages').is_enabled()
        record('SPA chat change invalidates concrete selection and automatically reloads the same workspace')

        dark, dark_errors = page('panel', 320, True)
        assert dark.locator('#exportUploaded').is_checked() and not dark.locator('#exportQuestions').is_checked()
        dark.locator('#exportCurrent').click()
        dark.wait_for_selector('.message-checkbox')
        dark.screenshot(path=str(qa / 'selective-panel-dark-320.png'), full_page=True)
        assert dark.evaluate('document.documentElement.scrollWidth <= innerWidth')
        dark.evaluate('__ui.chatError=true')
        dark.locator('#reloadMessages').click()
        dark.wait_for_function("document.querySelector('#messageSelectionStatus').textContent.includes('unavailable')")
        assert dark.locator('#downloadMessages').is_disabled()
        record('Settings survive a new instance; dark layout and failed reload do not submit empty exports')
        assert not popup_errors + panel_errors + dark_errors, popup_errors + panel_errors + dark_errors
    finally:
        (qa / 'selective-ui-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        browser.close()
