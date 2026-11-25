'use strict';
const assert=require('node:assert/strict');
const E=require('../lib/export-selection.js'),N=require('../lib/normalize.js');
const cid='12345678-1234-1234-1234-123456789abc';
function fixture(){
  const mapping={root:{id:'root',parent:null,children:[],message:null}};let parent='root';
  function add(id,role,content,metadata={},extra={}){
    mapping[parent].children.push(id);
    mapping[id]={id,parent,children:[],message:{id:'message-'+id,author:{role},content,metadata,create_time:1760000000,...extra}};
    parent=id;
  }
  add('q1','user',{content_type:'text',parts:['FIRST QUESTION']},{attachments:[{id:'file_upload',name:'input.txt',mime_type:'text/plain',size:3}]});
  add('t1','assistant',{content_type:'thoughts',thoughts:[{summary:'Visible thinking',content:'FIRST THOUGHT'}]});
  add('a1','assistant',{content_type:'text',parts:['FIRST ANSWER [Result](sandbox:/mnt/data/result.txt)']});
  add('q2','user',{content_type:'text',parts:['SECOND QUESTION']});
  add('hidden','assistant',{content_type:'text',parts:['PRIVATE ANALYSIS']},{},{channel:'analysis'});
  add('tool','assistant',{content_type:'code',parts:['TOOL CALL']},{},{recipient:'python'});
  add('t2','assistant',{content_type:'reasoning_recap',content:'SECOND THOUGHT'},{finished_duration_sec:14});
  add('a2','assistant',{content_type:'multimodal_text',parts:['SECOND ANSWER',{content_type:'image_asset_pointer',asset_pointer:'sediment://file_generated'}]});
  return {id:cid,title:'Selection fixture',current_node:parent,mapping};
}
const raw=fixture(),chat=N.normalizeChat(raw),base={exportedAt:'2026-11-25T00:00:00Z',timeZone:'UTC'};
assert.deepEqual(E.preferences(null),E.DEFAULTS);
assert.deepEqual(E.preferences({questions:false,answers:'false',unknown:true}),{...E.DEFAULTS,questions:false});
assert.throws(()=>E.normalize({questions:'false'}),/Invalid export preference/);
assert.throws(()=>E.normalize({completeConversation:false}),/loaded conversation/);
assert.throws(()=>E.normalize({completeConversation:false,conversationId:cid,branchNode:'a2',messageIds:[]}),/Select at least/);
assert.throws(()=>E.normalize({completeConversation:false,conversationId:cid,branchNode:'a2',messageIds:['../bad']}),/loaded conversation/);
assert.equal(chat.messages.some(m=>/PRIVATE ANALYSIS|TOOL CALL/.test(m.content)),false);
assert.equal(chat.messages[0].attachments[0].fileId,'file_upload');
assert.equal(chat.messages[0].textContent,'FIRST QUESTION');
assert.match(chat.messages[0].content,/Attachment: input.txt/);
assert.equal(chat.messages.find(m=>m.id==='a1').attachments[0].sandboxPath,'/mnt/data/result.txt');
assert.equal(chat.messages.find(m=>m.id==='a2').attachments[0].fileId,'file_generated');
const rows=E.rows(chat,E.DEFAULTS);
assert.deepEqual(rows.map(r=>[r.role,r.messageIds]),[
  ['question',['q1']],['answer',['t1','a1']],['question',['q2']],['answer',['t2','a2']]
]);
assert.equal(rows[1].hasThinking,true);
assert.equal(rows[1].attachmentCount,1);
assert.match(rows[1].preview,/^FIRST ANSWER/);
assert(!rows[1].preview.includes('THOUGHT'));
assert.match(E.previewText(E.groups(chat)[1]),/^FIRST ANSWER/);
assert(!E.previewText(E.groups(chat)[1]).includes('THOUGHT'));
assert.equal(E.previewText([{role:'thinking',content:'Visible summary'}]),'No response text available');
assert.equal(E.previewText([{role:'assistant',textContent:'',attachments:[{name:'output.png'}]}]),'Response files: output.png');
assert.equal(E.previewText([{role:'user',textContent:'',attachments:[{name:'input.png'}]}]),'Uploaded or referenced files: input.png');
const multiline=structuredClone(chat);
multiline.messages.find(m=>m.id==='a1').textContent='First line of answer\nSecond line of answer';
assert.equal(E.rows(multiline,E.DEFAULTS)[1].preview,'First line of answer');
assert.equal(E.previewText(E.groups(multiline)[1]),'First line of answer\nSecond line of answer');
assert.equal(E.attachments(chat,E.DEFAULTS).length,3);

