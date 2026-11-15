'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let now=100000,streaming=false,text='initial',enabledMessage;const messages=[],events={},timers=new Map();let seq=0;
const id='aaaaaaaa-1111-2222-3333-444444444444';
const node={get textContent(){return text;},getAttribute:k=>k==='data-message-id'?'m1':null};
const doc={visibilityState:'visible',querySelector:q=>q==='main'?{querySelector:()=>streaming?{}:null,querySelectorAll:()=>[node]}:(streaming?{}:null),addEventListener:(n,f)=>events[n]=f};
const sandbox={document:doc,location:{pathname:'/c/'+id,search:''},Date:{now:()=>now},window:{addEventListener:(n,f)=>events[n]=f},
 chrome:{runtime:{id:'self',sendMessage:async x=>{messages.push(x);return {};},onMessage:{addListener:f=>enabledMessage=f}}},
 setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sync-watch.js'),'utf8'),sandbox);
assert.equal(messages.length,1);assert.equal(messages[0].type,'CAE_SYNC_HELLO');assert.equal(timers.size,0,'no timer before explicit opt-in');
enabledMessage({type:'CAE_SYNC_WATCH',enabled:true},{id:'foreign'},()=>{});assert.equal(timers.size,0);
enabledMessage({type:'CAE_SYNC_WATCH',enabled:true},{id:'self'},()=>{});
assert(messages.some(m=>m.type==='CAE_SYNC_SIGNAL'));assert.equal(timers.size,1);
function sample(){const t=[...timers.entries()][0];if(!t)return;timers.delete(t[0]);now+=t[1].ms;t[1].fn();}
const before=messages.length;for(let i=0;i<30;i++)sample();assert.equal(messages.length,before,'unchanged page does not spam runtime');
// User switches tabs immediately after Send, before the first sample.
streaming=true;text='partial';doc.visibilityState='hidden';events.visibilitychange();
assert(messages.at(-1).streaming);assert.equal(timers.size,1,'newly hidden generating tab is retained');
text='finished';streaming=false;sample();for(let i=0;i<3;i++)sample();assert.equal(messages.at(-1).streaming,false,'completion signalled after bounded content-stability interval');
for(let i=0;i<10;i++)sample();assert.equal(timers.size,0,'finished hidden tab is released');
assert(!JSON.stringify(messages).includes('partial'));assert(!JSON.stringify(messages).includes('finished'),'no message text leaves watcher');
console.log('PASS: watcher inert by default, same-extension gate, bounded latest-message sampling, no text payload, hidden pending completion and cleanup');
