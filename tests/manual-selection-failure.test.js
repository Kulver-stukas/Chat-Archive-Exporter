'use strict';
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
const N=require('../lib/normalize'),E=require('../lib/export-selection');
function selected(e,id){
  const chat=N.normalizeChat({id:e.chat(1).id,title:'Failure recovery',current_node:'answer-1',mapping:{
    'question-1':{id:'question-1',parent:null,children:['answer-1'],message:{author:{role:'user'},content:{content_type:'text',parts:['Selected prompt']},
      metadata:{attachments:[{id:'file_inaccessible',name:'private.txt'},{id:'file_available',name:'public.txt'}]}}},
    'answer-1':{id:'answer-1',parent:'question-1',children:[],message:{author:{role:'assistant'},content:{content_type:'text',parts:['Selected answer']}}}
  }});
  e.normalizedChats.set(chat.id,chat);e.blobs.set('file_available',new TextEncoder().encode('available original'));
  const o=e.opts(id,[e.chat(1)],'download','current');o.exportSelection={...E.DEFAULTS,conversationId:chat.id};return o;
}
(async()=>{
  // A per-file denial is a reportable unavailable outcome, not an account-login wait.
  let e=createEnvironment();e.downloadState='in_progress';let o=selected(e,'job-unavailable-403-12345');
  e.onCall=async(type,arg)=>{
    if(type==='CAE_ATTACHMENT_START'&&arg.attachment.fileId==='file_inaccessible')
      throw Object.assign(Error('The original file is no longer available for this message.'),{code:'ATTACHMENT_UNAVAILABLE',httpStatus:403});
  };
  await e.submit(o);let state=await e.drain();
  assert.equal(state.status,'download_pending');
  let stored=await e.S.get(o.requestId);
  assert.equal(stored.attachmentReport.counts.unavailable,1);
  assert.equal(stored.attachmentReport.counts.saved,1);
  assert.equal(e.calls.filter(x=>x.type==='CAE_ATTACHMENT_START'&&x.attachment.fileId==='file_inaccessible').length,1);
  const report=JSON.parse(await(await e.S.entry(o.requestId,'selection-report')).blob.text());
  assert.equal(report.files.find(x=>x.fileId==='file_inaccessible').status,'unavailable');
  assert.equal(report.files.find(x=>x.fileId==='file_available').status,'saved');

  // A persistently missing/unreadable selected conversation terminates once the
  // existing retry allowance is exhausted, instead of looping on items[0].
  for(const problem of [()=>Object.assign(Error('ChatGPT API HTTP 404'),{httpStatus:404}),
    ()=>Error('Conversation has no readable mapping; refusing to export an empty document.')]){
    e=createEnvironment();o=selected(e,'job-missing-conversation-12345');
    e.onCall=async type=>{if(type==='CAE_GET_CHAT')throw problem();};
    await e.submit(o);
    for(let i=0;i<3;i++){await e.C.tick();e.advance(400000);}
    state=await e.C.inspect();assert.equal(state.status,'failed');assert.equal(state.active,false);
    const reads=e.calls.filter(x=>x.type==='CAE_GET_CHAT').length;assert.equal(reads,3);
    for(let i=0;i<3;i++){await e.C.tick();e.advance(400000);}
    assert.equal(e.calls.filter(x=>x.type==='CAE_GET_CHAT').length,reads,'Terminal failure cannot start more provider requests.');
    assert.equal(e.downloads.length,0,'Do not deliver an empty current-chat document.');
    assert.equal((await e.S.entries(o.requestId)).length,0);
  }
  console.log('PASS: denied original reported once and processing continues; persistent selected-chat failures terminate after bounded retries');
})().catch(e=>{console.error(e);process.exitCode=1;});
