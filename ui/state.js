/* Presentation-only helpers. Frozen export/job engines remain authoritative. */
(function(root){
  'use strict';
  const KEY='cae.ui.preferences.v1';
  const defaults={theme:'auto',autoClosePanel:true,widgetEnabled:false,monitorOnStart:true};
  function preferences(raw){return {theme:['auto','light','dark'].includes(raw?.theme)?raw.theme:'auto',
    autoClosePanel:raw?.autoClosePanel!==false,widgetEnabled:raw?.widgetEnabled===true,monitorOnStart:raw?.monitorOnStart!==false};}
  const complete=/^(complete|completed|completed_with_warnings|completed_not_saved)$/;
  const wait=/wait|permission|denied|authorization|cooldown|retry|error|failed|conflict|missing|uncertain|paused|cancel|disabled|storage/i;
  function userCanceledDownload(job){
    if(!job)return false;
    if(job.status==='completed_not_saved'&&job.destination==='download')return true;
    if(job.status!=='download_failed')return false;
    const recent=[job.message,...(job.logs||[]).slice(-5).map(x=>x.message)].join(' ');
    return /USER_CANCELED|USER_CANCELLED|user[- ]cancel|cancelled? by (?:the )?user/i.test(recent);
  }
  function running(job){return !!job && job.active!==false && !complete.test(job.status||'') && !wait.test(job.status||'') &&
    ['queued','running','download_pending','download_starting','preparing','reading','writing','downloading','archiving','listing','rendering','packaging','delivering'].includes(job.status);}
  function needsAttention(job){
    if(!job||userCanceledDownload(job))return false;
    return /permission|denied|authorization|error|failed|missing|conflict|storage_error|delivery_uncertain/i.test(job.status||'');
  }
  function humanStatus(job){
    if(!job)return 'Idle';
    if(userCanceledDownload(job))return job.status==='completed_not_saved'?'Prepared, not saved (user canceled)':'Download canceled by user';
    if(complete.test(job.status))return job.status==='completed_with_warnings'?'Completed with warnings':'Complete';
    if(/permission|denied|authorization|missing/.test(job.status||''))return 'Access required';
    if(wait.test(job.status||''))return String(job.status||'Waiting').replaceAll('_',' ');
    return String(job.status||'Idle').replaceAll('_',' ');
  }
  function activity(manual,library,sync){
    const busy=running(manual)||running(library?.job)||sync?.status==='running'||sync?.status==='buffering';
    const blocked=[manual,library?.job,sync].some(needsAttention);
    const monitoring=!!(library?.enabled||sync?.enabled);
    return {busy,blocked,monitoring,icon:busy?'running':blocked?'base':'idle',
      label:busy?'Recording':blocked?'Needs attention':monitoring?'Idle - monitoring enabled':'Idle'};
  }
  function selection(ids,selected){const count=ids.filter(id=>selected.has(id)).length;return {count,checked:ids.length>0&&count===ids.length,mixed:count>0&&count<ids.length};}
  const api={KEY,defaults,preferences,running,needsAttention,userCanceledDownload,humanStatus,activity,selection};root.CAEUIState=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
