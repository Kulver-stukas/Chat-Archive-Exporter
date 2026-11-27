"""Real Chromium Web Locks and OPFS across page destruction (not cross-browser external Vault)."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
import threading
root=Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/tests/browser-vault.html'
try:
 with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    ctx=b.new_context();ctx.set_default_timeout(10000)
    def page():
        pg=ctx.new_page();pg.goto(url)
        pg.evaluate('''()=>{window.chrome={storage:{local:{get:async k=>({[k]:JSON.parse(localStorage.getItem(k)||'null')}),set:async o=>{for(const[k,v] of Object.entries(o))localStorage.setItem(k,JSON.stringify(v));}}},runtime:{getManifest:()=>({version:'0.2.0.4'})}};}''')
        pg.add_script_tag(content=(root/'lib/vault.js').read_text())
        return pg
    a=page();one=a.evaluate('''async()=>{const V=ChatArchiveVault,d=await navigator.storage.getDirectory();window.writer=await V.acquireLock();window.release=await V.acquireVaultGuard(d,writer,{operation:'manual_export',workspaceId:'test-account'});return (await V.inspectWriterClaims(d))[0].name;}''')
    other=page();assert other.evaluate('''async()=>{const V=ChatArchiveVault,d=await navigator.storage.getDirectory();const rows=await V.inspectWriterClaims(d);try{await V.clearWriterClaims(d,rows,true);}catch(e){return e.code;}return 'unexpected';}''')=='VAULT_BUSY'
    a.close() # real browser releases its Web Lock, but marker remains on OPFS
    result=other.evaluate('''async()=>{const V=ChatArchiveVault,d=await navigator.storage.getDirectory(),before=await V.inspectWriterClaims(d);const l=await V.acquireLock(),r=await V.acquireVaultGuard(d,l,{operation:'background_update',workspaceId:'test-account'});const during=await V.inspectWriterClaims(d);await r();await l();return {before,during,after:await V.inspectWriterClaims(d)};}''')
    assert len(result['before'])==1 and result['before'][0]['name']==one and result['before'][0]['owner']=='own',result
    assert len(result['during'])==1 and result['during'][0]['name']!=one and result['during'][0]['operation']=='background_update',result
    assert result['after']==[],result
    b.close();print('PASS: native Chromium Web Lock release on page destruction; OPFS own claim recovery; active local writer cannot be cleared')
finally:
 server.shutdown()
