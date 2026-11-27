"""Real panel.js DOM, mocked browser/ChatGPT API: GPT grouping and empty Project metadata-only selection."""
from pathlib import Path
import re, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (root/'panel.html').read_text(), flags=re.S)
mock=r'''
(()=>{
 const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},fire(...args){this.listeners.forEach(f=>f(...args))}});
 window.__submissions=[]; if(!crypto.randomUUID)crypto.randomUUID=()=>"00000000-0000-4000-8000-000000000067";
 const cid='aaaaaaaa-1111-2222-3333-444444444444';
 const pid='g-p-11111111111111111111111111111111';
 const gid='g-Tutor123456';
 const scope={accountId:'workspace-test',display:'Workspace test',observed:true,currentId:cid};
 const chats=[{id:cid,title:'GPT Conversation',project:'',projectId:'',gptId:gid,gptName:'Tutor',updated:'2026-11-12T12:00:00Z'}];
 const projects=[{id:pid,name:'Empty Project'}];
 const onChanged=event();
 window.chrome={
  runtime:{id:'ext-id',getManifest:()=>({version:'0.1.6.7'}),onConnect:event(),sendMessage:async m=>{
    if(m.type==='CAE_MANUAL_STATUS')return {ok:true,result:null};
    if(m.type==='CAE_MANUAL_SUBMIT') { __submissions.push(m.options);return {ok:true,result:{id:m.options.requestId,
      accountId:m.options.accountId,workspace:m.options.display,mode:'all',destination:'download',
      status:'queued',phase:'context',active:true,message:'Accepted',totalChats:m.options.items.length,
      chatsDone:0,counts:{saved:0,skipped:0,failed:0,conflict:0},metadata:{saved:0,skipped:0,failed:0,conflict:0},logs:[]}}; }
    return {ok:true,result:{enabled:false,status:'disabled'}};
  }},
  tabs:{query:async()=>[{id:1,windowId:1,url:'https://chatgpt.com/c/'+cid,active:true}],
   onActivated:event(),onUpdated:event(),connect:()=>{const port={onMessage:event(),onDisconnect:event(),disconnect(){},postMessage:m=>{
    const result=m.type==='CAE_LIST'?{scope,items:chats,projects,warnings:[]}:scope;
    queueMicrotask(()=>port.onMessage.fire({id:m.id,result}));
   }};return port;},get:async()=>({id:1,windowId:1,url:'https://chatgpt.com/c/'+cid})},
  windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1},
  storage:{onChanged,session:{get:(key,cb)=>cb({})}}
 };
 window.ChatArchiveVault={restoreDirectory:async()=>null,restoreWorkspaceDirectory:async()=>null,
   permissionState:async()=>({state:'no_handle'}),hasPermission:async()=>false};
 window.ChatArchiveManualStore={bind:async()=>{}};
})();
'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or '/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':420,'height':1150})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text());page.add_script_tag(content=mock)
 for fn in ['normalize.js','paths.js','sort.js']:
  page.add_script_tag(content=(root/'lib'/fn).read_text())
 for provider_file in ('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js'):
     page.add_script_tag(content=(root/provider_file).read_text())
 page.add_script_tag(content=(root/'panel.js').read_text())
 
 page.locator('#modeAll').click(timeout=3000)

 page.wait_for_function("document.querySelector('#listSummary').textContent.includes('1 chats')",timeout=4000)
 labels=page.locator('.group-name').all_text_contents()
 assert any('GPT · Tutor' in x for x in labels),labels
 assert any('Project · Empty Project' in x for x in labels),labels
 assert not any('Unknown project' in x for x in labels),labels
 group=page.locator('.group').filter(has_text='Empty Project')
 assert 'No conversations' in group.inner_text()
 group.locator('input[type=checkbox]').first.check(timeout=2500)
 page.locator('#exportSelected').click(timeout=2500)
 page.wait_for_function('window.__submissions.length===1',timeout=4000)
 option=page.evaluate('window.__submissions[0]')
 assert option['items']==[],option
 assert option['selectedProjectIds']==['g-p-11111111111111111111111111111111'],option
 assert not errors,errors
 print('PASS: real panel groups GPT separately, displays empty Project, submits metadata-only selection, no unhandled JS errors')
 b.close()
