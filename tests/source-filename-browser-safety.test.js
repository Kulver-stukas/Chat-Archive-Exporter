'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment(),P=e.box.ChatArchivePaths,V=e.box.ChatArchiveVault,T=e.box.ChatArchiveVaultTransfer;
 for(const ext of ['.url','.lnk','.scf','.local','.exe','.dll','.bat','.cmd','.ps1']){
   const actual=P.sourceFilename('danger'+ext,'file_12345','text/plain');
   assert(actual.endsWith('.cae-file'),ext+' must receive an inert on-disk suffix');
   assert(V.validPath('ChatGPT/Test/Sources/'+actual));
 }
 assert.equal(P.sourceFilename('normal.js','file_1','text/javascript'),'normal.js');
 assert(!/\u202e/.test(P.sourceFilename('a\u202e.txt','file_1','text/plain')));
 const prefix='ChatGPT/Test Vault',account=e.account;
 const v=await V.openStore(e.root);await v.useWorkspace(prefix,account);
 const input=Uint8Array.from([0,255,54,40,78]);
 const path=prefix+'/A/Sources/fails-chromium.md';
 const parent=await V.parentDirectory(e.root,path,true),orig=parent.dir.getFileHandle.bind(parent.dir);
 parent.dir.getFileHandle=(name,opts)=>{
   if(name==='fails-chromium.md' && opts?.create)throw new TypeError("Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.");
   return orig(name,opts);
 };
 let opened=0,read=0;
 const job={key:'p:file_123456789012345678901234',projectId:'p',fileId:'file_123456789012345678901234',
   name:'fails-chromium.md',path,expectedBytes:input.length,category:'uploaded_file'};
 const transport={start:async()=>{opened++;read=0;return {};},
   read:async()=>++read===1?{done:false,base64:Buffer.from(input).toString('base64'),byteLength:input.length}:{done:true,totalBytes:input.length},
   close:async()=>{}};
 let report=await T.run([job],{vault:v,transport,expectedAccountId:account,pause:async()=>{}});
 assert.equal(report.counts.saved,1);
 assert(report.results[0].local_path.endsWith('fails-chromium.md.cae-file'));
 const saved=v.getSourceIndex(account+'|'+job.key);
 assert.equal(saved.name,'fails-chromium.md');
 assert.equal(saved.original_filename,'fails-chromium.md');
 assert.equal(saved.stored_filename,'fails-chromium.md.cae-file');
 assert.equal(saved.filename_aliased,true);
 const disk=await V.lookupFile(e.root,saved.path);
 assert.deepEqual(new Uint8Array(await (await disk.handle.getFile()).arrayBuffer()),input);
 assert.equal(saved.sha256,crypto.createHash('sha256').update(input).digest('hex'));
 // The persisted alias is reused, not re-downloaded or silently renamed.
 report=await T.run([job],{vault:v,transport,expectedAccountId:account,pause:async()=>{}});
 assert.equal(report.counts.skipped,1);assert.equal(opened,1);
 console.log('PASS: Chromium-inert aliases, original filename and SHA in index, create-time rejection fallback, safe subsequent preflight');
})().catch(e=>{console.error(e);process.exitCode=1;});
