'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {boot,files}=require('./provider-bootstrap');
const ctx=boot({}),C=ctx.ChatArchiveProviderContracts,R=ctx.ChatArchiveProviders,chat=R.legacy;
const plain=x=>JSON.parse(JSON.stringify(x));
const id='aaaaaaaa-1111-2222-3333-444444444444';
assert.equal(R.list().length,1);assert.equal(R.resolve('https://chatgpt.com/c/'+id).id,'chatgpt');
assert.equal(R.resolve('https://chat.openai.com/').id,'chatgpt');
for(const url of ['http://chatgpt.com/','https://chatgpt.com.evil.test/','https://chatgpt.com@evil.test/','https://evil.test/chatgpt.com/','chrome://extensions','https://claude.ai/','https://gemini.google.com/','https://chatgpt.com:443/','https://chatgpt.com?fake=1',''])assert.equal(R.resolve(url),null,url);
assert(R.isLegacyUrl('https://chatgpt.com'));assert(!R.isLegacyUrl('https://chatgpt.com',{requirePath:true}));
assert.equal(chat.conversationId('/g/g-p-11111111111111111111111111111111/c/'+id),id);
assert.equal(chat.conversationId('/c/'+id+'x'),id,'legacy API parsing is preserved');
assert.equal(chat.observedConversationId('/c/'+id+'x'),'','observer requires path boundary');
assert.equal(chat.routeProjectId('/g/g-p-11111111111111111111111111111111/c/'+id),'g-p-11111111111111111111111111111111');
assert.equal(chat.observedProjectId('/g/g-p-11111111111111111111111111111111-a-name/c/'+id),'g-p-11111111111111111111111111111111');
const scope=chat.accountInfo({account:{id:'same-id',name:'Workspace A'},accessToken:'PRIVATE'});
assert.deepEqual(plain(scope),{accountId:'same-id',display:'Workspace A',observed:true});
assert(R.verified(scope,'same-id'));assert(!R.verified(scope,'different-id'));
assert(!R.verified(chat.accountInfo({accountId:'same-id'}),'same-id'));
assert(!R.verified({...scope,providerId:'fake'},'same-id'));
assert.equal(C.identityKey(R.identity(scope)),'["chatgpt","same-id"]');
assert.equal(C.workspaceIdentity('fake',scope),null,'legacy scopes cannot be silently reused by a new provider');
const other={...scope,providerId:'fake'};
assert.notEqual(C.identityKey(C.workspaceIdentity('fake',other)),C.identityKey(R.identity(scope)));
assert(!C.verifiedScope(other,'chatgpt','same-id',true));
assert(!JSON.stringify(R.identity(scope)).includes('PRIVATE'));
assert.throws(()=>C.defineProvider({}),/Invalid provider/);assert.throws(()=>C.createRegistry([chat,chat],'chatgpt'),/Duplicate/);
const fake=C.defineProvider({id:'fake',displayName:'Fixture only',hostPatterns:['https://fixture.invalid/*'],matchesUrl:url=>String(url).startsWith('https://fixture.invalid/'),bridgeFiles:[],operations:['status','getChat'],capabilities:{conversations:true}});
const composite=C.createRegistry([chat,fake],'chatgpt');
assert.equal(composite.resolve('https://fixture.invalid/c/x').id,'fake');assert(!composite.isLegacyUrl('https://fixture.invalid/c/x'));
const stub=C.operationClient(fake,()=>({status:async()=>other,getChat:async item=>({id:item.id,title:'Fixture',messages:[]})}));
assert.equal(stub.libraryPage,undefined);assert(Object.isFrozen(stub));assert.throws(()=>C.operationClient(fake,()=>({})).status(),/unavailable/);
const ambiguous=C.createRegistry([chat,{...fake,matchesUrl:chat.matchesUrl}],'chatgpt');assert.equal(ambiguous.resolve('https://chatgpt.com/'),null);assert(!ambiguous.isLegacyUrl('https://chatgpt.com/'));
const root=path.join(__dirname,'..'),manifest=require('../manifest.json');
assert.deepEqual(plain(chat.hostPatterns),manifest.host_permissions);assert.deepEqual(manifest.content_scripts[0].matches,manifest.host_permissions);
assert.deepEqual(plain(chat.bridgeFiles),manifest.content_scripts[0].js.slice(0,-1));assert.equal(manifest.content_scripts[0].js.at(-1),'ui/widget.js');
for(const name of ['panel.html','popup.html','options.html']){
 const scripts=[...fs.readFileSync(path.join(root,name),'utf8').matchAll(/<script src="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(scripts.slice(0,3),files);
}
for(const name of ['panel.js','lib/tab-bootstrap.js','lib/sync.js','lib/manual-jobs.js','lib/library-jobs.js','ui/worker-ui.js']){
 const code=fs.readFileSync(path.join(root,name),'utf8');assert(code.includes('ChatArchiveProviders'),name);
 assert(!code.includes('chatgpt\\.com')&&!code.includes('chat.openai.com/*'),name+' has duplicated eligibility rules');
}
(async()=>{assert.equal((await stub.status()).providerId,'fake');assert.equal((await stub.getChat({id:'opaque-id'})).id,'opaque-id');console.log('PASS: provider registry, exact legacy host allowlist, distinct route policies, scoped identities, capability/operation facade, fake adapter isolation, entrypoint load order');})().catch(e=>{console.error(e);process.exitCode=1;});
