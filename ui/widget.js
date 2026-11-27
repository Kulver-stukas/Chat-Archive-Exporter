/* Opt-in in-page UI. It only reads cached worker status and sends explicit commands.
 * The v0.1.6.11 content button is always suppressed, including when no widget is shown. */
(()=>{
  'use strict';
  if(globalThis.__caeWidgetUI){globalThis.__caeWidgetUI.refreshPreferences();return;}
  const KEY='cae.ui.preferences.v1',ID='cae-monitor-widget',POS='cae.ui.widget.position.v1';
  let host=null,shadow=null,shown=false,manualShow=false,dismissed=false,logsOpen=false,prefs={},lastPath=location.href;
  let pending=false,timer=null,dead=false,position=null,drag=null,lastGood=null;
  const style=`
:host{all:initial;position:fixed;z-index:2147483639;right:16px;bottom:100px;font:12px/1.45 system-ui,sans-serif;color:#27343b;color-scheme:light}
*{box-sizing:border-box}button{font:inherit;color:inherit;background:#fff;border:1px solid #d5dede;border-radius:7px;padding:6px 8px;cursor:pointer}
button:hover{background:#e7f3ef}button:focus-visible{outline:2px solid #168674;outline-offset:2px}button:disabled{opacity:.5;cursor:not-allowed}
.box{width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 12px);display:flex;flex-direction:column;overflow:hidden;overscroll-behavior:contain;background:#fff;border:1px solid #d5dede;border-radius:11px;box-shadow:0 4px 24px #0003}
.head{flex:none;display:flex;align-items:center;gap:5px;background:#f1f6f4;padding:6px}.drag{flex:1;text-align:left;border:0;background:transparent;cursor:move;font-weight:650;touch-action:none}
.body{padding:8px;min-height:0;overflow:auto;scrollbar-width:thin}.workspace{font-size:11px;color:#65757d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state{font-size:12.5px;font-weight:700;margin:3px 0}.muted{color:#627278;font-size:11px}
.field{margin-top:5px;line-height:1.3;overflow-wrap:anywhere;white-space:pre-line}.field b{color:inherit;font-weight:650}.divider{height:1px;background:#e2e7e9;margin:6px 0}
.log-button{width:100%;margin-top:6px;text-align:center;font-weight:600;background:#eef4f2}.logs{margin-top:5px}.log-group{margin-top:5px}.log-title{font-size:10.5px;font-weight:700;margin-bottom:2px}
.log{background:#f3f5f6;border:1px solid #dce2e4;padding:5px;border-radius:7px;font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:72px;min-height:30px;overflow:auto;margin:0}
.buttons{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}.buttons button{flex:1}.error{color:#a42c2c;overflow-wrap:anywhere;margin:5px 0 0}
progress{width:100%;accent-color:#176f61;margin:3px 0}[hidden]{display:none!important}
@media(max-height:600px){.field{margin-top:3px}.log{max-height:52px}.body{padding:6px}.buttons button{padding:4px 5px}.box{max-height:calc(100dvh - 8px)}}
@media(prefers-color-scheme:dark){:host{color:#e6eded;color-scheme:dark}.box,button{background:#222a2e;border-color:#475359}.head{background:#293637}.muted,.workspace{color:#aebdbf}.log{background:#1b2429;border-color:#475359}.log-button{background:#30433c}.divider{background:#46535b}.error{color:#ffb4b4}}
:host([data-theme=dark]){color:#e6eded;color-scheme:dark}:host([data-theme=dark]) .box,:host([data-theme=dark]) button{background:#222a2e;border-color:#475359}:host([data-theme=dark]) .head{background:#293637}:host([data-theme=dark]) .workspace,:host([data-theme=dark]) .muted{color:#aebdbf}:host([data-theme=dark]) .log{background:#1b2429;border-color:#475359}:host([data-theme=dark]) .divider{background:#46535b}
:host([data-theme=light]){color:#27343b;color-scheme:light}:host([data-theme=light]) .box,:host([data-theme=light]) button{background:#fff;border-color:#d5dede}:host([data-theme=light]) .head{background:#f1f6f4}:host([data-theme=light]) .workspace,:host([data-theme=light]) .muted{color:#627278}:host([data-theme=light]) .log{background:#f3f5f6;border-color:#dce2e4}:host([data-theme=light]) .divider{background:#e2e7e9}
`;
  const markup=`
<section id="box" class="box" aria-label="Chat Archive monitor">
  <div class="head"><button id="drag" class="drag" title="Drag to move; arrow keys reposition">Chat Archive Exporter</button><button id="dismiss" aria-label="Close widget and turn it off" title="Close the widget and turn off automatic display.">×</button></div>
  <div class="body">
    <div id="workspace" class="workspace">Workspace not verified</div><div id="state" class="state" role="status">Checking status…</div>
    <div id="monitoring" class="field muted">Monitoring status unavailable.</div>
    <div id="vault" class="field">Vault: Not verified</div>
    <div class="divider"></div>
    <div class="field"><b>Manual export:</b><div id="manual">Unknown</div></div>
    <div class="field"><b>Library task:</b><div id="library">Unknown</div></div>
    <div class="field"><b>Chat monitoring:</b><div id="sync">Unknown</div><div id="since" class="muted"></div><div id="syncMessage" class="muted"></div></div>
    <progress id="bar" hidden></progress>
    <button id="logsToggle" title="Show or hide export, inventory and monitoring logs." class="log-button" aria-expanded="false">Show logs ▾</button>
    <div id="long" class="logs" hidden>
      <div class="log-group"><div class="log-title">Export log</div><pre id="manualLog" class="log">No recent entries.</pre></div>
      <div class="log-group"><div class="log-title">Inventory log</div><pre id="inventoryLog" class="log">No recent entries.</pre></div>
      <div class="log-group"><div class="log-title">Monitoring log</div><pre id="monitoringLog" class="log">No recent entries.</pre></div>
    </div>
    <div class="buttons"><button id="chats" title="Open conversation selection in the side panel.">Chats</button><button id="files" title="Open Library / Images selection in the side panel.">Files</button><button id="settings" title="Open settings in the side panel.">Settings</button></div>
    <p id="error" class="error" role="status"></p>
  </div>
</section>`;
  function suppressLegacy(){
    if(!document.getElementById('cae-legacy-export-hidden')){
      const rule=document.createElement('style');rule.id='cae-legacy-export-hidden';rule.textContent='#cae-inpage-button{display:none!important}';
      (document.head||document.documentElement).append(rule);
    }
    document.getElementById('cae-inpage-button')?.style.setProperty('display','none','important');
  }
  const get=id=>shadow?.getElementById(id);
  const put=(id,value)=>{const e=get(id);if(e)e.textContent=String(value??'');};
  async function send(type,data={}){
    let timeout;
    const request=chrome.runtime.sendMessage({type,...data});
    try{
      const readOnly=['CAE_UI_WIDGET_BIND','CAE_UI_WIDGET_STATUS'].includes(type);
      const r=readOnly?await Promise.race([request,new Promise((_,reject)=>{
        timeout=setTimeout(()=>reject(Error('Controller status request timed out.')),60000);
      })]):await request;
      if(!r?.ok)throw Error(r?.error||'Extension unavailable');return r.result;
    }finally{clearTimeout(timeout);}
  }
  function remove(){host?.remove();host=null;shadow=null;shown=false;lastGood=null;suppressLegacy();}
  async function closeWidget(){dismissed=true;manualShow=false;remove();
    if(prefs.widgetEnabled){prefs={...prefs,widgetEnabled:false};await chrome.storage.local.set({[KEY]:prefs});}
  }
  const showError=e=>put('error',e?.message||String(e));
  function place(){
    if(!host||!position)return;
    const r=host.getBoundingClientRect();const x=Math.max(4,Math.min(position.x,innerWidth-r.width-4));
    const y=Math.max(4,Math.min(position.y,innerHeight-r.height-4));
    host.style.left=x+'px';host.style.top=y+'px';host.style.right='auto';host.style.bottom='auto';
  }
  function toggleLogs(){logsOpen=!logsOpen;get('long').hidden=!logsOpen;
    get('logsToggle').textContent=logsOpen?'Hide logs ▴':'Show logs ▾';get('logsToggle').setAttribute('aria-expanded',String(logsOpen));place();}
  function render(v){
    if(!shadow)return;
    const verified=!!v?.verified;
    put('workspace',verified?v.workspace:v?.scope_stale?v.workspace+' (last verified)':'Workspace not verified');
    put('state',v?.label||'Idle');put('monitoring',v?.monitoringSummary||'Monitoring status unavailable.');
    put('vault','Vault: '+(v?.vault||'Not verified'));
    put('manual',v?.manualSummary||(verified?'No manual export recorded.':'Unknown'));put('library',v?.librarySummary||(verified?'No Library task recorded.':'Unknown'));
    put('sync',v?.syncSummary||(verified?'Off':'Unknown'));
    put('since',v?.syncVault?`Vault: ${v.syncVault}${v.syncSince?' · Since: '+new Date(v.syncSince).toLocaleString():''}`:'');
    put('syncMessage',v?.syncMessage||'');
    for(const [id,key] of [['manualLog','manual'],['inventoryLog','inventory'],['monitoringLog','monitoring']]){
      const lines=v?.logs?.[key];put(id,Array.isArray(lines)&&lines.length?lines.join('\n'):'No recent entries.');
    }
    const bar=get('bar');bar.hidden=!v?.task?.total;if(!bar.hidden){bar.max=Math.max(1,v.task.total);bar.value=v.task.done||0;}
  }
  async function update(verify=false){
    if(!shown||dead||document.visibilityState==='hidden'||pending)return;
    pending=true;
    try{
      const result=await send(verify?'CAE_UI_WIDGET_BIND':'CAE_UI_WIDGET_STATUS');
      if(result?.verified){lastGood=result;render(result);put('error','');}
      else if(lastGood&&result?.reconnecting){
        render({verified:false,scope_stale:true,workspace:lastGood.workspace,label:'Reconnecting…',
          monitoringSummary:'Status unknown; rechecking workspace identity.'});
        put('error','Connection temporarily unavailable. Will retry.');
      }else{lastGood=null;render(result);put('error',result?.connectionCode||'');}
    }catch(e){
      if(lastGood)render({verified:false,scope_stale:true,workspace:lastGood.workspace,label:'Connection interrupted'});
      else render({verified:false,label:'Status unavailable'});
      showError(e);
    }
    finally{pending=false;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>update(false),250);}
  function mount(){
    if(shown||!document.body||dead)return;
    document.getElementById(ID)?.remove();suppressLegacy();
    host=document.createElement('div');host.id=ID;host.dataset.theme=prefs.theme||'auto';shadow=host.attachShadow({mode:'closed'});
    const css=document.createElement('style');css.textContent=style;shadow.append(css);
    const area=document.createElement('div');area.innerHTML=markup;shadow.append(area);
    document.body.append(host);shown=true;
    get('long').hidden=!logsOpen;get('logsToggle').textContent=logsOpen?'Hide logs ▴':'Show logs ▾';get('logsToggle').setAttribute('aria-expanded',String(logsOpen));
    const on=(id,fn)=>get(id).addEventListener('click',ev=>{
      if(!ev.isTrusted)return;ev.preventDefault();ev.stopPropagation();Promise.resolve(fn()).catch(showError);
    });
    on('dismiss',closeWidget);on('logsToggle',toggleLogs);
    for(const [id,mode] of [['chats','all'],['files','library']])on(id,()=>send('CAE_UI_OPEN_PANEL',{mode}));
    on('settings',()=>send('CAE_UI_OPEN_PANEL',{mode:'settings'}));
    const handle=get('drag');
    handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=host.getBoundingClientRect();drag={dx:e.clientX-r.left,dy:e.clientY-r.top};handle.setPointerCapture(e.pointerId);});
    handle.addEventListener('pointermove',e=>{if(!drag)return;position={x:e.clientX-drag.dx,y:e.clientY-drag.dy};place();});
    handle.addEventListener('pointerup',e=>{drag=null;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);savePosition();});
    handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();const r=host.getBoundingClientRect();position={x:r.left+(e.key==='ArrowLeft'?-12:e.key==='ArrowRight'?12:0),y:r.top+(e.key==='ArrowUp'?-12:e.key==='ArrowDown'?12:0)};place();savePosition();});
    chrome.storage.local.get(POS).then(r=>{position=r[POS]||null;place();}).catch(()=>{});
    update(true);
  }
  function savePosition(){if(position)chrome.storage.local.set({[POS]:position}).catch(()=>{});}
  async function refreshPreferences(){suppressLegacy();try{const r=await chrome.storage.local.get(KEY);prefs=r[KEY]||{};
    if(host)host.dataset.theme=prefs.theme||'auto';
    if((prefs.widgetEnabled||manualShow)&&!dismissed)mount();else remove();
  }catch{}}
  function incoming(m,sender,reply){
    if(sender.id!==chrome.runtime.id||!['CAE_UI_WIDGET_SHOW','CAE_UI_WIDGET_TOGGLE'].includes(m.type))return false;
    if(m.type==='CAE_UI_WIDGET_TOGGLE'&&shown){closeWidget().catch(()=>{});reply({shown:false});return false;}
    manualShow=true;dismissed=false;mount();reply({shown:true});return false;
  }
  function changes(c,area){
    if(area!=='local')return;
    if(c[KEY]){if(c[KEY].newValue?.widgetEnabled)dismissed=false;else manualShow=false;refreshPreferences();}
    if(['cae.manual-status.v1','cae.library-status.v1','cae.background.v1'].some(k=>c[k]))schedule();
  }
  function visible(){if(document.visibilityState==='visible'&&shown)update(true);}
  function focus(){if(shown)update(true);}
  function navigation(){suppressLegacy();if(location.href!==lastPath){lastPath=location.href;if(shown){lastGood=null;render({verified:false,label:'Verifying workspace'});update(true);}}}
  suppressLegacy();chrome.runtime.onMessage.addListener(incoming);chrome.storage.onChanged.addListener(changes);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',focus);
  window.addEventListener('resize',place);window.addEventListener('popstate',navigation);
  window.addEventListener('online',()=>update(true));
  if(window.navigation)window.navigation.addEventListener('navigatesuccess',navigation);
  const life=setInterval(()=>{try{if(!chrome.runtime.id)throw Error();if(document.visibilityState==='visible')navigation();}
    catch{dead=true;clearInterval(life);clearInterval(statusTicker);remove();}},3000);
  // Visible widget status must survive a dormant/suspended MV3 worker. The
  // content script never owns export jobs or performs inventory/API scans.
  const statusTicker=setInterval(()=>{
    if(shown&&!dead&&document.visibilityState==='visible')update(false);
  },45000);
  globalThis.__caeWidgetUI={refreshPreferences};refreshPreferences();
})();
