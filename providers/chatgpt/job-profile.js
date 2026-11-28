/* ChatGPT job policy: legacy wire mapping, normalization, folder assignment and
 * metadata planning. The common controllers retain queues, retry/checkpoint and IO. */
(function(root){
  'use strict';
  function normalizedItem(x){
    const P=root.ChatArchivePaths;
    if(!x||typeof x.id!=='string'||!/^[a-zA-Z0-9-]{10,100}$/.test(x.id))throw Error('Invalid selected chat ID.');
    const scalar=v=>typeof v==='string'||typeof v==='number'?v:null;
    const rawProject=P.canonical(x.projectId||'');
    const legacyGPT=P.isGPT(rawProject)?rawProject:'';
    return {id:x.id,title:String(x.title||'Untitled chat').slice(0,1000),project:String(x.project||'').slice(0,500),
      projectId:P.isProject(rawProject)?rawProject:'',gptId:P.gptId(x.gptId||legacyGPT),
      gptName:String(x.gptName||'').slice(0,250),archived:Boolean(x.archived),
      containerObserved:Boolean(x.containerObserved),created:scalar(x.created),updated:scalar(x.updated)};
  }
  function layout(j){
    const P=root.ChatArchivePaths;
    // Paths are fixed after first allocation, even if later detail responses
    // discover more projects or a project is renamed while the job is running.
    const base=P.createLayout(j.display,j.projects,j.prefix),used=new Set(Object.values(j.folders||{}));j.folders ||= {};
    function projectPath(id,name){id=P.canonical(id);const k=id||'_Unassigned';if(j.folders[k])return j.folders[k];
      let path=base.projectPath(id,name),n=1;
      while(used.has(path))path=base.projectPath(id,name)+' ['+P.safe(String(id).slice(-12),12)+'-'+(++n)+']';
      used.add(path);j.folders[k]=path;return path;
    }
    for(const p of j.projects)projectPath(p.id,p.name);
    return {prefix:j.prefix,projectPath,chatPath:x=>
      (P.isGPT(x.gptId)?base.gptPath(x.gptId,x.gptName):projectPath(x.projectId,x.project))+
      '/'+P.safe(x.title||'Untitled chat',100)+' ['+P.safe(x.id,80)+'].md'};
  }
  function addProject(j,id,name){if(!/^g-p-/.test(id||''))return;if(!j.projectIds.includes(id))j.projectIds.push(id);
    if(!j.projects.some(x=>x.id===id))j.projects.push({id,name:name||'Project_'+id.slice(-12)});}
  async function planManualContext(j,{request,beforeRequest,note}){
    const P=root.ChatArchivePaths;
    const fullConfiguration=j.mode==='configuration'||j.mode==='all'||j.destination==='vault';
    if(fullConfiguration||j.projectIds.length){
      await beforeRequest('Reading current workspace configuration.');
      j.context=await request('workspaceSnapshot',{projectIds:fullConfiguration?null:j.projectIds,
        includePersonalization:fullConfiguration,includeConfiguration:fullConfiguration,
        observedGpts:j.observedGpts});
    }else j.context={captured_at:new Date().toISOString(),projects:[],projects_complete:true,personalization:null,
      personalization_requested:false,selection:'selected_projects',gpts:j.observedGpts||[]};
    j.context.gpts=[...new Map([...(j.observedGpts||[]),...(j.context.gpts||[])]
      .filter(x=>P.isGPT(x?.id)).map(x=>[x.id,x])).values()];
    for(const w of j.context.warnings||[])note(j,w,'warning');
    const projects=(j.context.projects||[]).map(root.ChatArchiveMeta.normalizeProject);
    const selectedProjects=new Set(j.projectIds);
    for(const p of projects)addProject(j,p.id,p.name);
    if(j.mode==='configuration'){
      // No conversation bodies or Source bytes: this is a metadata-only snapshot.
      j.sourceJobs=[];return false;
    }
    j.sourceJobs=root.ChatArchiveSources.plan(projects.filter(p=>j.fullWorkspace||
      selectedProjects.has(p.id)),layout(j));
    return true;
  }
  function manualChat(j,item,chat){
    const P=root.ChatArchivePaths;
      const rawPid=P.canonical(item.projectId||chat.projectId);
      const projectId=P.isProject(rawPid)?rawPid:'',project=projectId?(item.project||chat.projectName||'Project_'+projectId.slice(-12)):'';
      const gptId=P.gptId(item.gptId||chat.gptId),gptName=item.gptName||chat.gptName||'';
      addProject(j,projectId,project);
      const out={...item,title:chat.title,project,projectId,gptId,gptName,
        ...(j.mode==='current'?{created:chat.created,updated:chat.updated}:{})};const path=layout(j).chatPath(out);
      const text=root.ChatArchiveNormalize.renderMarkdown({...chat,projectId,archived:item.archived},
        {workspace:j.display,project,gptId,gptName});
    return {out,path,text};
  }
  const wire=Object.freeze({"status":"CAE_STATUS","list":"CAE_LIST","chat":"CAE_GET_CHAT","workspaceSnapshot":"CAE_CONTEXT","backgroundPage":"CAE_BG_PAGE","libraryPage":"CAE_LIBRARY_PAGE","sourceStart":"CAE_SOURCE_START","sourceRead":"CAE_SOURCE_READ","sourceClose":"CAE_SOURCE_CLOSE","attachmentStart":"CAE_ATTACHMENT_START","assetStart":"CAE_ASSET_START"});
  const descriptor=root.ChatArchiveProviders.legacy;
  root.ChatArchiveJobProfile=Object.freeze({descriptor,wire,matches:root.ChatArchiveProviders.isLegacyUrl,verified:root.ChatArchiveProviders.verified,normalizedItem,layout,addProject,planManualContext,manualChat});
})(globalThis);
