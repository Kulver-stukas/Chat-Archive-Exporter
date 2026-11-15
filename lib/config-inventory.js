/* Read-only, current-scope configuration inventory. Never store raw API responses. */
(function(root){
  'use strict';
  const str=(x,max=300)=>typeof x==='string'?x.slice(0,max):'';
  const iso=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d/.test(x)?x.slice(0,40):null;
  const id=x=>str(x,150);
  const isProject=x=>/^g-p-[a-f0-9]{32}$/i.test(String(x||''));
  const isGPT=x=>/^g-(?!p-)[a-z0-9_-]{6,128}$/i.test(String(x||''));
  function identity(session,me,expectedAccountId){
    const a=session?.account||{},u=session?.user||{};
    const accountId=id(a.id||session?.accountId);
    if(!accountId||accountId!==expectedAccountId)throw Error('Current session workspace does not match archive binding.');
    if(me?.id&&u.id&&String(me.id)!==String(u.id))throw Error('Current user identity changed.');
    const kind=['personal','workspace'].includes(a.structure)?a.structure:'unknown';
    const userName=str(me?.name||u.name,200)||null;
    const workspaceName=kind==='workspace'?(str(a.name||a.display_name,200)||null):null;
    return {account_id:accountId,scope_type:kind,user_name:userName,workspace_name:workspaceName,
      display_name:workspaceName?(userName?workspaceName+' ('+userName+')':workspaceName):
        (kind==='personal'?userName:(str(a.name||a.display_name,200)||null)),
      source:'current_session_and_profile',complete:Boolean(kind!=='unknown'&&userName)};
  }
  function gpts(raw,accountId,known=[]){
    if(!raw||!Array.isArray(raw.gizmos))throw Error('GPT bootstrap schema unavailable.');
    const rows=new Map();
    for(const x of raw.gizmos){
      const g=x?.resource?.gizmo||x?.gizmo||x;
      if(!isGPT(g?.id)||g?.workspace_id&&g.workspace_id!==accountId)continue;
      rows.set(g.id,{id:g.id,name:str(g.display?.name||g.name,250)||null,
        description:str(g.display?.description,750)||null,
        author:str(g.author?.display_name,200)||null,
        source:'current_scope_bootstrap'});
    }
    for(const x of known||[])if(isGPT(x?.id)&&!rows.has(x.id))
      rows.set(x.id,{id:x.id,name:str(x.name,250)||null,description:null,author:null,source:'observed_conversation'});
    return {status:'partial',complete:false,coverage:'bootstrap_and_observed_conversations',items:[...rows.values()]};
  }
  function pluginPage(raw,scope,accountId){
    if(!['GLOBAL','WORKSPACE'].includes(scope)||!accountId)throw Error('Invalid installation scope.');
    if(!raw||!Array.isArray(raw.plugins))throw Error('Installed Plugins endpoint returned an invalid list.');
    const next=raw.pagination?.next_page_token;
    if(next!=null&&(typeof next!=='string'||next.length>1500))throw Error('Invalid plugin pagination cursor.');
    const plugins=[];
    for(const p of raw.plugins){
      if(!p||p.scope&&p.scope!==scope)continue;
      if(scope==='WORKSPACE'&&p.workspace_id&&p.workspace_id!==accountId)
        throw Error('Plugin belongs to another workspace.');
      if(scope==='GLOBAL'&&p.workspace_id)continue; // do not attribute another workspace to this user
      // Platform defaults are not installations selected by the account owner.
      if(p.installation_policy==='INSTALLED_BY_DEFAULT'||!p.installed_at)continue;
      if(!id(p.id)||!id(p.name))continue;
      const release=p.release||{};
      const skills=(Array.isArray(release.skills)?release.skills:[]).slice(0,200).filter(s=>id(s?.name))
        .map(s=>({id:id(s.plugin_release_skill_id)||null,name:id(s.name),
          display_name:str(s.interface?.display_name,200)||str(s.name,200),
          description:str(s.interface?.short_description||s.description,800)||null}));
      plugins.push({id:id(p.id),slug:id(p.name),name:str(release.display_name||p.name,200),
        developer:str(p.creator_name||release.interface?.developer_name,200)||null,
        scope,workspace_id:scope==='WORKSPACE'?accountId:null,
        status:str(p.status,80)||null,installed_at:iso(p.installed_at),
        version:str(release.version,120)||null,
        disabled_skill_names:(Array.isArray(p.disabled_skill_names)?p.disabled_skill_names:[])
          .filter(x=>typeof x==='string').slice(0,200).map(x=>str(x,150)),skills});
    }
    return {items:plugins,next_page_token:next||null};
  }
  function pluginsFromPages(pages,accountId){
    const sections=[];const entries=new Map();
    for(const scope of ['GLOBAL','WORKSPACE']){
      const section=pages?.[scope];if(!section)continue;
      sections.push({scope,status:section.status||'not_enumerated',complete:section.complete===true,
        pages:Number(section.pages)||0});
      for(const p of section.items||[]){
        if(p.scope!==scope||scope==='WORKSPACE'&&p.workspace_id!==accountId)continue;
        entries.set(scope+'|'+p.id,p);
      }
    }
    const items=[...entries.values()];const active=sections.length>0;
    const complete=active&&sections.every(s=>s.complete);
    const status=complete?'complete':active?'partial':'not_enumerated';
    return {plugins:{status,complete,scopes:sections,items:active?items:null},
      skills:{status,complete,kind:'bundled_in_explicitly_installed_plugins',
        items:active?items.flatMap(p=>p.skills.map(s=>({parent_plugin_id:p.id,
          parent_plugin_name:p.name,parent_scope:p.scope,...s}))):null}};
  }
  // A schedule is an account configuration item, never an invitation to run it.
  // Retain only user-facing settings; omit server state, credentials, run payloads.
  const SCHEDULE_BUCKETS=['scheduled','paused','finished'];
  function automationPage(raw,bucket,accountId){
    if(!accountId||!SCHEDULE_BUCKETS.includes(bucket))throw Error('Invalid automation inventory scope.');
    if(!raw||!Array.isArray(raw.items))throw Error('Automations API returned an invalid list.');
    const cursor=raw.cursor;
    if(cursor!=null&&(typeof cursor!=='string'||cursor.length>1500))throw Error('Invalid automations cursor.');
    const items=[];
    for(const a of raw.items){
      if(!a||!id(a.id))continue;
      if(a.account_id&&a.account_id!==accountId)throw Error('Automation belongs to another account.');
      if(a.workspace_id&&a.workspace_id!==accountId)throw Error('Automation belongs to another workspace.');
      if(typeof a.prompt==='string'&&a.prompt.length>262144||
         typeof a.schedule==='string'&&a.schedule.length>65536)
        throw Error('Schedule instruction or recurrence exceeds the safe inventory limit.');
      const rule=typeof a.schedule==='string'?a.schedule:null;
      const timezone=str(a.default_timezone||a.timezone,120)||
        (rule?.match(/DTSTART;TZID=([^:;\r\n]+)/)?.[1]||null);
      items.push({id:id(a.id),title:str(a.title||a.name,300)||null,
        prompt:typeof (a.prompt||a.instructions)==='string'?(a.prompt||a.instructions):null,
        schedule:rule,timezone:timezone||null,
        bucket,status:str(a.status,50)||bucket,is_enabled:typeof a.is_enabled==='boolean'?a.is_enabled:null,
        timing_mode:str(a.timing_mode,80)||null,executor:str(a.executor,80)||null,
        thread_mode:str(a.thread_mode,80)||null,
        conversation_id:id(a.conversation_id)||null,
        page_id:id(a.page_id)||null,
        notifications_enabled:typeof a.notifications_enabled==='boolean'?a.notifications_enabled:null,
        email_enabled:typeof a.email_enabled==='boolean'?a.email_enabled:null,
        updated_at:iso(a.updated_at),
        schedule_components:a.schedule_components&&typeof a.schedule_components==='object'?
          Object.fromEntries(['frequency','start_time','by_day','by_month_day','by_month','by_hour','by_minute']
            .filter(k=>['string','number'].includes(typeof a.schedule_components[k]))
            .map(k=>[k,a.schedule_components[k]])):null,
        triggers:(Array.isArray(a.webhook_triggers)?a.webhook_triggers:[]).slice(0,30)
          .map(t=>({type:str(t?.type,100)||null,name:str(t?.name,120)||null}))});
    }
    return {items,cursor:cursor||null};
  }
  function automationsFromPages(pages){
    const scopes=[],combined=new Map();
    for(const bucket of SCHEDULE_BUCKETS){
      const section=pages?.[bucket];if(!section){scopes.push({bucket,status:'not_enumerated',complete:false});continue;}
      scopes.push({bucket,status:section.status||'partial',complete:section.complete===true,pages:section.pages||0});
      for(const a of section.items||[])if(a?.id)combined.set(a.id,a);
    }
    const complete=scopes.every(x=>x.complete),found=scopes.some(x=>x.status!=='not_enumerated');
    return {status:complete?'complete':found?'partial':'not_enumerated',complete,
      buckets:scopes,items:found?[...combined.values()]:null};
  }
  function sameScopeResponse(scope,response){
    if(response?.active_scope?.account_id&&response.active_scope.account_id!==scope)
      throw Error('Configuration snapshot belongs to another workspace.');
  }
  const api={identity,gpts,pluginPage,pluginsFromPages,automationPage,automationsFromPages,sameScopeResponse,isGPT,isProject};
  root.ChatArchiveConfigInventory=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:self);
