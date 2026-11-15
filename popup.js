const message=document.getElementById('msg');
document.getElementById('current').addEventListener('click',async()=>{
  const button=document.getElementById('current');button.disabled=true;
  try {
    const response=await chrome.runtime.sendMessage({type:'CAE_MANUAL_QUICK'});
    if(!response?.ok)throw new Error(response?.error||'Manual export controller unavailable.');
    message.textContent='Export accepted. You may close this popup.';
    window.close();
  }catch(e){message.textContent=e.message||String(e);button.disabled=false;}
});
document.getElementById('all').addEventListener('click',()=>{
  const opened=chrome.sidePanel.open({windowId:chrome.windows.WINDOW_ID_CURRENT});
  chrome.storage.session.set({caeInitialMode:'all'}).catch(()=>{});
  opened.then(()=>window.close()).catch(e=>{message.textContent=e.message||String(e);});
});
