'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(base,p),'utf8');
const files=['lib/markdown-primitives.js','lib/export-selection.js','lib/markdown.js','lib/source-transfer.js'];
const context=vm.createContext({Date,URL,TextEncoder,Uint8Array,AbortController,setTimeout,clearTimeout,btoa,console});
for(const f of files)vm.runInContext(read(f),context,{filename:f});
assert.equal(context.ChatArchiveChatGPTNormalize,undefined);
assert.equal(context.ChatArchiveChatGPTHttp,undefined);
const renderer=context.ChatArchiveMarkdown.createRenderer({providerId:'fixture',displayName:'Fixture',defaultSource:c=>'https://fixture.invalid/'+c.id,mapSandboxLinks:s=>s});
const chat={id:'opaque-id',title:'Example',created:'2026-11-01T00:00:00Z',updated:'2026-11-02T00:00:00Z',messages:[{id:'q',role:'user',content:'Question',time:'2026-11-01T00:00:00Z'},{id:'t',role:'thinking',content:'Visible summary'},{id:'a',role:'assistant',content:'Answer'}],warnings:[]};
const md=renderer.renderMarkdown(chat,{exportedAt:'2026-11-03T00:00:00Z',timeZone:'UTC'});
assert(md.includes('provider: fixture'));assert(md.includes('https://fixture.invalid/opaque-id'));assert(md.includes('Thinking (provided by Fixture)'));assert(!md.includes('ChatGPT'));
assert.throws(()=>context.ChatArchiveSourceTransfer.createTransport(),e=>e.code==='SOURCE_POLICY_REQUIRED');
for(const f of ['lib/markdown.js','lib/markdown-primitives.js','lib/source-transfer.js'])assert(!/chatgpt\.com|backend-api|oaiusercontent|ChatGPT-Account-Id|chrome\.|document\./i.test(read(f)),f+' contains provider/browser-specific code');
const manifest=require('../manifest.json'),scripts=manifest.content_scripts[0].js;
for(const f of ['providers/chatgpt/http.js','providers/chatgpt/api.js','providers/chatgpt/normalize.js','providers/chatgpt/original-policy.js'])assert(scripts.includes(f),f+' missing in content bridge');
assert(scripts.indexOf('providers/chatgpt/http.js')<scripts.indexOf('providers/chatgpt/api.js'));
assert(scripts.indexOf('providers/chatgpt/normalize.js')<scripts.indexOf('providers/chatgpt/api.js'));
for(const f of ['worker.js','panel.html','popup.html','options.html','offscreen.html']){
 const code=read(f);for(const privateModule of ['providers/chatgpt/http.js','providers/chatgpt/api.js','providers/chatgpt/normalize.js','providers/chatgpt/original-policy.js'])assert(!code.includes(privateModule),f+' loads isolated adapter module '+privateModule);
}
for(const old of ['lib/api.js','lib/config-inventory.js','lib/library-inventory.js'])assert(!scripts.includes(old),'retired runtime path '+old);
let calls=0;const t=context.ChatArchiveSourceTransfer.createTransport({authorize:()=>{throw Object.assign(Error('Rejected original'),{code:'SOURCE_ORIGIN_UNSUPPORTED'});},fetchImpl:async()=>{calls++;throw Error('must not fetch');}});
(async()=>{await assert.rejects(t.open({downloadUrl:'https://fixture.invalid/',origin:'https://fixture.invalid',headers:{Authorization:'private'}}),e=>e.code==='SOURCE_ORIGIN_UNSUPPORTED');assert.equal(calls,0);console.log('PASS: provider-independent renderer and byte transfer, explicit policy, isolated raw decoder/HTTP modules, exact legacy entrypoint separation');})().catch(e=>{console.error(e);process.exitCode=1;});
