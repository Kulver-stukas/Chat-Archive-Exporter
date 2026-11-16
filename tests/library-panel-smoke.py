"""Real Chromium: Library UI is a view; only explicit actions submit jobs."""
from pathlib import Path
import re, os, tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root/'panel.html').read_text(), flags=re.S)
mock=r'''
(()=>{
const event=()=>({calls:[],addListener(f){this.calls.push(f)},fire(...a){this.calls.forEach(f=>f(...a))}});
window.__calls=[];window.__requests=[];window.__starts=0;window.__archives=[];
const dir={name:'Test Vault'},scope={accountId:'account-test',display:'Test Account',observed:true,currentId:'aaaaaaaa-1111-2222-3333-444444444444'};
const fid=n=>'file_'+String(n).padStart(32,'0');
const catalog={schema:'cae.library-inventory.v3',active_scope:{account_id:'account-test'},status:'complete',classification_status:'complete',warnings:[],
 summary:{total:3,library_files:3,images_gallery:1,image_only:0,folders:1,classified:2,project_source_excluded:1},
 items:[
  {id:'file:'+fid(1),file_id:fid(1),contexts:['library','project_source'],placements:[{type:'project_source',project_name:'Logos'}],name:'SOURCE.md',origin:'unknown',origin_status:'not_requested_project_source',media_class:'file',format_class:'text',sources:['library'],library_locations:[{folder_path:'Logos'}],managed_by_project_sources:true,archive_eligibility:{selectable:false}},
  {id:'file:'+fid(2),file_id:fid(2),contexts:['generated_image_gallery'],placements:[],name:'GENERATED.png',origin:'generated',origin_status:'confirmed',media_class:'image',format_class:'image',sources:['library','images'],library_locations:[],archive_eligibility:{selectable:true,reason:'Original available to request'}},
  {id:'file:'+fid(3),file_id:fid(3),contexts:['library'],placements:[],name:'script.js',origin:'generated',origin_status:'inferred',media_class:'file',format_class:'code',sources:['library'],library_locations:[],archive_eligibility:{selectable:true,reason:'Original available to request'}}
 ]};
let lib=null;
window.finishLibrary=()=>{
 lib={account_id:'account-test',enabled:false,baseline_at:'2026-11-16T16:00:00Z',catalog_revision:1,catalog,
  job:{id:'lib-job',status:'complete',active:false,detail:'Inventory saved to Vault.'}};
 chrome.storage.onChanged.fire({'cae.library-status.v1':{newValue:{account_id:'account-test',revision:10}}},'local');
};
window.ChatArchiveLibraryStore={bind:async()=>{},directory:async()=>dir};
window.ChatArchiveManualStore={directory:async()=>null};
window.ChatArchiveVault={restoreDirectory:async()=>dir,restoreWorkspaceDirectory:async()=>dir,
 rememberWorkspaceDirectory:async()=>{},permissionState:async()=>({state:'granted'}),hasPermission:async()=>true};
window.chrome={runtime:{id:'mock',sendMessage:async m=>{
 __requests.push(m.type);
 if(m.type==='CAE_MANUAL_STATUS')return {ok:true,result:null};
 if(m.type==='CAE_LIBRARY_JOB_START'){
   __starts++;lib={account_id:'account-test',enabled:false,catalog_revision:0,catalog:null,
    job:{id:'lib-job',status:'running',active:true,detail:'Listing nodes'}};
   return {ok:true,result:structuredClone(lib)};
 }
 if(m.type==='CAE_LIBRARY_JOB_STATUS'){
   const r=structuredClone(lib);if(r&&m.withCatalog===false)delete r.catalog;return {ok:true,result:r};
 }
 if(m.type==='CAE_LIBRARY_JOB_ARCHIVE'){
   __archives.push(m.options);lib.job={id:'archive',status:'running',active:true,detail:'Archiving selected files'};return {ok:true,result:structuredClone(lib)};
 }
 if(m.type==='CAE_LIBRARY_JOB_STOP'){lib.enabled=false;lib.job={...lib.job,active:false,status:'cancelled',detail:'Stopped'};return {ok:true,result:structuredClone(lib)};}
 return {ok:true,result:{enabled:false,status:'off'}};
}},storage:{onChanged:event(),session:{get:(k,cb)=>cb({})}},
 tabs:{query:async()=>[{id:11,windowId:1,url:'https://chatgpt.com/c/'+scope.currentId,active:true}],onActivated:event(),onUpdated:event(),connect:()=>{
 const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage(m){
  __calls.push({...m});const value=m.type==='CAE_STATUS'?scope:{items:[],projects:[],scope,warnings:[]};
  queueMicrotask(()=>port.onMessage.fire({id:m.id,result:value}));
 }};return port;
 }},windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1}};
})();
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or '/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':425,'height':1250},accept_downloads=True)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text());page.add_script_tag(content=mock)
    for f in ['lib/normalize.js','lib/paths.js','lib/sort.js','panel.js']:page.add_script_tag(content=(root/f).read_text())
    page.wait_for_function("document.querySelector('#scope').textContent.includes('Test Account')")
    page.locator('#modeLibrary').click();page.wait_for_timeout(300)
    assert page.evaluate('__starts')==0,'Opening Library must not submit a scan'
    assert not page.evaluate("__calls.some(x=>x.type==='CAE_LIBRARY_INVENTORY')")
    page.locator('#refreshLibrary').click()
    page.wait_for_function('__starts===1')
    page.wait_for_function("document.querySelector('#libraryJobStatus').textContent.includes('running')")
    assert page.locator('#modeCurrent').is_enabled(),'A running Library job must not lock tabs'
    page.locator('#modeCurrent').click();page.locator('#modeLibrary').click()
    page.evaluate("window.dispatchEvent(new Event('focus'));chrome.tabs.onActivated.fire({tabId:11});chrome.tabs.onUpdated.fire(11,{status:'complete'},{active:true});")
    page.wait_for_timeout(600)
    assert page.evaluate('__starts')==1,'Reconnection must not start another scan'
    page.evaluate('finishLibrary()')
    page.wait_for_function("document.querySelector('#librarySummary').textContent.includes('3 distinct files')")
    assert page.locator('.library-file-checkbox').count()==2,'Project Sources must not have an original checkbox'
    assert 'Excluded: managed by Project Sources' in page.locator('#libraryGroups').inner_text()
    page.locator('#libraryContextFilter').select_option('project_source')
    assert page.locator('.library-file-checkbox').count()==0
    page.locator('#libraryContextFilter').select_option('all')
    page.locator('#librarySelectAll').check()
    assert '2 selected' in page.locator('#librarySelectedCount').inner_text()
    page.locator('#libraryArchive').click();page.wait_for_function('__archives.length===1')
    assert len(page.evaluate('__archives[0].ids'))==2
    assert page.locator('#modeCurrent').is_enabled()
    page.locator('#libraryStop').click();page.wait_for_function("document.querySelector('#libraryJobStatus').textContent.includes('cancelled')")
    with page.expect_download() as download:page.locator('#downloadLibraryCatalog').click()
    assert download.value.suggested_filename.startswith('CAE-Library-Inventory-')
    assert not errors,errors
    out=Path(os.environ.get('CAE_QA_DIR') or tempfile.mkdtemp(prefix='cae-library-ui-'));out.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(out/'library-panel.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'horizontal overflow'
    browser.close()
    print('PASS: explicit start, idle tab/focus changes, unlocked navigation, Source exclusion, checkboxes, selected archive, stop, catalog JSON, no page errors')
