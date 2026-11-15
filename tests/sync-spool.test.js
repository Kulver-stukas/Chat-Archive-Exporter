'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {createFakeIndexedDB}=require('./fake-idb');
const idb=createFakeIndexedDB();
const source=fs.readFileSync(__dirname+'/../lib/sync-spool.js','utf8');
const vault=require('../lib/vault.js');
function instance(){
 const ctx={console,Blob,TextEncoder,TextDecoder,structuredClone,Map,Set,Promise,crypto:crypto.webcrypto,
   indexedDB:idb.indexedDB,IDBKeyRange:idb.IDBKeyRange,ChatArchiveVault:vault,
   ChatArchiveHash:{hex:x=>crypto.createHash('sha256').update(x).digest('hex')}};
 vm.runInNewContext(source,ctx);return ctx.ChatArchiveSyncSpool;
}
const account='acct-one',prefix='ChatGPT/Workspace one';
const id='aaaaaaaa-1111-2222-3333-444444444444';
const item={id,title:'Chat one',created:'2026-11-11T11:00:00Z',updated:'2026-11-11T11:20:00Z',projectId:''};
const path=prefix+'/Unassigned/Chat one ['+id+'].md';
function markdown(text,updated='2026-11-11T11:20:00Z'){
 return '---\ntitle: "Chat one"\nconversation_id: '+JSON.stringify(id)+'\nupdated: '+JSON.stringify(updated)+'\nexported: "2026-11-11T11:21:00Z"\n---\n\n'+text+'\n';
}
(async()=>{
 let S=instance();
 const ledger={schema:'cae.workspace-chats.v1',account_id:account,updated_at:'2026-11-11',chats:{[id]:{path,title:item.title,sha256:'b'.repeat(64),bytes:91,updated_ms:1}}};
 await S.seed(account,prefix,ledger,[],{created_at:'2026-11-11',sources:{}});
 let mirror=await S.readMirror(account,prefix);assert.equal(mirror.chats[id].title,'Chat one');
 assert.equal(await S.readMirror(account,'ChatGPT/Other workspace'),null,'mirrors cannot cross workspace directories');
 assert.equal((await S.stats(account)).pending,0);
 const first=await S.stage(account,prefix,{item,text:markdown('First'),path,projectId:''});
 assert.equal(first.status,'captured');
 assert.equal((await S.stats(account)).pending,1);
 assert.equal((await S.pending(account,2))[0].text,markdown('First'));
 let again=await S.stage(account,prefix,{item,text:markdown('First'),path});
 assert.equal(again.status,'unchanged');
 assert.equal((await S.stats(account)).pending,1,'same content is not duplicated');
 S=instance();assert.equal((await S.pending(account))[0].text,markdown('First'),'survives worker replacement');
 assert.equal(await S.finish(account,{...first.record,token:'wrong-token'}),false,'stale finish cannot delete newer pending capture');
 const changed=await S.stage(account,prefix,{item:{...item,updated:'2026-11-11T11:22:00Z'},
   text:markdown('Second','2026-11-11T11:22:00Z'),path});
 assert.equal(changed.status,'captured');
 assert.equal((await S.pending(account))[0].text,markdown('Second','2026-11-11T11:22:00Z'));
 const older=await S.stage(account,prefix,{item,text:markdown('Outdated'),path});
 assert.equal(older.status,'newer_pending','older update cannot replace a staged newer revision');
 assert.equal(await S.finish(account,first.record),false,'stale delete cannot erase newer staged version');
 assert.equal(await S.finish(account,changed.record,'conflict','Local file edited.'),true);
 const stats=await S.stats(account);assert.equal(stats.pending,0);assert.equal(stats.conflicts,1);
 await assert.rejects(()=>S.stage(account,prefix,{item,text:markdown('Third'),path}),/unresolved local conflict/);
 const record=await S.metadata(account,id);assert.equal(record.state,'conflict');
 assert.equal((await S.pending(account)).length,0,'conflicts must never be silently retried');
 assert.equal(await S.finish(account,record),true);
 assert.equal((await S.stats(account)).conflicts,0);
 await assert.rejects(()=>S.stage(account,prefix,{item,text:markdown('wrong'),path:prefix+'/../escape.md'}),/Unsafe/);
 await assert.rejects(()=>S.stage(account,prefix,{item,text:markdown('bad').replace(id,'bbb'),path}),/header/);
 await assert.rejects(()=>S.stage('another-workspace',prefix,{item,text:markdown('other'),path:'ChatGPT/Another/Bad.md'}),/Unsafe/);
 const tooBig=markdown('x'.repeat(12*1024*1024));
 await assert.rejects(()=>S.stage(account,prefix,{item,text:tooBig,path}),/12 MiB/);
 assert.equal((await S.stats(account)).bytes,0,'oversized capture must not corrupt existing records');
 const noSecrets=JSON.stringify(await S.readMirror(account,prefix));
 assert(!noSecrets.includes('Authorization')&&!noSecrets.includes('Bearer'));
 console.log('PASS: IndexedDB mirror, atomic Markdown capture, latest revision, worker restart, token-safe drain, conflicts, workspace isolation, size bounds');
})().catch(e=>{console.error(e);process.exitCode=1;});
