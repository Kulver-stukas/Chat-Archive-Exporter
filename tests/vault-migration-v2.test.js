'use strict';
const S=require('../contracts/vault-schema-v2'),I=require('../lib/vault-integrity'),M=require('../lib/vault-migration-v2'),P=require('../providers/chatgpt/storage-profile'),SP=require('../lib/sync-policy');
const run=async function fixture(S,I,M,P,SP){
 let n=0;function ok(v,m){if(!v)throw Error('FAIL: '+m);n++;}
 const A='12345678-2222-3333-4444-555555555555',B='12345678-aaaa-bbbb-cccc-dddddddddddd',P1='g-p-'+'a'.repeat(24)+'12345678',P2='g-p-'+'b'.repeat(24)+'12345678',G='g-'+'c'.repeat(24)+'87654321';
 const prefix='ChatGPT/Workspace 12345678',H='a'.repeat(64),J='b'.repeat(64),C1='11111111-1111-1111-1111-111111111111',C2='22222222-2222-2222-2222-222222222222',C3='33333333-3333-3333-3333-333333333333',C4='44444444-4444-4444-4444-444444444444';
 const ws=S.workspace({id:A,identity:{account_id:A,user_name:'Test User',scope_type:'workspace',plan_type:'business'},occupied:['Workspace_Other_Business_12345678']});
 ok(ws.short_id.length===9&&ws.directory_name==='Workspace_Test_User_Business_123456782','workspace prefix collision extended');
 ok(S.cleanLabel('  Тест / имя  ')==='Тест_имя','Unicode and invalid characters');
 ok(S.cleanLabel('COM1')==='_COM1','Windows device name');
 const names=S.containers([{type:'project',id:P1,name:'Alpha'},{type:'project',id:P2,name:'Alpha'},{type:'gpt',id:G,name:'GPT [12345678] [cccc87654321]'}]);
 ok(names.filter(c=>c.type==='project').every(c=>c.short_id.length===9),'project suffix collision');
 ok(names.find(c=>c.type==='gpt').directory==='_GPTs/GPT_87654321','fallback GPT suffix once');
 let mode='clean',changed=false,readCount=0,claims=[],reads=0;
 const file=(size,sha=H,header=null,body='')=>({kind:'file',getFile:async()=>{reads++;return {size,sha,header,lastModified:123,slice:()=>({text:async()=>body})}}});
 const dir=(entries)=>({kind:'directory',async *entries(){yield* Object.entries(entries);},async getDirectoryHandle(k,o){if(o?.create)throw Error('WRITE attempt');if(entries[k]?.kind!=='directory')throw Object.assign(Error('Missing'),{name:'NotFoundError'});return entries[k];},async getFileHandle(){throw Error('Unexpected file open');},async removeEntry(){throw Error('WRITE attempt');}});
 const hf=(id,extra={})=>({conversation_id:id,title:'Title',updated:'2026-10-01T00:00:00Z',...extra});
 const c1='Title ['+C1+'].md',c2='Title ['+C2+'].md',c3='Title ['+C3+'].md',c4='Title ['+C4+'].md';
 const fallback='Project_'+P1.slice(-12),gptfallback='Project_'+G.slice(-12);
 const paths={c1:prefix+'/_Unassigned/'+c1,c2:prefix+'/'+fallback+'/'+c2,c3:prefix+'/'+gptfallback+'/'+c3,c4:prefix+'/Old Project/'+c4,
   meta:prefix+'/Old Project/_project.md',source:prefix+'/Old Project/Sources/source file.zip',library:prefix+'/_Library/Generated/Images/item.png',
   configuration:prefix+'/_workspace_configuration.json',inventory:prefix+'/_Library/_inventory.json',control:prefix+'/.workspace.json'};
 const all={_Unassigned:dir({[c1]:file(100,H,hf(C1,{source:'https://chatgpt.com/g/'+P1+'/c/'+C1}))}),
 [fallback]:dir({[c2]:file(100,H,hf(C2,{project_id:P1}))}),[gptfallback]:dir({[c3]:file(110,H,hf(C3,{container_id:G,gpt:'Tutor'}))}),
 'Old Project':dir({'_project.md':file(80,H,null,'# Project: Old Project\n| Project ID | `'+P1+'` |\n| Workspace ID | `'+A+'` |'),
   'Sources':dir({'source file.zip':file(120)}),[c4]:file(100,H,hf(C4,{project_id:P1}))}),
 '_Library':dir({'_inventory.json':file(75),'Generated':dir({'Images':dir({'item.png':file(300)})})}),
 '_workspace_configuration.json':file(80),'.workspace.json':file(40),'.sync.json':file(20)};
 const root=dir({'ChatGPT':dir({'Workspace 12345678':dir(all),'Workspace_Other_Business_12345678':dir({'secret.md':file(999)})})});
 const rec=(id,path,project_id='',gpt_id='',size=100)=>({conversation_id:id,title:'Title',path,project_id,gpt_id,gpt_name:gpt_id?'Tutor':null,bytes:size,sha256:H,updated:'2026-10-01T00:00:00Z'});
 const ledger={schema:P.workspaceSchema,account_id:A,chats:{[C1]:rec(C1,paths.c1,P1),[C2]:rec(C2,paths.c2,P1),[C3]:rec(C3,paths.c3,'',G,110),[C4]:rec(C4,paths.c4,P1)}};
 const g={schema:P.indexSchema,chats:{[A+'|'+C2]:rec(C2,paths.c2,P1),[B+'|secret']:{path:'ChatGPT/Other/secret.md'}},
 sources:{[A+'|'+P1+':file_abc']:{path:paths.source,project_id:P1,file_id:'file_abc',bytes:120,sha256:H},
 [A+'|library:file_def']:{path:paths.library,file_id:'file_def',bytes:300,sha256:H}},
 metadata:{[A+'|'+paths.meta]:{path:paths.meta,bytes:80,sha256:H},[A+'|'+paths.configuration]:{path:paths.configuration,bytes:80,sha256:H},
 [A+'|library:inventory']:{path:paths.inventory,bytes:75,sha256:H}}};
 const config={active_scope:{account_id:A,scope_type:'workspace'},identity:{account_id:A,user_name:'Test User',scope_type:'workspace',plan_type:'business'},
 projects:{items:[{id:P1,name:'Old Project'},{id:P2,name:'Another project'}]},custom_gpts:{items:[{id:G,name:'Old Tutor'}]}};
 const V={storage:P,validPath:x=>typeof x==='string'&&/^ChatGPT\/[^/]+\/[^/]+/.test(x)&&!x.split('/').some(y=>y==='.'||y==='..'||!y||/[\\:*?"<>|]/.test(y)),
 resolveWorkspacePrefix:async()=>prefix,readJson:async(_r,p)=>{if(p===P.indexPath){readCount++;return changed&&readCount%2===0?{...g,updated_at:'changed'}:g;}if(p.endsWith('.workspace.json'))return ledger;return config;},
 inspectWriterClaims:async()=>claims,writerClaimSummary:x=>x,digestStream:async f=>f.sha,readChatHeader:async f=>f.header};
 const audit=I.create(V),planner=M.create(V,S,audit);
 const opts={accountId:A,display:'Workspace 12345678',live:{account_id:A,source:'live_api',captured_at:'2026-11-28T12:00:00Z',
 projects:[{id:P1,name:'New Name'},{id:P2,name:'Another project'}],chats:[{id:C1,projectId:P1,project:'New Name',containerObserved:true},{id:C2,projectId:P1,project:'New Name',containerObserved:true},{id:C3,gptId:G,gptName:'Named Tutor',containerObserved:true},{id:C4,projectId:'',gptId:'',containerObserved:true}]}};
 const plan=await planner.plan(root,opts);
 const get=(pl,k)=>pl.entries.find(x=>x.source===paths[k]);
 ok(!plan.execution_enabled&&plan.mode==='dry_run','no execution');
 ok(plan.target_prefix.endsWith('Workspace_Test_User_Business_123456782'),'target prefix');
 ok(plan.status==='review_required'&&plan.counts.blockers===0,'clean plan: '+JSON.stringify(plan.findings));
 ok(plan.counts.files===11,'all physical files including controls: '+plan.counts.files);
 ok(get(plan,'c1').target===get(plan,'c2').target.replace(c2,c1),'split project and unassigned consolidate');
 ok(get(plan,'c3').target.includes('/_GPTs/Named_Tutor_87654321/'),'GPT from fallback moved');
 ok(get(plan,'c4').target.includes('/_Unassigned/'),'explicit observed removal from project');
 ok(get(plan,'source').target.endsWith('/Sources/source file.zip'),'source original filename');
 ok(get(plan,'source').claims[0].canonical_resource_id==='source:'+P1+':file_abc','canonical source identity');
 ok(get(plan,'meta').canonical_metadata_id==='project:'+P1+':project-metadata','canonical metadata identity');
 ok(get(plan,'inventory').canonical_metadata_id==='library:inventory','canonical library metadata identity');
 ok(get(plan,'control').action==='convert_control'&&get(plan,'control').target.endsWith('/.cae/chats.json'),'control conversion');
 ok(plan.audit.issue_counts.legacy_chat_header_project_id_absent===1,'legacy header distinguished');
 ok(!JSON.stringify(plan).includes('secret.md'),'foreign workspace data excluded');
 ok(plan.planned_directories.some(x=>x.endsWith('/Deleted')),'Deleted reserved');
 const noLive=await planner.plan(root,{...opts,live:{...opts.live,account_id:B}});
 ok(!noLive.live_metadata.used&&get(noLive,'c4').target.includes('/Old_Project_'),'foreign live list rejected');
 // Simulate the reported Library and metadata problems.
 all._Library=dir({'_inventory.json':file(75,J),'Generated':dir({'Images':dir({'item.png':file(300),'orphan.png':file(200,J)})})});
 // Rebuild the root because directory objects capture nested entries on creation.
 g.sources[A+'|library:file_def'].pending=true;delete g.sources[A+'|library:file_def'].sha256;
 const dirty=await planner.plan(root,opts);
 ok(dirty.status==='blocked','dirty plan blocked');
 ok(dirty.findings.some(x=>x.code==='pending_resource_commit'),'pending blocked');
 ok(dirty.findings.some(x=>x.code==='incomplete_index_evidence'),'missing hash blocked');
 ok(dirty.findings.some(x=>x.code==='unindexed_physical_file'),'unindexed retained');
 ok(dirty.findings.some(x=>x.code==='recorded_file_divergence'),'same size metadata divergence');
 ok(dirty.entries.find(x=>x.source.endsWith('orphan.png')).observed_sha256===J,'unindexed file hashed, not adopted');
 claims=[{owner:'foreign'}];const busy=await planner.plan(root,opts);ok(busy.audit.provisional&&busy.status==='blocked','writer claim blocked');
 claims=[];changed=true;readCount=0;const unstable=await planner.plan(root,opts);ok(unstable.audit.provisional&&unstable.status==='blocked','changed index blocked');
 let cancelled=false;try{await planner.plan(root,{...opts,check:()=>{throw Error('cancelled');}});}catch(e){cancelled=e.message==='cancelled';}ok(cancelled,'cancel read-only');
 ok(SP.publicState({enabled:false,sources:true}).sources===false,'paused child false');
 ok(SP.publicState({enabled:true,sources:true}).sources===true,'enabled child true');
 return {assertions:n,clean:plan.counts,dirty:dirty.counts,reads};
};
run(S,I,M,P,SP).then(result=>console.log('PASS: v2 dry-run checks',result.assertions)).catch(e=>{console.error(e);process.exitCode=1;});
