'use strict';
const assert=require('node:assert/strict');
const C=require('../ui/chat-list-cache.js');
const account='workspace_1',prefix='ChatGPT/Test workspace',a='aaaaaaaa-1111-2222-3333-444444444444';
const record={conversation_id:a,path:prefix+'/Engineering/Archive [aaaaaaaa].md',title:'Archived title',project_id:'g-p-'+'1'.repeat(32),
 archived:true,updated:'2026-11-16T12:00:00Z',sha256:'a'.repeat(64)};
const ledger={schema:'cae.workspace-chats.v1',account_id:account,updated_at:'2026-11-18T15:00:00Z',chats:{[a]:record}};
const mirror={schema:'cae.background-mirror.v1',account,prefix,verified_at:'2026-11-18T12:00:00Z',chats:{[a]:record},known:[{id:record.project_id,name:'Engineering',path:prefix+'/Engineering'}]};
let v=C.fromIndex(ledger,mirror,account,prefix);assert.equal(v.items.length,1);assert.equal(v.projects.length,1);assert.equal(v.items[0].archived,true);
assert.equal(v.items[0].id,a);assert.equal(v.source,'Vault workspace index');
assert.equal(C.fromIndex(ledger,mirror,'other_workspace',prefix),null,'no leakage across workspace');
assert.equal(C.fromIndex({...ledger,account_id:'other_workspace'},null,account,prefix),null);
assert.equal(C.fromIndex(null,mirror,account,prefix).source,'Vault mirror');
const copy=C.accept(C.envelope(account,'live_api',v.items,v.projects),account);
assert.equal(copy.source,'live_api');assert.equal(copy.items[0].id,a);
assert.equal(C.accept(copy,'other_workspace'),null);
assert.equal(C.normalize([{id:a,title:'Known'},{id:a,title:'Duplicate'},
  {id:'',title:'Missing identity'}, {id:'https://evil.example',title:'Bad'}]).items.length,1);
console.log('PASS: Vault-index-backed chat preview, mirror fallback, explicit per-workspace isolation, de-duplication, UI cache metadata');