// Every category combination is independent; file-only selections are useful.
const keys=['questions','answers','thinking','uploadedFiles','generatedFiles'];
for(let mask=1;mask<32;mask++){
  const prefs={...E.DEFAULTS,...Object.fromEntries(keys.map((k,i)=>[k,!!(mask&(1<<i))]))};
  assert.deepEqual(E.rows(chat,prefs).map(r=>[r.id,r.role,r.messageIds,r.preview]),rows.map(r=>[r.id,r.role,r.messageIds,r.preview]),'preview must not change with export categories '+mask);
  const md=N.renderMarkdown(chat,{...base,exportSelection:prefs});
  assert.equal(md.includes('FIRST QUESTION'),prefs.questions,'question mask '+mask);
  assert.equal(md.includes('SECOND QUESTION'),prefs.questions,'second question mask '+mask);
  assert.equal(md.includes('FIRST ANSWER'),prefs.answers,'answer mask '+mask);
  assert.equal(md.includes('SECOND ANSWER'),prefs.answers,'second answer mask '+mask);
  assert.equal(md.includes('FIRST THOUGHT'),prefs.thinking,'thinking mask '+mask);
  assert.equal(md.includes('SECOND THOUGHT'),prefs.thinking,'second thinking mask '+mask);
  assert.equal(md.includes('### Uploaded files'),prefs.uploadedFiles,'upload mask '+mask);
  assert.equal(md.includes('### Generated files'),prefs.generatedFiles,'generated mask '+mask);
  assert(!md.includes('](sandbox:'),'no active sandbox links');
  assert(!md.includes('Image omitted'),'file placeholders do not substitute original metadata');
  if(prefs.answers)assert.equal((md.match(/^## Response:/gm)||[]).length,2,'omitted questions do not merge answers');
}
const none={...E.DEFAULTS,...Object.fromEntries(keys.map(k=>[k,false]))};
assert.throws(()=>E.validate(chat,none),/No available content/);
const choose={...E.DEFAULTS,completeConversation:false,conversationId:cid,branchNode:'a2',messageIds:['t2','a2']};
const selected=N.renderMarkdown(chat,{...base,exportSelection:choose});
assert(selected.includes('SECOND ANSWER')&&selected.includes('SECOND THOUGHT'));
assert(!selected.includes('FIRST QUESTION')&&!selected.includes('FIRST ANSWER')&&!selected.includes('input.txt')&&!selected.includes('result.txt'));
assert.match(selected,/selection_scope: selected/);
assert.match(selected,/selected_message_ids: \["t2","a2"\]/);
assert.equal(E.attachments(chat,choose).length,1);
assert.throws(()=>E.validate({...chat,id:'different'},choose),/conversation changed/);
assert.throws(()=>E.validate({...chat,branchNode:'new-answer'},choose),/branch changed/);
assert.throws(()=>E.validate(chat,{...choose,messageIds:['missing']}),/no longer available/);
assert.throws(()=>E.validate(chat,{...choose,messageIds:['a2'],answers:false,thinking:true,uploadedFiles:false,generatedFiles:false}),/No available content/);

const filesOnly={...E.DEFAULTS,questions:false,answers:false,thinking:false};
assert.deepEqual(E.rows(chat,filesOnly).map(r=>r.eligible),[true,true,false,true]);
const planned=E.attachments(chat,filesOnly);
const results=planned.map((a,i)=>({key:a.key,status:i===1?'failed':'saved',localPath:'attachments/'+a.origin+'/'+(i===0?'input (1).txt':'image.png')}));
const filesMd=N.renderMarkdown(chat,{...base,exportSelection:filesOnly,attachmentResults:results});
assert(filesMd.includes('attachments/uploaded/input%20(1).txt'));
assert(filesMd.includes('result.txt — unavailable (download failed)'));
assert(!filesMd.includes('FIRST QUESTION')&&!filesMd.includes('FIRST ANSWER')&&!filesMd.includes('FIRST THOUGHT'));
assert(!filesMd.includes('sandbox:/mnt/data/'));
for(const bad of ['../escape.txt','/root/file','https://example.com/file','attachments/%2e%2e/escape','attachments/a\\b','attachments/a\n.md']){
  const unsafe=N.renderMarkdown(chat,{...base,exportSelection:filesOnly,attachmentResults:[{key:planned[0].key,status:'saved',localPath:bad}]});
  assert(!unsafe.includes('](<'+bad+'>)'));
  assert(unsafe.includes('input.txt — unavailable'));
}

// A real file identity may be referenced by multiple selected messages.
const dupe=structuredClone(chat);dupe.messages.find(m=>m.id==='q2').attachments=[{...dupe.messages[0].attachments[0],messageId:'q2'}];
const dedup=E.attachments(dupe,E.DEFAULTS).find(x=>x.fileId==='file_upload');
assert.deepEqual(dedup.messageIds,['q1','q2']);
assert.equal(E.attachments(dupe,E.DEFAULTS).length,3);

// Full archival rendering remains the legacy path with no selection metadata.
const legacy=N.renderMarkdown(chat,base);
assert(!legacy.includes('selection_scope'));
assert(legacy.includes('[Attachment: input.txt]'));
assert(legacy.includes('[Result](sandbox:/mnt/data/result.txt)'));
console.log('PASS: all 31 category combinations, message/branch binding, attachments-only, dedup, portable links, and unchanged legacy renderer');
