"""Real browser IDB/Blob/OPFS tests; Chrome messaging/downloads/provider are mocked."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import base64,json,threading,os,tempfile,zipfile,io
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/tests/browser-manual.html'
try:
 with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context();page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
    page.evaluate('''async()=>{const d=await __root();await ChatArchiveManualStore.bind('browser-vault-job-0001',d);
      return ChatArchiveManualJobs.submit(__opts('browser-vault-job-0001',[1,2,3,4,5,6].map(__item)));}''')
    # Closing the execution page simulates losing all in-memory controller state.
    page.close();page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
    page.evaluate('ChatArchiveManualJobs.startup()')
    page.wait_for_function("window.__state?.active===false",timeout=90000)
    state=page.evaluate('__state');assert state['counts']['saved']==6,state;assert state['sources']['saved']==1,state
    result=page.evaluate('''async()=>{const d=await __root();const f=await ChatArchiveVault.lookupFile(d,'ChatGPT/Browser Workspace/Browser Project/Sources/original.bin');
      const ledger=await ChatArchiveVault.readJson(d,'ChatGPT/Browser Workspace/.workspace.json');
      return {bytes:[...new Uint8Array(await(await f.handle.getFile()).arrayBuffer())],count:Object.keys(ledger.chats).length};}''')
    assert result=={'bytes':[0,255,239,187,191,65,13,10,0,128],'count':6},result
    page.evaluate("ChatArchiveManualJobs.submit(__opts('browser-zip-job-0002',[__item(1)],'download'))")
    page.wait_for_function("window.__state?.id==='browser-zip-job-0002' && !__state.active",timeout=60000)
    downloaded=page.evaluate('__downloads[0]');assert downloaded['filename'].endswith('.zip')
    z=zipfile.ZipFile(io.BytesIO(base64.b64decode(downloaded['base64'])));assert z.testzip() is None
    source=next(n for n in z.namelist() if n.endswith('original.bin'));assert z.read(source)==bytes(result['bytes'])
    chat=next(n for n in z.namelist() if 'Browser chat 1 [' in n)
    assert '## Response:' in z.read(chat).decode() and '## Prompt:' in z.read(chat).decode()
    assert any(n.endswith('/_project.md') for n in z.namelist())
    assert any(n.endswith('/_archive_report.md') for n in z.namelist())
    assert not any(n.endswith('/_personalization.md') for n in z.namelist())
    assert not errors,errors
    print('PASS: Chromium real IndexedDB job/handle/Blob persistence across page destruction; real OPFS binary Vault writes; actual ZIP assembly and Python byte verification; mocked Chrome and provider APIs')
    browser.close()
finally:
 server.shutdown()
