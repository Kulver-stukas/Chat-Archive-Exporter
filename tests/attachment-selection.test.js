'use strict';
const assert=require('node:assert/strict');
const N=require('../lib/normalize.js'),E=require('../lib/export-selection.js');
function msg(parts,metadata={},role='assistant'){return {author:{role},content:{content_type:'multimodal_text',parts},metadata};}
const sample=msg([
  '[A](sandbox:/mnt/data/file%20one.txt)\n[B](<sandbox:/mnt/data/file(2).txt>)\n'+
  '`[code](sandbox:/mnt/data/example.txt)`\n```md\n[code](sandbox:/mnt/data/example2.txt)\n```\n'+
  '[Bad](sandbox:/mnt/data/../escape)\n[Bad](sandbox:/mnt/data/%2e%2e/escape)\n'+
  '[Web](https://example.com/file.txt)',
  {content_type:'image_asset_pointer',asset_pointer:'sediment://file_image'}
],{attachments:[{id:'file_generated',name:'result.csv',size:3,download_url:'https://private.example/signed-secret',token:'secret'}],
 content_references:[{type:'file',file_id:'file_reference',name:'source.pdf'},{type:'file',file_id:'file_explicit',origin:'uploaded',name:'source2.pdf'}]});
const files=N.attachmentReferences(sample,'a','conversation');
assert.equal(files.length,5);
assert.deepEqual(files.filter(f=>f.sandboxPath).map(f=>f.sandboxPath),['/mnt/data/file one.txt','/mnt/data/file(2).txt']);
assert(!files.some(f=>f.fileId==='file_reference'),'unclassified source citation is not a generated original');
assert.equal(files.find(f=>f.fileId==='file_explicit').origin,'uploaded');
assert(!JSON.stringify(files).includes('secret'));
assert(!JSON.stringify(files).includes('private.example'));
assert.equal(N.safeSandboxPath('/etc/passwd'),null);
assert.equal(N.safeSandboxPath('/mnt/data//file.txt'),null);
assert.equal(N.safeSandboxPath('/mnt/data/a\\b'),null);
assert.equal(N.safeSandboxPath('/mnt/data/%00file'),null);
assert.equal(N.safeSandboxPath('sandbox:/mnt/data/file%20one.txt'),'/mnt/data/file one.txt');
const unresolved=N.attachmentReferences(msg([],{attachments:[{name:'document.pdf'}]},'user'),'q','conversation');
assert.equal(unresolved[0].fileId,null);
assert.equal(unresolved[0].sandboxPath,null);
assert.equal(unresolved[0].origin,'uploaded');
const raw={id:'conversation',title:'Files only',current_node:'a',mapping:{
 root:{id:'root',parent:null,children:['q'],message:null},
 q:{id:'q',parent:'root',children:['a'],message:msg([],{attachments:[{id:'file_upload',name:'user.pdf'}]},'user')},
 a:{id:'a',parent:'q',children:[],message:msg([],{attachments:[{id:'file_generated',name:'generated.pdf'}]})}
}};
const chat=N.normalizeChat(raw);
assert.equal(chat.messages.length,2,'binary-only assistant message remains selectable');
assert(chat.messages.every(m=>m.textContent===''));
assert.equal(E.attachments(chat,E.DEFAULTS).length,2);
const md=N.renderMarkdown(chat,{exportSelection:{...E.DEFAULTS,questions:false,answers:false,thinking:false}});
assert(md.includes('user.pdf — unavailable'));
assert(md.includes('generated.pdf — unavailable'));
assert.throws(()=>E.validate(chat,{...E.DEFAULTS,uploadedFiles:false,generatedFiles:false}),/No available content/);
// Explicit upload provenance wins over the assistant role; a reused upload is
// not silently reclassified as a generated file in a later answer.
const explicitUpload=N.attachmentReferences(msg([],{attachments:[{id:'file_known',name:'source.pdf',origin:'uploaded'}]}),'a','conversation');
assert.equal(explicitUpload[0].origin,'uploaded');
const provenance=new Map();
N.attachmentReferences(msg([],{attachments:[{id:'file_reused',name:'same.pdf'}]},'user'),'q','conversation',provenance);
const reused=N.attachmentReferences(msg([],{attachments:[{id:'file_reused',name:'same.pdf'}]}),'a','conversation',provenance);
assert.equal(reused[0].origin,'uploaded');
const generatedOnly={...E.DEFAULTS,uploadedFiles:false};
assert.equal(E.attachments({id:'conversation',messages:[{id:'a',role:'assistant',content:'Answer',attachments:reused}]},generatedOnly).length,0);
console.log('PASS: bounded conservative attachment discovery, code exclusion, original names, unresolved files and binary-only messages');
