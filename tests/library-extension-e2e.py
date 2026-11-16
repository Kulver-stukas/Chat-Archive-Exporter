"""Actual MV3 worker, real content-script RPC and OPFS; ChatGPT responses are local fixtures."""
from pathlib import Path
import json, os, tempfile, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
account='account-e2e'
fids=['file_'+str(i).zfill(32) for i in (1,2)]
counts={'details':0,'bytes':0,'listing':0}
def route_handler(route):
    url=urlparse(route.request.url);path=url.path
    if path.startswith('/c/'):
        return route.fulfill(status=200,content_type='text/html',body='<!doctype html><title>Local ChatGPT fixture</title><main>Test conversation</main>')
    if path=='/api/auth/session':data={'accessToken':'TEST-AUTH-NEVER-PERSIST','account':{'id':account,'name':'Workspace E2E'}}
    elif path=='/backend-api/gizmos/snorlax/sidebar':data={'items':[],'cursor':None}
    elif path=='/backend-api/files/library/nodes':
        counts['listing']+=1
        data={'items':[{'id':'libfile_'+str(i).zfill(12),'kind':'file','file_id':fids[i-1],'name':'one.txt' if i==1 else 'two.js',
                       'mime_type':'text/plain' if i==1 else 'application/javascript','file_size_bytes':3,
                       'parent_directory_id':'libdir_root','record_creation_time':'2026-11-01T00:00:00Z'} for i in (1,2)],'cursor':None}
    elif path=='/backend-api/my/recent/image_gen':data={'items':[],'after':None}
    elif path.startswith('/backend-api/files/download/'):
        fid=path.split('/')[-1];data={'download_url':'https://chatgpt.com/backend-api/estuary/content?id='+fid+'&sig=TEST-URL-NEVER-PERSIST'}
    elif path.startswith('/backend-api/files/file_'):
        counts['details']+=1;data={'id':path.split('/')[-1],'use_case':'caas','size':3,'metadata':{'source_ip':'PRIVATE-IP'}}
    elif path=='/backend-api/estuary/content':
        counts['bytes']+=1
        if parse_qs(url.query).get('id')==[fids[1]]:return route.fulfill(status=415,content_type='application/json',body='{"error":"unsupported"}')
        return route.fulfill(status=200,content_type='text/plain',body='abc')
    else:return route.fulfill(status=404,content_type='application/json',body='{}')
    return route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='cae-extension-e2e-') as profile:
    context=p.chromium.launch_persistent_context(profile,executable_path=os.environ.get('CHROME_BIN') or '/usr/bin/chromium',headless=os.environ.get('CAE_HEADED') != '1',ignore_default_args=['--disable-extensions'],
        args=['--no-sandbox','--disable-extensions-except='+str(root),'--load-extension='+str(root)])
    context.route('https://chatgpt.com/**',route_handler)
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=10000)
    page=context.new_page();page.goto('https://chatgpt.com/c/aaaaaaaa-1111-2222-3333-444444444444')
    page.wait_for_timeout(500)
    status=worker.evaluate('''async ()=>{
      const dir=await navigator.storage.getDirectory();
      // OPFS is an isolated test Vault, not a user-selected filesystem handle.
      ChatArchiveVault.permissionState=async handle=>({state:handle?'granted':'no_handle'});
      await ChatArchiveLibraryStore.bind('account-e2e',dir);
      const tab=(await chrome.tabs.query({url:'https://chatgpt.com/*'}))[0];
      return ChatArchiveLibraryJobs.start({accountId:'account-e2e',display:'Workspace E2E',tabId:tab.id,monitor:false});
    }''')
    assert status['job']['active']
    def wait_done():
        end=time.time()+20
        while time.time()<end:
            state=worker.evaluate("()=>ChatArchiveLibraryJobs.inspect('account-e2e')")
            if not state['job']['active']:return state
            if state['job']['status'] in ('error','retry_wait','permission_required','waiting_for_tab','cooldown'):
                raise AssertionError(state['job'])
            page.wait_for_timeout(100)
        raise AssertionError('Library job did not complete')
    state=wait_done();assert state['job']['status']=='complete',state
    assert state['catalog']['summary']['total']==2
    assert counts['details']==2 and counts['bytes']==0,counts
    snapshot=worker.evaluate('''async()=>{const dir=await navigator.storage.getDirectory();const x=await ChatArchiveVault.readJson(dir,'ChatGPT/Workspace E2E/_Library/_inventory.json');return x;}''')
    assert snapshot['baseline_at'];assert 'TEST-AUTH' not in json.dumps(snapshot)
    before=counts.copy();page.wait_for_timeout(600)
    assert counts==before,'No implicit scan is allowed after manual completion'
    worker.evaluate('''async()=>{
      const c=await ChatArchiveLibraryJobs.inspect('account-e2e');
      const tab=(await chrome.tabs.query({url:'https://chatgpt.com/*'}))[0];
      return ChatArchiveLibraryJobs.submitArchive({accountId:'account-e2e',tabId:tab.id,ids:c.catalog.items.map(x=>x.id)});
    }''')
    state=wait_done();assert state['job']['status']=='complete',state
    assert [x['status'] for x in state['report']['results']]==['saved','failed'],state['report']
    assert state['report']['results'][1]['http_status']==415
    assert counts['bytes']==2
    assert 'TEST-URL' not in json.dumps(state)
    print('PASS: real MV3 worker + content-script bridge + authenticated fixture API + OPFS inventory + selected original + isolated HTTP 415')
    context.close()
