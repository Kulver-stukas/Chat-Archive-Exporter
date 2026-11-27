'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A='workspace-A',C='11111111-1111-1111-1111-111111111111';
const F='file_00000000000000000000000000000001',G='file_00000000000000000000000000000002';
function environment(){
  const e={scope:A,calls:[],resolverStatus:200,resolverBody:null,flipOn:'',raw:{
    conversation_id:C,workspace_id:A,title:'Attachment scope',current_node:'answer-1',mapping:{
      'question-1':{id:'question-1',parent:null,children:['answer-1','other-answer'],message:{id:'provider-question-1',
        author:{role:'user'},content:{content_type:'text',parts:['Review the upload.']},metadata:{attachments:[{id:F,name:'report.txt'}]}}},
      'answer-1':{id:'answer-1',parent:'question-1',children:[],message:{id:'provider-answer-1',
        author:{role:'assistant'},content:{content_type:'text',parts:['[Download](sandbox:/mnt/data/report%20%281%29.csv)']}}},
      'other-answer':{id:'other-answer',parent:'question-1',children:[],message:{id:'provider-other-answer',
        author:{role:'assistant'},content:{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'sediment://'+G}]}}}
    }}};
  const box={document:{cookie:''},location:{origin:'https://chatgpt.com',pathname:'/c/'+C},console,Map,Set,Date,URL,AbortSignal,setTimeout,clearTimeout,
    fetch:async(path,opts={})=>{
      e.calls.push({path,opts});
      if(path==='/api/auth/session')return Response.json({accessToken:'PRIVATE-TOKEN',account:{id:e.scope}});
      assert.equal(opts.headers['ChatGPT-Account-Id'],A);
      assert.equal(opts.headers.Authorization,'Bearer PRIVATE-TOKEN');
      assert.notEqual(opts.method,'POST','Attachment resolution must be read-only.');
      if(e.flipOn&&path.includes(e.flipOn))e.scope='workspace-B';
      if(path==='/backend-api/conversation/'+C)return Response.json(e.raw);
      if(path.startsWith('/backend-api/files/download/')||path.startsWith('/backend-api/conversation/'+C+'/interpreter/download')){
        return Response.json(e.resolverBody||{download_url:'https://chatgpt.com/backend-api/estuary/content?id='+F+'&sig=PRIVATE-SIGNATURE'},
          {status:e.resolverStatus});
      }
      throw Error('Unexpected request '+path);
    }};
  box.window=box;
  vm.createContext(box);require('./provider-bootstrap').boot(box);
  for(const f of ['export-selection','normalize','../providers/chatgpt/library-inventory','../providers/chatgpt/api'])
    vm.runInContext(fs.readFileSync(__dirname+'/../lib/'+f+'.js','utf8'),box);
  e.api=box.ChatArchiveApi;
  e.refs=()=>box.ChatArchiveExportSelection.attachments(box.ChatArchiveNormalize.normalizeChat(e.raw),{});
  e.file=()=>e.refs().find(x=>x.fileId===F);
  e.sandbox=()=>e.refs().find(x=>x.sandboxPath);
  e.resolverCalls=()=>e.calls.filter(x=>/files\/download|interpreter\/download/.test(x.path));
  return e;
}
(async()=>{
  let e=environment();
  let loc=await e.api.attachmentLocation(e.file(),A);
  assert(loc.downloadUrl.includes('PRIVATE-SIGNATURE'));
  assert.equal(loc.headers.Authorization,'Bearer PRIVATE-TOKEN');
  let route=new URL(e.resolverCalls()[0].path,'https://chatgpt.com');
  assert.equal(route.pathname,'/backend-api/files/download/'+F);
  assert.equal(route.searchParams.get('conversation_id'),C);
  assert.equal(route.searchParams.get('inline'),'false');
  loc=await e.api.attachmentLocation(e.sandbox(),A);
  assert(loc.downloadUrl.includes('PRIVATE-SIGNATURE'));
  route=new URL(e.resolverCalls().at(-1).path,'https://chatgpt.com');
  assert.equal(route.pathname,'/backend-api/conversation/'+C+'/interpreter/download');
  assert.equal(route.searchParams.get('sandbox_path'),'/mnt/data/report (1).csv');
  assert.equal(route.searchParams.get('message_id'),'provider-answer-1','Use provider message ID, not a mapping-node alias.');
  assert.equal(route.searchParams.get('download_intent'),'true');

  // A visible image-generation result belongs to its exact tool message.
  // The legacy file- identifier is allowed only through this scoped path.
  e=environment();const legacyImage='file-LegacyGeneratedImage123';
  e.raw.mapping['generated-image']={id:'generated-image',parent:'answer-1',children:[],message:{
    id:'provider-generated-image',author:{role:'tool'},metadata:{image_gen_title:'An illustration'},
    content:{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'sediment://'+legacyImage+'?width=1024&sig=PRIVATE'}]}}};
  e.raw.mapping['answer-1'].children.push('generated-image');e.raw.current_node='generated-image';
  const image=e.refs().find(x=>x.fileId===legacyImage);assert(image);
  assert.equal(image.messageId,'generated-image');
  await e.api.attachmentLocation(image,A);
  route=new URL(e.resolverCalls().at(-1).path,'https://chatgpt.com');
  assert.equal(route.pathname,'/backend-api/files/download/'+legacyImage);
  assert.equal(route.searchParams.get('conversation_id'),C);
  assert(!route.searchParams.has('sig'));
  const before=e.resolverCalls().length;
  e.raw.current_node='other-answer';
  await assert.rejects(e.api.attachmentLocation(image,A),x=>x.code==='ATTACHMENT_CHANGED');
  assert.equal(e.resolverCalls().length,before);
  await assert.rejects(e.api.assetLocation(legacyImage,A),/Invalid Library file identifier/);

  // Exact conversation/message/locator binding; an ID is not authorization by itself.
  for(const change of [{messageId:'answer-1'},{key:'file:'+G},{fileId:G},
    {fileId:G,key:'file:'+G,messageId:'other-answer'}]){
    e=environment();await assert.rejects(e.api.attachmentLocation({...e.file(),...change},A),x=>x.code==='ATTACHMENT_CHANGED');
    assert.equal(e.resolverCalls().length,0);
  }
  e=environment();const stale=e.sandbox();e.raw.current_node='other-answer';
  await assert.rejects(e.api.attachmentLocation(stale,A),x=>x.code==='ATTACHMENT_CHANGED');
  assert.equal(e.resolverCalls().length,0,'Other branch attachment must not be downloaded.');

  for(const change of [{url:'https://example.com/private'},
    {sandboxPath:'/mnt/data/../secret',fileId:null},{sandboxPath:'https://example.com/a',fileId:null},
    {sandboxPath:'/mnt/data/a?x=1',fileId:null},{sandboxPath:'/mnt/data/a\\b',fileId:null},
    {conversationId:'../other'},{messageId:'../../other'},{key:''}]){
    e=environment();await assert.rejects(e.api.attachmentLocation({...e.file(),...change},A),x=>x.code==='ATTACHMENT_INVALID');
    assert.equal(e.calls.length,0,'Malformed references fail before any network request.');
  }
  e=environment();e.scope='workspace-B';
  await assert.rejects(e.api.attachmentLocation(e.file(),A),x=>x.code==='WORKSPACE_CHANGED');
  assert(!e.calls.some(x=>x.path.startsWith('/backend-api')));
  e=environment();e.flipOn='/backend-api/conversation/'+C;
  await assert.rejects(e.api.attachmentLocation(e.file(),A),x=>x.code==='WORKSPACE_CHANGED');
  assert.equal(e.resolverCalls().length,0);
  e=environment();e.flipOn='/interpreter/download';
  await assert.rejects(e.api.attachmentLocation(e.sandbox(),A),x=>x.code==='WORKSPACE_CHANGED');
  e=environment();const ref=e.file();e.raw.workspace_id='workspace-B';
  await assert.rejects(e.api.attachmentLocation(ref,A),x=>x.code==='WORKSPACE_CHANGED');
  e=environment();const temporary=e.file();e.raw.is_temporary=true;
  await assert.rejects(e.api.attachmentLocation(temporary,A),x=>x.code==='ATTACHMENT_UNAVAILABLE');
  assert.equal(e.resolverCalls().length,0);

  for(const status of [403,404,410]){
    e=environment();e.resolverStatus=status;e.resolverBody={detail:'PRIVATE-RESPONSE'};
    await assert.rejects(e.api.attachmentLocation(e.sandbox(),A),x=>x.code==='ATTACHMENT_UNAVAILABLE'&&x.httpStatus===status&&!x.message.includes('PRIVATE'));
    assert.equal(e.resolverCalls().length,1,'Unavailable originals have no guessed fallback endpoint.');
  }
  e=environment();e.resolverBody={status:'error',error_code:'ace_pod_expired',error_message:'PRIVATE-RESPONSE'};
  await assert.rejects(e.api.attachmentLocation(e.sandbox(),A),x=>x.code==='ATTACHMENT_UNAVAILABLE'&&!x.message.includes('PRIVATE'));
  e=environment();const abort=new AbortController();abort.abort();
  await assert.rejects(e.api.attachmentLocation(e.file(),A,abort.signal),x=>x.code==='SOURCE_ABORTED');
  assert.equal(e.calls.length,0);
  assert(!e.calls.some(x=>/memory|memories|accounts\/check|\/backend-api\/pages/.test(x.path)));
  console.log('PASS: exact attachment binding, original file/sandbox resolvers, active branch/workspace guards, safe unavailable outcomes and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
