"""Real headless Chromium UI with synthetic MV3 state; Project Source files remain selectable until actually archived."""
from pathlib import Path
import os,re,tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root/'panel.html').read_text(), flags=re.S)
modify_mock=r'''
(()=>{
 const t=window.__ui, c=t.lib.catalog;
 const a=c.items;
 // A Project Source link is NOT proof that a binary was saved in Vault.
 a[0].archive_eligibility={selectable:true,reason:'Original requestable, Source not archived'};
 a[0].source_copy_verified=false;a[0].source_archive_status='unverified';
 // A verified Vault Source copy must suppress the second original.
 a[1].contexts=['library','project_source'];a[1].managed_by_project_sources=true;
 a[1].source_copy_verified=true;a[1].source_archive_status='verified';
 a[1].archive_eligibility={selectable:false,reason:'Source copy verified'};
 // A Project Source without an actual Library listing is only metadata.
 a[2].source_only=true;a[2].sources=['project_source'];a[2].contexts=['project_source'];
 a[2].managed_by_project_sources=true;a[2].archive_eligibility={selectable:false,reason:'No Library original'};
 a[3].archive=null;
 c.summary={...c.summary,total:4,library_files:3,project_source_only:1,project_source_excluded:1,selectable:1};
})();'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':400,'height':860},accept_downloads=True)
 page.set_default_timeout(8000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html)
 page.add_style_tag(content=(root/'styles.css').read_text())
 for src in ['tests/ui-fixtures.js']:
  page.add_script_tag(content=(root/src).read_text())
 page.add_script_tag(content=modify_mock)
 for f in ['contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js','lib/export-selection.js','lib/markdown-primitives.js','providers/chatgpt/markdown-profile.js','lib/markdown.js','lib/normalize.js','contracts/resources.js','providers/chatgpt/storage-profile.js','lib/paths.js','lib/sort.js','ui/state.js','ui/tree.js','ui/chat-list-cache.js','panel.js']:
  page.add_script_tag(content=(root/f).read_text())
 page.wait_for_function("document.querySelector('#scope').textContent.includes('Test workspace')")
 page.locator('#modeLibrary').click()
 page.wait_for_function("document.querySelector('#librarySummary').textContent.includes('4 records')")
 assert page.evaluate('__ui.starts')==0,'Opening panel must not scan'
 assert '1 verified Source copies excluded' in page.locator('#librarySummary').inner_text()
 assert page.locator('.library-file-checkbox').count()==2, 'eligible Project Source and normal file should be checkable'
 assert 'Project Source linked; library original remains selectable' in page.locator('#libraryGroups').inner_text()
 page.locator('#libraryContextFilter').select_option('project_source')
 assert page.locator('.library-file-checkbox').count()==1,'unarchived Source is selectable'
 page.locator('#libraryContextFilter').select_option('all')
 page.locator('#librarySelectAll').check()
 assert '2 selected' in page.locator('#librarySelectedCount').inner_text()
 page.locator('#libraryArchive').click()
 page.wait_for_function('__ui.archives.length===1')
 assert len(page.evaluate('__ui.archives[0].ids'))==2
 page.locator('#modeCurrent').click();page.locator('#modeLibrary').click()
 assert page.evaluate('__ui.starts')==0,'Navigation must not scan'
 assert not errors, errors
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 out=Path(os.environ.get('CAE_QA_DIR') or tempfile.mkdtemp(prefix='cae-library-ui-'))
 out.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(out/'library-panel-018.png'),full_page=True)
 browser.close()
 print('PASS: v0.1.8 Chromium Library UI: no implicit scan, unarchived Source selectable, verified/source-only excluded, archive selection')
