'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const account='personal-verified';let current=account,changed=false;
const calls=[];
const fidUser='file_0000000074b881fda0b8ecad7b6eb18e';
const fidGen='file_000000004274820d8b92549ce68eb5c7';
const fidOnly='file_0000000020d471f5b98a81f0656c997b';
const fidNested='file_0000000099d471f5b98a81f0656c997b';
const pid='g-p-1234567890abcdef1234567890abcdef';
const file=(id,name,mime='text/markdown',more={})=>({id:'libfile_'+id.slice(-12),file_id:id,kind:'file',name,mime_type:mime,parent_directory_id:'libdir_root',...more});
const rootNodes=[{id:'libdir_child',name:'More documents',kind:'directory',parent_directory_id:'libdir_root'},file(fidUser,'USER.md')];
const secondNodes=[file(fidGen,'Generated.png','image/png',{image_gen_attribution:true})];
const childNodes=[file(fidNested,'NESTED.txt','text/plain',{parent_directory_id:'libdir_child'})];
const image=(id,fileId,title)=>({id,url:`https://chatgpt.com/backend-api/estuary/content?id=${fileId}&sig=PRIVATE-URL`,title,width:1024,height:768,created_at:1790000000,conversation_id:'chat-from-gallery'});
const responses={
 '/backend-api/files/library/nodes':{items:rootNodes,cursor:'page2'},
 '/backend-api/files/library/nodes?cursor=page2':{items:secondNodes,cursor:null},
 '/backend-api/files/library/nodes?parent_directory_id=libdir_child':{items:childNodes,cursor:null},
 '/backend-api/my/recent/image_gen?limit=50':{items:[image('s_gallery_one',fidGen,'Generated'),image('s_gallery_two',fidOnly,'Gallery-only')],after:null},
 [`/backend-api/files/${fidUser}`]:{use_case:'my_files',size:1000,mime_type:'text/markdown',metadata:{source_ip:'PRIVATE-IP',upload_source:null}},
 [`/backend-api/files/${fidNested}`]:{use_case:'retrieval',size:200,mime_type:'text/plain'},
 '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=false':{items:[{gizmo:{id:pid,workspace_id:account,display:{name:'Logos'}}}],cursor:null},
 [`/backend-api/gizmos/${pid}`]:{gizmo:{id:pid,workspace_id:account,display:{name:'Logos'}},files:[{id:'src_12345678901234',file_id:fidNested,library_file_id:'libfile_'+fidNested.slice(-12),name:'NESTED.txt',metadata:{knowledge_store_info:{source_kind:'library_file'}}}]} 
};
const sandbox={window:{},location:{origin:'https://chatgpt.com',pathname:'/library'},document:{cookie:''},
  Date,Map,Set,URL,AbortSignal,setTimeout,clearTimeout,console,
  fetch:async(url,opts={})=>{
    calls.push({url,headers:opts.headers});
    if(url==='/api/auth/session')return Response.json({accessToken:'PRIVATE-TOKEN',account:{id:current,name:'Personal'}});
    if(changed)throw Error('A request was made after the workspace switched');
    if(!(url in responses))throw Error('Unexpected endpoint '+url);
    assert.equal(opts.headers['ChatGPT-Account-Id'],account);
    return Response.json(responses[url]);
  }};
vm.createContext(sandbox);
for(const filename of ['lib/library-inventory.js','lib/config-inventory.js','lib/api.js'])
  vm.runInContext(fs.readFileSync(path.join(base,filename),'utf8'),sandbox);
(async()=>{
  const progress=[];
  const data=await sandbox.window.ChatArchiveApi.libraryInventory(account,p=>progress.push(p));
  assert.equal(data.schema,'cae.library-inventory.v2');
  assert.equal(data.active_scope.account_id,account);
  assert.equal(data.status,'complete');
  assert.equal(data.collections.library.pages,3);
  assert.equal(data.collections.library.folders_scanned,2);
  assert.equal(data.summary.total,4);
  assert.equal(data.summary.by_context.project_source,1);
  assert.equal(data.collections.project_links.projects_checked,1);
  assert.equal(data.links_status,'complete');
  assert.equal(data.classification_status,'complete');
  assert.equal(data.status,'complete','listing status must not depend on classification');
  assert.equal(data.summary.library_files,3);
  assert.equal(data.summary.images_gallery,2);
  assert.equal(data.summary.image_only,1);
  assert.equal(data.summary.folders,1);
  assert.equal(data.collections.descriptors.attempted,2);
  assert.equal(data.summary.by_origin.uploaded,1);
  assert.equal(data.summary.by_origin.generated,2);
  assert.equal(data.summary.by_origin.unknown,1);
  assert.equal(data.items.find(x=>x.file_id===fidNested).library_locations[0].folder_path,'More documents');
  assert.equal(data.items.find(x=>x.file_id===fidNested).placements.find(p=>p.type==='project_source').project_name,'Logos');
  assert.equal(data.items.find(x=>x.file_id===fidGen).sources.length,2,'Library + gallery must deduplicate');
  assert.equal(data.items.find(x=>x.file_id===fidUser).origin_status,'inferred');
  assert(data.items.find(x=>x.file_id===fidOnly).gallery_ids.includes('s_gallery_two'));
  assert(progress.some(p=>p.component==='images'));
  assert(!JSON.stringify(data).includes('PRIVATE-'));
  assert(!calls.some(c=>/files\/download|estuary\/content|\/backend-api\/pages|accounts\/check|memories/i.test(c.url)));
  const previous=calls.length;
  current='another-workspace';changed=true;
  await assert.rejects(sandbox.window.ChatArchiveApi.libraryInventory(account),/verified active workspace|Workspace changed/i);
  assert.equal(calls.filter(c=>c.url.startsWith('/backend-api/')).length,calls.slice(0,previous).filter(c=>c.url.startsWith('/backend-api/')).length);
  console.log('PASS: paged Library, nested folder, Image gallery join, origins, unknowns, no signed URL or file bytes, same-workspace-only');
})().catch(e=>{console.error(e);process.exitCode=1;});
