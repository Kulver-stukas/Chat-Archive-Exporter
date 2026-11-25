'use strict';
const assert=require('node:assert/strict');
require('../lib/library-inventory');
const I=globalThis.ChatArchiveLibraryInventory,P=require('../lib/library-policy');
const fileId='file_00000000000000000000000000000111';
const cid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const mid='bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const pid='g-p-11111111111111111111111111111111';
const refs=[{type:'project_source',project_id:pid,project_name:'Evidence',file_id:fileId,
  source_record_id:'source_A',conversation_id:cid,message_id:mid,name:'report.md'},
 {type:'project_source',project_id:'g-p-22222222222222222222222222222222',project_name:'Another',file_id:fileId,
  source_record_id:'source_B',conversation_id:cid,message_id:mid,name:'report.md'}];
const prior=I.linkCatalog(I.buildCatalog([],[]),refs);P.decorate(prior,refs);
assert.equal(prior.items.length,1,'the same Source file referenced twice has one record');
assert.equal(prior.items[0].source_only,true);
assert.equal(prior.items[0].placements.filter(x=>x.type==='project_source').length,2);
assert.equal(prior.items[0].placements.filter(x=>x.type==='conversation_message').length,2);
assert.equal(prior.message_references.length,1);
assert(prior.message_references.every(x=>x.message_role==='unknown'&&x.ui_url===null));
assert.equal(prior.items[0].archive_eligibility.selectable,false,'references are not Library assets');
const node={kind:'file',file_id:fileId,library_id:'libfile_00000000000000000111',name:'report.md',
  mime_type:'text/markdown',file_size_bytes:3,created_at:'2026-05-01T00:00:00Z',parent_directory_id:null};
const fresh=I.linkCatalog(I.buildCatalog([node],[]),refs);P.decorate(fresh,refs);
const merged=P.mergeIncremental(prior,fresh,'2026-10-01T00:00:00Z');
I.linkCatalog(merged,refs);P.decorate(merged,refs);
assert.equal(merged.incremental.promoted_from_source_only,1);
assert.equal(merged.items.length,1,'Source-only record is promoted, not duplicated');
assert.equal(merged.items[0].sources[0],'library');
assert.equal(merged.items[0].source_only,undefined);
assert.equal(merged.items[0].archive_eligibility.selectable,true,'still not saved in Vault');
assert.equal(merged.items[0].placements.filter(x=>x.type==='project_source').length,2);
assert.equal(merged.message_references.length,1);
const fromServer=I.sourceReference({file_id:fileId,library_file_id:'libfile_00000000000000000111',
  name:'report.md',type:'text/markdown',size:3,
  metadata:{project_save:{conversation_id:cid,message_id:mid},knowledge_store_info:{source_kind:'library_file'}}},
  {id:pid,name:'Evidence'});
assert.equal(fromServer.conversation_id,cid);
assert.equal(fromServer.message_id,mid);
assert.equal(fromServer.mime_type,'text/markdown');
assert.equal(fromServer.file_size_bytes,3);
assert.equal(fromServer.ui_url,null,'do not invent chat URLs or message role');
console.log('PASS: complete independent Project Source records, conservative message links and promotion to Library without duplicate enrollment');
