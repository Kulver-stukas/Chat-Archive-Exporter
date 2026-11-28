/* Pure v2 identity and naming contract; no filesystem or Chrome dependency. */
(function(root){
const create=function schemaFactory(){
  'use strict';
  const VERSION=2, key=(type,id)=>type+':'+id;
  const fold=x=>String(x).normalize('NFC').toLowerCase();
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  const cleanLabel=(value,max=90)=>{
    let s=String(value||'').normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|\u202a-\u202e\u2066-\u2069\u200b-\u200f]/g,'_')
      .replace(/\s+/gu,'_').replace(/_+/g,'_').replace(/^[._ ]+|[._ ]+$/g,'');
    if(/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(s))s='_'+s;
    return Array.from(s).slice(0,max).join('').replace(/[. _]+$/g,'')||'Unnamed';
  };
  const idOK=x=>typeof x==='string'&&/^[a-z0-9_-]{6,128}$/i.test(x);
  const idToken=(type,id)=>{
    if(!idOK(id))throw Error('Invalid stable identity.');
    return String(id).replace(type==='project'?/^g-p-/i:type==='gpt'?/^g-/i:/^$/,'').replace(/-/g,'');
  };
  const label=(type,id,name)=>{
    const n=String(name||'').trim();
    if(!n||type==='project'&&/^Project_[a-z0-9]+$/i.test(n)&&id.toLowerCase().endsWith(n.slice(8).toLowerCase())||
      type==='gpt'&&/^GPT(?: \[[a-z0-9]+\])+$/i.test(n))return type==='project'?'Project':type==='gpt'?'GPT':'Workspace';
    return n;
  };
  const unknownDisplay=(value,id)=>!value||/^Workspace(?:[ _][a-z0-9-]+)?$/i.test(value)&&
    (String(value).length<=10||id.toLowerCase().includes(String(value).split(/[ _]/).at(-1).toLowerCase()))||
    /^(?:Current workspace|ChatGPT workspace)$/i.test(value);
  function workspace({id,display,identity}){
    if(!idOK(id))throw Error('Invalid workspace identity.');
    const i=identity?.account_id===id?identity:{};
    const displayName=!unknownDisplay(display,id)?String(display):null;
    // Scope type is not a paid plan. Use Business only if an explicit plan is
    // actually exposed by a verified identity snapshot; do not infer from UI.
    const type={business:'Business',team:'Business',enterprise:'Enterprise',edu:'Edu',plus:'Plus',pro:'Pro',free:'Free',go:'Go'}[String(i.plan_type||'').toLowerCase()]||
      (i.scope_type==='personal'?'Personal':i.scope_type==='workspace'?'Workspace':'Unknown');
    const human=i.workspace_name||i.user_name||i.display_name||displayName||null;
    const name=human?cleanLabel(human):'Unnamed';
    const token=idToken('workspace',id);
    return {id,display_name:displayName||i.display_name||human||null,name_source:i.workspace_name?'workspace_name':i.user_name?'user_name':i.display_name?'identity_display_name':displayName?'verified_ui_display':'unknown',
      scope_type:i.scope_type||'unknown',plan_type:i.plan_type||null,type,directory_name:'Workspace_'+name+'_'+type+'_'+token.slice(0,8),
      short_id:token.slice(0,8)};
  }
  // A registry is created from full IDs, never from a path or display label.
  // Within a namespace, extend colliding ID suffixes deterministically.
  function containers(input){
    const list=[...input].map(x=>{
      if(!['project','gpt'].includes(x.type)||!idOK(x.id))throw Error('Invalid container identity.');
      const n=label(x.type,x.id,x.name);
      return {type:x.type,id:x.id,display_name:n,name_source:x.name_source||'unknown',
        token:idToken(x.type,x.id),length:Math.min(8,idToken(x.type,x.id).length),previous_directories:[...new Set(x.previous_directories||[])].sort(cmp)};
    }).sort((a,b)=>cmp(key(a.type,a.id),key(b.type,b.id)));
    const seen=new Set();
    for(const c of list){const k=key(c.type,c.id);if(seen.has(k))throw Error('Duplicate container ID.');seen.add(k);}
    // Do not rely on human-readable names for suffix uniqueness.
    for(let round=0;round<130;round++){
      const grouped=new Map();
      for(const c of list){const k=c.type+':'+fold(c.token.slice(-c.length));if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(c);}
      const collisions=[...grouped.values()].filter(g=>g.length>1);
      if(!collisions.length)break;
      for(const g of collisions)for(const c of g){if(c.length<c.token.length)c.length++;else if(g.every(x=>x.length>=x.token.length))throw Error('Container ID normalization collision.');}
    }
    const used=new Set();
    return list.map(({token,length,...c})=>{
      const short_id=token.slice(-length),name=cleanLabel(c.display_name,Math.max(16,100-short_id.length));
      const directory_name=name+'_'+short_id;
      const directory=c.type==='gpt'?'_GPTs/'+directory_name:directory_name;
      if(used.has(fold(directory)))throw Error('Container path collision.');used.add(fold(directory));
      return {...c,short_id,directory_name,directory,remote_state:'unknown',local_state:'retained'};
    });
  }
  function layout(providerFolder,ws,rows){
    if(!/^[A-Za-z0-9_-]+$/.test(providerFolder)||!ws?.directory_name||/[\\/]/.test(ws.directory_name))throw Error('Invalid workspace layout.');
    const prefix=providerFolder+'/'+ws.directory_name, lookup=new Map(rows.map(c=>[key(c.type,c.id),c.directory]));
    const path=(type,id)=>{
      if(type==='unassigned')return prefix+'/_Unassigned';
      const folder=lookup.get(key(type,id));if(!folder)throw Error('Unresolved container ID.');return prefix+'/'+folder;
    };
    return {prefix,path,control:name=>prefix+'/.cae/'+name,
      reserved:['.cae','.cae/transactions','.cae/writers','_Unassigned','_GPTs','_Library','Deleted'].map(x=>prefix+'/'+x)};
  }
  return {VERSION,key,fold,cleanLabel,workspace,containers,layout};
};
const api=create();if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CAEVaultSchemaV2=api;
})(globalThis);
