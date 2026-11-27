'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const id='aaaaaaaa-1111-2222-3333-444444444444';
let now=300000,role='assistant',text='previous answer',listener,seq=0;
const timers=new Map(),sent=[];
const turn={get textContent(){return text;},getAttribute(name){
  if(name==='data-message-author-role')return role;
  if(name==='data-message-id')return 'message-'+role;
  return null;
}};
const area={querySelectorAll:s=>{
  assert(s.includes('data-message-author-role')&&s.includes('conversation-turn-'));
  return [turn];
},querySelector:()=>null};
const doc={visibilityState:'visible',querySelector:s=>s==='main'?area:null,
  addEventListener(){}};
const runtime={id:'self',sendMessage:async msg=>{sent.push(msg);return {ok:true,result:{accepted:true}};},
  onMessage:{addListener(fn){listener=fn;}}};
const env={chrome:{runtime},document:doc,location:{pathname:'/c/'+id,search:''},
  Date:{now:()=>now},window:{addEventListener(){}},
  setTimeout(fn,ms){const n=++seq;timers.set(n,{fn,ms});return n;},
  clearTimeout(n){timers.delete(n);}};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../sync-watch.js'),'utf8'),require('./provider-bootstrap').boot(env));
assert.equal(sent.filter(x=>x.type==='CAE_SYNC_SIGNAL').length,0,'inert before opting in');
listener({type:'CAE_SYNC_WATCH',enabled:true},{id:'self'},()=>{});
assert.equal(sent.at(-1).streaming,false,'existing assistant response is a stable baseline');
function advance(){const item=[...timers.entries()][0];assert(item);timers.delete(item[0]);now+=item[1].ms;item[1].fn();}
for(let i=0;i<3;i++)advance();
assert.equal(sent.filter(x=>x.type==='CAE_SYNC_SIGNAL').length,1,'stable baseline never emits more signals');
role='user';text='new prompt';advance();
assert.equal(sent.at(-1).streaming,true,'new user turn is treated as pending, without a Stop button');
role='assistant';text='first answer chunk';advance();
assert.equal(sent.at(-1).streaming,true,'new assistant text is provisional while settling');
text='last answer chunk';advance();
assert.equal(sent.at(-1).streaming,true,'changed assistant text extends the settle interval');
for(let i=0;i<6;i++)advance();
const last=sent.at(-1);
assert.equal(last.type,'CAE_SYNC_SIGNAL');
assert.equal(last.streaming,false,'completion generated after a stable assistant turn without Stop selector');
assert.equal(last.conversationId,id);
assert(!JSON.stringify(sent).includes('first answer chunk'));
assert(!JSON.stringify(sent).includes('last answer chunk'));
assert(sent.filter(x=>x.type==='CAE_SYNC_SIGNAL').length<=6,'one turn never creates constant background traffic');
console.log('PASS: prompt and response detected using current-turn attributes, conservative settling, no Stop button or message-text exfiltration');
