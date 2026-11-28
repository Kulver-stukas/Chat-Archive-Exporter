/* ChatGPT metadata work graph. One provider page per step; generic sync owns
 * queue durability, retry, disk access, and source/chat payload commits. */
(function(root){
  'use strict';
  const has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  function isNewProject(c,p,known,P){return P.eligible(c,known.some(x=>x.id===p.gizmo.id),p.gizmo.created_at);}
  function pageNext(c,task,cursor,P){
    if(!cursor)return;
    if(task.page>=299||(task.seen||[]).includes(cursor))throw new Error('Background pagination did not terminate; partial inventory was not used for removals.');
    P.enqueue(c,{...task,id:task.kind+':'+(task.projectId||'')+':'+cursor,cursor,page:(task.page||0)+1,seen:[...(task.seen||[]),cursor]});
  }
  function schedule(c,ledger,known,writable,now,P){
    const I=P.INTERVALS;
    // Configuration inventory is a rare, opt-in background metadata snapshot.
    // Nothing is requested without an explicit enabled sync binding and Vault
    // permission. Each stage is a durable single API request.
    if(writable&&now>=(c.next_config_scan||0)&&
       !c.queue.some(t=>t.kind?.startsWith('config_'))){
      c.config_run={started_at:new Date().toISOString(),identity:null,gpts:null,
        plugin_pages:{},plugin_items:{GLOBAL:[],WORKSPACE:[]},schedule_pages:{},
        schedule_items:{scheduled:[],paused:[],finished:[]},warnings:[]};
      P.enqueue(c,{id:'config:identity',kind:'config_identity',notBefore:0});
      c.next_config_scan=now+I.configMs;
    }
    if(now>=c.next_project_scan){
      if(!c.queue.some(x=>['projects','connectors'].includes(x.kind)))
        P.enqueue(c,{id:'projects:first',kind:'projects',cursor:'',page:0,seen:[],notBefore:0});
      c.next_project_scan=now+I.projectsMs;
    }
    if(c.scope==='workspace'&&now>=c.next_chat_scan){
      if(!c.queue.some(x=>x.kind==='chats'||x.kind==='project_chats')){
        const discovered=c.enrollment==='tracked_and_new'?(c.catalog||[]):[];
        const projects=new Map([...discovered,...known].map(p=>[p.id,p]));
        for(const r of Object.values(ledger.chats))if(ChatArchivePaths.isProject(r.project_id)&&!projects.has(r.project_id))
          projects.set(r.project_id,{id:r.project_id,name:''});
        // One list-page request per task. No conversation bodies are fetched
        // for historical untracked objects discovered during this enumeration.
        for(const p of projects.values())if(ChatArchivePaths.isProject(p.id))
          P.enqueue(c,{id:'project-chats:'+p.id+':0',kind:'project_chats',projectId:p.id,projectName:p.name,cursor:'0',page:0,seen:[]});
        P.enqueue(c,{id:'chats:main:0',kind:'chats',offset:0,archived:false});
        P.enqueue(c,{id:'chats:archived:0',kind:'chats',offset:0,archived:true});
      }
      c.next_chat_scan=now+I.chatsMs;
    }
  }
  function enrich(c,item,ledger,P){
    const old=ledger.chats[item.id],queued=c.queue.find(t=>t.id==='chat:'+item.id)?.item;
    if(item.gptId&&!item.gptName){
      const g=(c.catalog_gpts||[]).find(x=>x.id===item.gptId);
      if(g?.name)item={...item,gptName:g.name};
    }
    if(!item.projectId&&item.containerObserved!==true){
      const oldId=queued?.projectId||old?.project_id||'';
      if(ChatArchivePaths.isProject(oldId))item={...item,projectId:oldId,project:queued?.project||''};
      else if(!item.gptId&&ChatArchivePaths.isGPT(oldId))item={...item,gptId:oldId};
      if(!item.gptId&&ChatArchivePaths.isGPT(old?.gpt_id))item={...item,gptId:old.gpt_id,gptName:old.gpt_name||''};
    }
    if(queued&&P.timestamp(queued.updated)>P.timestamp(item.updated))item={...item,updated:queued.updated};
    return item;
  }
  function chatProjection(c,item,chat,ledger,known){
        const rawProjectId=ChatArchivePaths.canonical(
          item.containerObserved===true?item.projectId:(chat.projectId||item.projectId||''));
        const projectId=ChatArchivePaths.isProject(rawProjectId)?rawProjectId:'';
        const project=projectId?(item.project||chat.projectName||known.find(x=>x.id===projectId)?.name||c.catalog.find(x=>x.id===projectId)?.name||''):'';
        const prior=ledger.chats[item.id];
        const gptId=ChatArchivePaths.gptId(item.gptId||chat.gptId||prior?.gpt_id||'');
        const gptName=item.gptName||chat.gptName||
          (c.catalog_gpts||[]).find(x=>x.id===gptId)?.name||prior?.gpt_name||'';
        const output={...item,title:chat.title,projectId,project,gptId,gptName,
          archived:typeof item.archived==='boolean'?item.archived:chat.archived};
    return {output,projectId,project,gptId,gptName};
  }
  async function process(c,task,{page,ledger,known,offline,P,readMetadata,writeMetadata,hasMetadata,projectResult,candidate,note,wake}){
    switch(task.kind){
      case 'config_identity':{
        const result=await page({kind:'config_identity'});
        if(result.account_id!==c.account_id)throw Error('Configuration identity mismatch.');
        c.config_run ||= {started_at:new Date().toISOString(),plugin_pages:{},plugin_items:{GLOBAL:[],WORKSPACE:[]},warnings:[]};
        c.config_run.identity=result;
        P.enqueue(c,{id:'config:gpts',kind:'config_gpts',notBefore:0});
        return 'Current workspace identity verified.';
      }
      case 'config_gpts':{
        const run=c.config_run;
        if(!run?.identity)throw Error('Configuration inventory has no verified identity.');
        try{run.gpts=await page({kind:'config_gpts',knownGpts:c.catalog_gpts||[]});
          if(Array.isArray(run.gpts.items)){
            const names=new Map(run.gpts.items.filter(x=>x.id&&x.name).map(x=>[x.id,x.name]));
            c.catalog_gpts=[...new Map([...(c.catalog_gpts||[]),
              ...run.gpts.items].filter(x=>x.id).map(x=>[x.id,{id:x.id,
                name:names.get(x.id)||x.name||''}])).values()].slice(-500);
          }
        }
        catch(e){if(['API_COOLDOWN','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||[401,429,502,503,504].includes(e.httpStatus))throw e;
          run.gpts={status:'error',complete:false,items:null};run.warnings.push('GPT bootstrap inventory failed.');}
        P.enqueue(c,{id:'config:plugins:GLOBAL:first',kind:'config_plugins',scope:'GLOBAL',pageToken:'',page:0,seen:[],notBefore:0});
        return 'Current-scope GPT names checked.';
      }
      case 'config_plugins':{
        const run=c.config_run,scope=task.scope;
        if(!run?.identity||!['GLOBAL','WORKSPACE'].includes(scope))throw Error('Invalid configuration task scope.');
        const items=run.plugin_items[scope]||[];
        let res=null;
        try{res=await page({kind:'config_plugins',scope,pageToken:task.pageToken||''});}
        catch(e){if(['API_COOLDOWN','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||[401,429,502,503,504].includes(e.httpStatus))throw e;
          run.warnings.push('Installed '+scope+' Plugins inventory failed.');}
        if(res){
          items.push(...res.items);run.plugin_items[scope]=items;
          const token=res.next_page_token;
          if(token&&!(task.seen||[]).includes(token)&&(task.page||0)<29){
            P.enqueue(c,{id:'config:plugins:'+scope+':'+token,kind:'config_plugins',scope,pageToken:token,
              page:(task.page||0)+1,seen:[...(task.seen||[]),token],notBefore:0});
            return 'Installed '+scope+' Plugins page recorded.';
          }
          if(token)run.warnings.push('Installed '+scope+' Plugins inventory pagination incomplete.');
          run.plugin_pages[scope]={status:token?'partial':'complete',complete:!token,
            pages:(task.page||0)+1,items};
        }else run.plugin_pages[scope]={status:'error',complete:false,pages:task.page||0,items};
        if(scope==='GLOBAL'&&run.identity.scope_type!=='personal')
          P.enqueue(c,{id:'config:plugins:WORKSPACE:first',kind:'config_plugins',scope:'WORKSPACE',
            pageToken:'',page:0,seen:[],notBefore:0});
        else P.enqueue(c,{id:'config:schedules:scheduled:first',kind:'config_schedules',
          bucket:'scheduled',cursor:'',page:0,seen:[],notBefore:0});
        return 'Installed '+scope+' Plugins inventory '+run.plugin_pages[scope].status+'.';
      }
      case 'config_schedules':{
        const run=c.config_run,bucket=task.bucket;
        if(!run?.identity||!['scheduled','paused','finished'].includes(bucket))
          throw Error('Unverified schedules inventory task.');
        run.schedule_items ||= {scheduled:[],paused:[],finished:[]};
        run.schedule_pages ||= {};
        const items=run.schedule_items[bucket]||[];
        let res=null;
        try{res=await page({kind:'config_schedules',bucket,cursor:task.cursor||''});}
        catch(e){if(['API_COOLDOWN','WORKSPACE_CHANGED','AUTH_REQUIRED'].includes(e.code)||
          [401,429,502,503,504].includes(e.httpStatus))throw e;
          run.warnings.push('Schedules '+bucket+' inventory unavailable: '+e.message);}
        if(res){
          items.push(...res.items);run.schedule_items[bucket]=items;
          const cursor=res.cursor;
          if(cursor&&!(task.seen||[]).includes(cursor)&&(task.page||0)<49){
            P.enqueue(c,{id:'config:schedules:'+bucket+':'+cursor,kind:'config_schedules',
              bucket,cursor,page:(task.page||0)+1,
              seen:[...(task.seen||[]),cursor],notBefore:0});
            return 'Schedules '+bucket+' page recorded.';
          }
          if(cursor)run.warnings.push('Schedules '+bucket+' pagination incomplete.');
          run.schedule_pages[bucket]={status:cursor?'partial':'complete',complete:!cursor,
            pages:(task.page||0)+1,items};
        }else run.schedule_pages[bucket]={status:'error',complete:false,pages:task.page||0,items};
        const next={scheduled:'paused',paused:'finished',finished:null}[bucket];
        if(next)P.enqueue(c,{id:'config:schedules:'+next+':first',kind:'config_schedules',
          bucket:next,cursor:'',page:0,seen:[],notBefore:0});
        else P.enqueue(c,{id:'config:commit',kind:'config_commit',notBefore:0});
        return 'Schedules '+bucket+' inventory '+run.schedule_pages[bucket].status+'.';
      }
      case 'config_commit':{
        const run=c.config_run;
        if(!run?.identity||run.identity.account_id!==c.account_id)
          throw Error('Unverified configuration cannot be written.');
        const inventory=ChatArchiveConfigInventory.pluginsFromPages(run.plugin_pages,c.account_id);
        const automations=ChatArchiveConfigInventory.automationsFromPages(run.schedule_pages||{});
        const path=c.prefix+'/_workspace_configuration.json';
        const text=ChatArchiveMeta.renderWorkspaceConfiguration({
          active_scope:{account_id:c.account_id},identity:run.identity,
          projects:(c.catalog||[]).filter(x=>ChatArchivePaths.isProject(x.id))
            .map(x=>({gizmo:{id:x.id,display:{name:x.name},created_at:x.created}})),
          projects_complete:!!c.catalog_projects_complete,gpts:c.catalog_gpts||[],
          custom_gpts:run.gpts,installed_plugins:inventory.plugins,bundled_skills:inventory.skills,
          schedules:automations,selection:'all_projects'},new Date().toISOString());
        const previous=await readMetadata(path);
        const merged=ChatArchiveMeta.mergeWorkspaceConfiguration(previous,text,c.account_id);
        const unchanged=ChatArchiveMeta.sameConfiguration(previous,merged);
        const result=unchanged?{status:'skipped'}:await writeMetadata(path,merged);
        if(result.status==='conflict')note(c,'Workspace configuration local edit preserved.','warning');
        c.config_run=null;
        P.enqueue(c,{id:'personalization',kind:'personalization',notBefore:0});
        return 'Active workspace configuration '+result.status+'; '+run.warnings.length+' inventory warnings.';
      }
      case 'projects':{
        if(!task.cursor){c.catalog_projects_complete=false;c.project_scan_seen=[];}
        const result=await page({kind:'projects',cursor:task.cursor});
        for(const p of result.items){
          if(!ChatArchivePaths.isProject(p?.gizmo?.id))continue;
          const id=p.gizmo.id,entry={id,name:p.gizmo.display.name,created:p.gizmo.created_at};
          c.project_scan_seen ||= [];if(!c.project_scan_seen.includes(id))c.project_scan_seen.push(id);
          const old=(c.catalog||[]).findIndex(x=>x.id===id);if(old<0)c.catalog.push(entry);else c.catalog[old]=entry;
          if(!offline&&isNewProject(c,p,known,P))P.enqueue(c,{id:'connectors:'+id+':first',kind:'connectors',projectId:id,
            snapshot:p,cursor:'',page:0,seen:[]});
          // New project conversations are discovered without waiting another chat interval.
          if(c.scope==='workspace'&&P.eligible(c,known.some(x=>x.id===id),p.gizmo.created_at))
            P.enqueue(c,{id:'project-chats:'+id+':0',kind:'project_chats',projectId:id,projectName:entry.name,cursor:'0',page:0,seen:[]});
        }
        pageNext(c,task,result.cursor,P);
        if(!result.cursor){
          const seen=new Set(c.project_scan_seen||[]);
          c.catalog=c.catalog.filter(x=>seen.has(x.id));
          c.catalog_projects_complete=true;delete c.project_scan_seen;
        }
        if(!offline&&!result.cursor){
          const rootPath=c.prefix+'/_workspace_configuration.json';
          const configuration=ChatArchiveMeta.renderWorkspaceConfiguration({
            projects:(c.catalog||[]).filter(x=>ChatArchivePaths.isProject(x.id)).map(x=>({gizmo:{id:x.id,display:{name:x.name},created_at:x.created}})),
            projects_complete:true,gpts:c.catalog_gpts||[],active_scope:{account_id:c.account_id}
          },new Date().toISOString());
          const prior=await readMetadata(rootPath);
          const merged=ChatArchiveMeta.mergeWorkspaceConfiguration(prior,configuration,c.account_id);
          const result=ChatArchiveMeta.sameConfiguration(prior,merged)?{status:'skipped'}:
            await writeMetadata(rootPath,merged);
          if(result.status==='conflict')note(c,'Workspace configuration local edit preserved.','warning');
          if(hasMetadata(c.prefix+'/_personalization.md'))
            P.enqueue(c,{id:'personalization',kind:'personalization'});
        }
        return 'Project metadata enumerated.';
      }
      case 'connectors':{
        const result=await page({kind:'connectors',projectId:task.projectId,cursor:task.cursor});
        task.snapshot.connectors = [...new Map([...task.snapshot.connectors,...result.items].map(x=>[x.scope_id,x])).values()];
        if(result.cursor)pageNext(c,task,result.cursor,P);
        else {task.snapshot.connector_scopes_complete=true;await projectResult(task.snapshot);}
        return 'Project Sources inventory checked.';
      }
      case 'personalization':{
        const p=await page({kind:'personalization'}),path=c.prefix+'/_personalization.md';
        await writeMetadata(path,ChatArchiveMeta.renderPersonalization(p,new Date().toISOString()));
        return 'Existing personalization snapshot updated.';
      }
      case 'hint':{
        const pending=c.pending[task.conversationId];
        if(pending?.streaming&&!task.checkPending)return 'Response still running; waiting for its completion event.';
        c.hint_checked[task.conversationId]=Date.now();
        const rawPid=ChatArchivePaths.canonical(task.projectId||ledger.chats[task.conversationId]?.project_id||'');
        const pid=ChatArchivePaths.isProject(rawPid)?rawPid:'';
        const name=known.find(x=>x.id===pid)?.name||c.catalog.find(x=>x.id===pid)?.name||'';
        const result=await page(ChatArchivePaths.isProject(pid)?{kind:'project_chats',projectId:pid,projectName:name,cursor:'0'}:{kind:'chats',offset:0});
        const item=result.items.find(x=>x.id===task.conversationId);
        const tracked=has(ledger.chats,task.conversationId);
        const isEligible=item?P.eligible(c,tracked,item.created):tracked;
        // A completion event may precede propagation of the list's updated
        // timestamp. Recheck only this conversation once, then (for an
        // already archived, unedited chat) verify the detail at most once.
        // No historical untracked chat is admitted by an update event.
        const stale=item&&tracked&&P.sameRevision(item,ledger.chats[item.id]);
        if(task.followUp&&isEligible&&stale&&!(task.rechecks||0)){
          P.enqueue(c,{id:'hint-recheck:'+task.conversationId,kind:'hint',conversationId:task.conversationId,
            projectId:pid,tabId:task.tabId,followUp:true,rechecks:1,notBefore:Date.now()+20000});
          wake(20200);
        }
        if(item)candidate(item,Boolean(task.checkPending),
          Boolean(stale&&tracked&&task.followUp&&task.rechecks),offline);
        else if(tracked){
          const old=ledger.chats[task.conversationId];
          candidate({id:task.conversationId,title:old.title,projectId:pid,project:name,updated:null},Boolean(task.checkPending),false,offline);
        }
        return item&&!isEligible?'Old untracked chat excluded.':'Active chat metadata checked.';
      }
      case 'chats':case 'project_chats':{
        const result=await page(task);
        for(const item of result.items){
          if(item.gptId){
            c.catalog_gpts ||= [];
            const existing=c.catalog_gpts.find(x=>x.id===item.gptId);
            if(!existing)c.catalog_gpts.push({id:item.gptId,name:item.gptName||''});
            else if(!existing.name&&item.gptName)existing.name=item.gptName;
            c.catalog_gpts=c.catalog_gpts.slice(-500);
          }
          candidate(item,false,false,offline);
        }
        if(task.kind==='chats'&&result.nextOffset!==null)P.enqueue(c,{...task,id:`chats:${task.archived?'archived':'main'}:${result.nextOffset}`,offset:result.nextOffset});
        if(task.kind==='project_chats')pageNext(c,task,result.cursor,P);
        return 'Conversation metadata page checked.';
      }
      default:return null;
    }
  }
  root.ChatArchiveBackgroundInventory=Object.freeze({schedule,enrich,chatProjection,process});
})(globalThis);
