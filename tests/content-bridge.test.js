const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../lib/source-transfer');
let connect;let opens=0;
const sandbox={window:{addEventListener(){}},location:{pathname:'/'},document:{body:{},visibilityState:'visible',readyState:'complete',getElementById(){return null;},addEventListener(){}},
 chrome:{runtime:{id:'this-extension',onConnect:{addListener(fn){connect=fn;}}}},
 setInterval(){},setTimeout,clearTimeout,AbortController,console,
 ChatArchiveApi:{sourceLocation:async()=>({downloadUrl:'https://chatgpt.com/backend-api/estuary/content?id=file_x&sig=TOP_SECRET',origin:'https://chatgpt.com',headers:{Authorization:'Bearer TOP_SECRET'}})},
 ChatArchiveSourceTransfer:{createTransport:()=>T.createTransport({fetchImpl:async()=>{opens++;return new Response(new Uint8Array(500000).fill(255));}})}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8'),sandbox);
const event=()=>({callbacks:[],addListener(fn){this.callbacks.push(fn);}});
function port(id='this-extension'){
 const pending=new Map();let seq=0;
 const p={name:'CAE_API',sender:{id},onMessage:event(),onDisconnect:event(),postMessage(m){pending.get(m.id)?.(m);pending.delete(m.id);},async request(data){const id=++seq;const result=new Promise(res=>pending.set(id,res));for(const cb of p.onMessage.callbacks)cb({id,...data});return result;}};
 connect(p);return p;
}
(async()=>{
 assert.equal(opens,0);
 const foreign=port('another-extension');assert.equal(foreign.onMessage.callbacks.length,0);
 const a=port(),b=port();
 let r=await a.request({type:'CAE_SOURCE_START',fileId:'file_x',projectId:'g-p-a',maxBytes:600000});assert(!r.error);
 const busy=await b.request({type:'CAE_SOURCE_START',fileId:'file_x',projectId:'g-p-a',maxBytes:600000});assert(busy.error.includes('Another source'));
 const parts=[];
 do{r=await a.request({type:'CAE_SOURCE_READ'});assert(!r.error);assert(!JSON.stringify(r).includes('TOP_SECRET'));if(!r.result.done)parts.push(Buffer.from(r.result.base64,'base64'));}while(!r.result.done);
 assert.equal(Buffer.concat(parts).length,500000);
 r=await b.request({type:'CAE_SOURCE_START',fileId:'file_x',projectId:'g-p-a',maxBytes:600000});assert(!r.error);
 await b.request({type:'CAE_SOURCE_CLOSE'});
 r=await b.request({type:'CAE_SOURCE_READ'});assert(r.error.includes('No source'));
 r=await a.request({type:'CAE_SOURCE_START',fileId:'file_x',projectId:'g-p-a',maxBytes:600000});assert(!r.error);
 for(const f of a.onDisconnect.callbacks)f();await new Promise(r=>setTimeout(r,0));
 r=await b.request({type:'CAE_SOURCE_START',fileId:'file_x',projectId:'g-p-a',maxBytes:600000});assert(!r.error);
 await b.request({type:'CAE_SOURCE_CLOSE'});
 console.log('PASS: content-port protocol, one transfer per tab, JSON chunks, sender gate, token isolation, cancellation/disconnect cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
