'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../lib/source-transfer');
let connect,opened=0,retired=0,observed;
const bytes=new Uint8Array([0,1,127,128,255]);
const box={location:{pathname:'/c/11111111-1111-1111-1111-111111111111'},
  document:{readyState:'complete',getElementById(id){return id==='cae-inpage-button'?{remove(){retired++;}}:null;},
    createElement(){throw Error('Export controls must not be inserted into the provider page.');}},
  chrome:{runtime:{id:'extension',getManifest:()=>({version:'0.1.9'}),onConnect:{addListener(fn){connect=fn;}}}},
  setTimeout,clearTimeout,AbortController,console,
  ChatArchiveApi:{attachmentLocation:async(a,account,signal)=>{
    observed={a,account,signal};
    if(a.key==='missing')throw Object.assign(Error('Original unavailable.'),{code:'ATTACHMENT_UNAVAILABLE'});
    return {downloadUrl:'https://chatgpt.com/backend-api/estuary/content?sig=PRIVATE',origin:'https://chatgpt.com',
      headers:{Authorization:'Bearer PRIVATE'}};
  }},
  ChatArchiveSourceTransfer:{createTransport:()=>T.createTransport({fetchImpl:async(_url,opts)=>{
    opened++;assert.equal(opts.headers.Authorization,'Bearer PRIVATE');return new Response(bytes);
  }})}};
vm.runInNewContext(fs.readFileSync(__dirname+'/../content.js','utf8'),box);
assert.equal(retired,1);
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
function port(sender='extension'){
  let seq=0;const pending=new Map();
  const p={name:'CAE_API',sender:{id:sender},onMessage:event(),onDisconnect:event(),
    postMessage(m){pending.get(m.id)?.(m);pending.delete(m.id);},
    request(m){const id=++seq,result=new Promise(resolve=>pending.set(id,resolve));for(const fn of p.onMessage.listeners)fn({id,...m});return result;}};
  connect(p);return p;
}
(async()=>{
  assert.equal(port('foreign').onMessage.listeners.length,0);
  const p=port(),other=port(),attachment={conversationId:'chat-id',messageId:'message-id',fileId:'file_original',key:'file:file_original'};
  let r=await p.request({type:'CAE_ATTACHMENT_START',attachment,expectedAccountId:'workspace-A',maxBytes:100});
  assert(!r.error);assert.equal(observed.a,attachment);assert.equal(observed.account,'workspace-A');assert(observed.signal);
  assert(!JSON.stringify(r).includes('PRIVATE'),'No token or signed URL crosses the bridge.');
  r=await other.request({type:'CAE_ATTACHMENT_START',attachment,maxBytes:100});assert(r.error.includes('Another source'));
  r=await p.request({type:'CAE_SOURCE_READ'});assert.deepEqual(Buffer.from(r.result.base64,'base64'),Buffer.from(bytes));
  r=await p.request({type:'CAE_SOURCE_READ'});assert.equal(r.result.done,true);assert.equal(r.result.totalBytes,5);
  r=await p.request({type:'CAE_ATTACHMENT_START',attachment:{key:'missing'},maxBytes:100});assert.equal(r.errorCode,'ATTACHMENT_UNAVAILABLE');
  r=await other.request({type:'CAE_ATTACHMENT_START',attachment,maxBytes:100});assert(!r.error,'Failed resolution releases source owner.');
  await other.request({type:'CAE_SOURCE_CLOSE'});
  assert.equal(opened,2);
  console.log('PASS: attachment byte bridge, secret isolation, transfer ownership, failure cleanup and no injected export button');
})().catch(e=>{console.error(e);process.exitCode=1;});
