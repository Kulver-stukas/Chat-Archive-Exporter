"""Real Chromium widget UI with synthetic worker responses and a test-only closed-root handle."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent;qa=Path(os.environ.get('CAE_QA_DIR','/mnt/data/cae_017_qa'));qa.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 pg=b.new_page(viewport={'width':980,'height':720});pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.set_content('<!doctype html><html><head><style>body{font:15px system-ui;background:#f3f5f5;margin:40px;color:#35424a}main{width:550px;margin:auto}article{background:white;border:1px solid #ddd;border-radius:12px;padding:24px;margin:20px 0}</style></head><body><main><h1>ChatGPT page fixture</h1><article>Ordinary chat content remains interactive.</article><button id="cae-inpage-button">Legacy export</button></main></body></html>')
 pg.add_script_tag(content=(root/'tests/ui-fixtures.js').read_text())
 pg.add_script_tag(content="const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){const r=attach.call(this,o);if(this.id==='cae-monitor-widget')window.testWidgetRoot=r;return r;};")
 pg.add_script_tag(content=(root/'ui/widget.js').read_text());pg.wait_for_timeout(120)
 assert pg.locator('#cae-monitor-widget').count()==0,'Widget must be opt-in'
 assert pg.locator('#cae-inpage-button').is_hidden(),'Legacy button must always be suppressed'
 pg.evaluate("chrome.runtime.onMessage.fire({type:'CAE_UI_WIDGET_SHOW'},{id:'mock-extension'},()=>{})")
 pg.wait_for_function('!!window.testWidgetRoot')
 def click(id):pg.evaluate_handle('(id)=>testWidgetRoot.getElementById(id)',id).as_element().click()
 click('bubble');pg.wait_for_function("testWidgetRoot.getElementById('workspace').textContent==='Test workspace'")
 assert pg.locator('#cae-inpage-button').is_hidden()
 before=pg.evaluate('__ui.binds')
 for _ in range(3):
  pg.evaluate("chrome.storage.onChanged.fire({'cae.library-status.v1':{newValue:{}}},'local')");pg.wait_for_timeout(300)
 assert pg.evaluate('__ui.binds')==before,'Job updates use cached UI state, no repeated workspace verification'
 assert pg.evaluate('__ui.starts')==0
 pg.screenshot(path=str(qa/'widget-short.png'))
 click('logsToggle');assert pg.evaluate("!testWidgetRoot.getElementById('long').hidden")
 assert pg.evaluate("(()=>{const box=testWidgetRoot.getElementById('box');return box.scrollHeight<=box.clientHeight+2})()"),'no outer widget scroll at 720px'
 assert pg.evaluate("!!testWidgetRoot.getElementById('manualLog').textContent")
 click('quick');pg.wait_for_function("__ui.calls.some(m=>m.type==='CAE_MANUAL_QUICK')")
 click('files');assert pg.evaluate("__ui.calls.some(m=>m.type==='CAE_UI_OPEN_PANEL'&&m.mode==='library')")
 click('settings');assert pg.evaluate("__ui.calls.some(m=>m.type==='CAE_UI_OPEN_SETTINGS')")
 handle=pg.evaluate_handle("testWidgetRoot.getElementById('drag')").as_element();handle.focus();pg.keyboard.press('ArrowLeft')
 assert pg.locator('#cae-monitor-widget').evaluate('(e)=>e.style.left')
 pg.screenshot(path=str(qa/'widget-expanded.png'))
 click('minimize');pg.screenshot(path=str(qa/'widget-collapsed.png'))
 click('bubble');click('dismiss');assert pg.locator('#cae-monitor-widget').count()==0
 assert pg.locator('#cae-inpage-button').is_hidden(),'Closing the widget must not restore the old floating MD button'
 pg.evaluate("chrome.storage.local.set({'cae.ui.preferences.v1':{widgetEnabled:true,theme:'dark'}})");pg.wait_for_function("!!document.getElementById('cae-monitor-widget')")
 assert pg.locator('#cae-monitor-widget').get_attribute('data-theme')=='dark'
 click('dismiss');pg.wait_for_function("!__ui.local['cae.ui.preferences.v1'].widgetEnabled")
 assert pg.locator('#cae-monitor-widget').count()==0
 pg.evaluate("chrome.runtime.onMessage.fire({type:'CAE_UI_WIDGET_TOGGLE'},{id:'mock-extension'},()=>{})")
 pg.wait_for_function("!!document.getElementById('cae-monitor-widget')")
 pg.evaluate("chrome.runtime.onMessage.fire({type:'CAE_UI_WIDGET_TOGGLE'},{id:'mock-extension'},()=>{})")
 pg.wait_for_function("!document.getElementById('cae-monitor-widget')")
 assert not errors,errors
 (qa/'widget-results.json').write_text(json.dumps({'passed':True,'scenarios':['opt-in','show/collapse/dismiss','workspace and progress','cached status only','quick command','open files/settings','keyboard reposition','theme'],'errors':errors},indent=2))
 print('PASS: optional widget, cached state, commands, permanent legacy button suppression, short/long logs, dismiss resets settings toggle, keyboard reposition and theme; no JS errors')
 b.close()
