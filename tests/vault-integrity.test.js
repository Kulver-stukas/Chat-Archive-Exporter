'use strict';
const {create}=require('../lib/vault-integrity.js');
const run=function testFixture(create){
 const A='workspace-001',B='workspace-002',P='g-p-'+'a'.repeat(32),Q='g-p-'+'b'.repeat(32),prefix='ChatGPT/Workspace Test',id1='chat-00000001',id2='chat-00000002',id3='chat-00000003',id4='chat-00000004',id5='chat-00000005',id6='chat-00000006',H='a'.repeat(64),H2='b'.repeat(64);
 const file=(size,hash=H,header=null,content='')=>({kind:'file',getFile:async()=>({size,hash,header,slice:()=>({text:async()=>content})})});
 const d=entries=>({kind:'directory',async *entries(){yield* Object.entries(entries);},async getDirectoryHandle(name,opts){if(opts?.create)throw Error('write attempted');if(entries[name]?.kind!=='directory')throw Object.assign(Error('not found'),{name:'NotFoundError'});return entries[name];}});
 const good='Good ['+id1+'].md', misplaced='Moved ['+id2+'].md', dup='Duplicate ['+id1+'].md',unindexed='Orphan ['+id3+'].md',legacy='Legacy ['+id5+'].md',missing='Missing ['+id4+'].md',modified='Edited ['+id6+'].md';
 const header=id=>({conversation_id:id,project_id:P,updated:'2026-11-28T00:00:00Z'});
 const proj=d({'_project.md':file(200,H,null,'| Project ID | `'+P+'` |'),'Sources':d({'original.zip':file(500), 'orphan.bin':file(5)}),[good]:file(100,H,header(id1)),[unindexed]:file(80,H,header(id3)),[modified]:file(120,H2,header(id6))});
 const unassigned=d({[misplaced]:file(110,H,header(id2)),[dup]:file(100,H,header(id1)),[legacy]:file(90,H,header(id5))});
 const physical=d({'ChatGPT':d({'Workspace Test':d({'Project Test':proj,'_Unassigned':unassigned,'Project_abcd':d({'_project.md':file(20,H,null,'| Project ID | `'+P+'` |')})})})});
 const path=(folder,name)=>prefix+'/'+folder+'/'+name, rec=(id,folder,name,bytes,project_id=P)=>({conversation_id:id,path:path(folder,name),project_id,bytes,sha256:H});
 const ledger={schema:'cae.workspace-chats.v1',account_id:A,chats:{
 [id1]:rec(id1,'Project Test',good,100),[id2]:rec(id2,'_Unassigned',misplaced,110),
 [id4]:rec(id4,'Project Test',missing,55),[id6]:rec(id6,'Project Test',modified,120)}};
 const globalIndex={schema:'cae.vault-index.v1',chats:{[A+'|'+id1]:rec(id1,'_Unassigned',dup,100),[A+'|'+id5]:{...rec(id5,'_Unassigned',legacy,90,''),remote_fingerprint:JSON.stringify({project_id:''})},[B+'|foreign']:{path:'ChatGPT/Other/secret.md',bytes:999,sha256:H}},
 sources:{[A+'|source1']:{path:path('Project Test','Sources/original.zip'),project_id:P,bytes:500,sha256:H,pending:{}}},metadata:{}};
 const config={active_scope:{account_id:A},projects:{items:[{id:P,name:'Project Test'},{id:Q,name:'Other'}]}};
 let claims=[],hashes=0,snap=0,change=false,readFailure=false,foreign=false;
 const storage={validAccount:x=>x===A||x===B,validPrefix:x=>/^ChatGPT\/[^/]+$/.test(x),indexPath:'ChatGPT/.chat-archive/index.json',workspaceSchema:'cae.workspace-chats.v1',indexSchema:'cae.vault-index.v1',resourcePath:(p,k)=>p+'/'+(k==='chats'?'.workspace.json':'_workspace_configuration.json'),isProject:x=>/^g-p-[a-f0-9]{32}$/.test(x||''),canonical:x=>x,gptId:x=>/^g-(?!p-)/.test(x||'')?x:''};
 const V={storage,validPath:x=>typeof x==='string'&&x.startsWith('ChatGPT/')&&!x.includes('..'),resolveWorkspacePrefix:async()=>prefix,readJson:async(_dir,p)=>{if(p===storage.indexPath){snap++;return foreign?{schema:globalIndex.schema,chats:{},sources:{},metadata:{}}:change&&snap%2===0?{...globalIndex,updated_at:'changed'}:globalIndex;}if(p.endsWith('.workspace.json'))return foreign?null:ledger;return foreign?null:config;},
 inspectWriterClaims:async()=>claims,writerClaimSummary:x=>x,digestStream:async f=>{hashes++;return f.hash;},readChatHeader:async f=>f.header};
 const audit=create(V);
 const assert=(cond,why)=>{if(!cond)throw Error('FAIL: '+why);};
 return (async()=>{
 const quick=await audit.scan(physical,{accountId:A,display:'Workspace Test'});
 assert(quick.complete,'complete quick scan');assert(hashes===0,'quick must not hash');assert(quick.counts.indexed_chats===5,'local + non-shadowed legacy');assert(quick.counts.legacy_shadowed===1,'legacy shadowed');assert(quick.counts.missing===1,'missing indexed file');assert(quick.counts.duplicate_chats===1,'duplicate ID');assert(quick.counts.unindexed_chats===2,'orphan and duplicate path');assert(quick.counts.unindexed_resources===1,'unindexed resource');assert(quick.counts.split_projects===1,'split project');assert(quick.counts.misplaced_chats===1,'misplaced project chat');assert(quick.counts.pending_sources===1,'pending source');assert(!JSON.stringify(quick).includes('secret.md'),'no other workspace path');
 const full=await audit.scan(physical,{accountId:A,display:'Workspace Test',full:true});assert(full.counts.hash_mismatch===1,'same-size changed file');assert(full.counts.hash_verified===4,'four matching indexed files');
 claims=[{owner:'foreign'}];const busy=await audit.scan(physical,{accountId:A,display:'Workspace Test'});assert(busy.provisional,'writer claim provisional');
 claims=[];snap=0;change=true;const changed=await audit.scan(physical,{accountId:A,display:'Workspace Test'});assert(changed.provisional&&changed.issue_counts.indexes_changed_during_scan===1,'concurrent index change');
 change=false;foreign=true;const noOwner=await audit.scan(physical,{accountId:A,display:'Workspace Test'});assert(!noOwner.complete&&noOwner.issue_counts.workspace_ownership_unverified===1&&noOwner.counts.files===0,'unverified workspace not scanned');
 let cancelled=false;try{await audit.scan(physical,{accountId:A,check:()=>{throw Error('cancelled');}});}catch(e){cancelled=e.message==='cancelled';}assert(cancelled,'cancelled before scan');
 return {quick:quick.counts,full:full.counts,cases:6};
 })();
};
run(create).then(result=>console.log('PASS: Vault Integrity synthetic cases',result.cases)).catch(e=>{console.error(e);process.exitCode=1;});
