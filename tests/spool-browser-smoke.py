"""Real Chromium IndexedDB smoke test (not an authenticated extension test)."""
from pathlib import Path
import os, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
try:
 with sync_playwright() as p:
     browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or '/usr/bin/chromium',headless=True,args=['--no-sandbox'])
     page=browser.new_page()
     errors=[]
     page.on('pageerror',lambda e: errors.append(str(e)))
     page.goto(f'http://127.0.0.1:{server.server_port}/tests/browser-spool.html',wait_until='load')
     page.wait_for_function("document.querySelector('#result').textContent.startsWith('PASS:') || document.querySelector('#result').textContent.startsWith('FAIL:')",timeout=20000)
     answer=page.locator('#result').inner_text()
     assert answer.startswith('PASS:'), answer
     assert not errors,errors
     print(answer)
     browser.close()
finally:
 server.shutdown()
