'use strict';
const assert=require('node:assert/strict');
const {createLibraryEnvironment,fid}=require('./library-job-fixtures');
(async()=>{
 const e=createLibraryEnvironment();
 e.rootRows=[e.node(1,'report.md'),e.node(2,'source.md'),e.node(3,'script.js'),e.node(4,'Good.png',{mime_type:'image/png'})];
 e.projectRefs=[e.ref(2)];e.gallery=[e.image(4)];
 for(const n of [1,3])e.detailMap[fid(n)]={use_case:'caas',mime_type:n===3?'application/javascript':'text/markdown',size:3};
 e.blobs.set(fid(1),new TextEncoder().encode('abc'));e.blobs.set(fid(2),new TextEncoder().encode('src'));e.blobs.set(fid(4),new Uint8Array([1,2,3]));
 e.assetMime[fid(1)]='text/markdown';e.assetMime[fid(4)]='image/png';
 e.assetErrors[fid(3)]=Object.assign(Error('Original HTTP 415'),{code:'SOURCE_HTTP',httpStatus:415});
 await e.start(false);await e.drainLib();
 // A Project Source not yet archived in Vault must remain selectable in Library.
 const linked=(await e.L.inspect(e.account)).catalog.items.find(x=>x.file_id===fid(2));
 assert.equal(linked.managed_by_project_sources,true);
 assert.equal(linked.archive_eligibility.selectable,true);
 await e.L.submitArchive({accountId:e.account,ids:[1,2,3,4].map(n=>'file:'+fid(n)),tabId:1});
 const result=await e.drainLib();assert.equal(result.job.status,'complete');
 assert.deepEqual(result.report.results.map(x=>x.status),['saved','saved','failed','saved']);
 assert.equal(result.report.results[2].http_status,415);
 assert.equal(e.libCalls.filter(x=>x.type==='CAE_ASSET_START'&&x.fileId===fid(3)).length,1,'415 must not be retried');
 const text=result.report.results[0],img=result.report.results[3];
 assert(text.local_path.includes('/Generated/Files/'));assert(img.local_path.includes('/Generated/Images/'));
 assert.equal(await e.read(text.local_path),'abc');assert.match(text.sha256,/^[a-f0-9]{64}$/);
 const calls=e.libCalls.filter(x=>x.type==='CAE_ASSET_START').length;
 await e.L.submitArchive({accountId:e.account,ids:['file:'+fid(1)],tabId:1});
 let again=await e.drainLib();assert.equal(again.report.results[0].status,'already_archived');
 assert.equal(e.libCalls.filter(x=>x.type==='CAE_ASSET_START').length,calls);
 // Edit bytes without changing length or mtime; hash verification must still detect it.
 const loc=await e.box.ChatArchiveVault.lookupFile(e.root,text.local_path),mtime=loc.handle.mtime;
 loc.handle.bytes=new TextEncoder().encode('xyz');loc.handle.mtime=mtime;
 await e.L.submitArchive({accountId:e.account,ids:['file:'+fid(1)],tabId:1});
 again=await e.drainLib();assert.equal(again.report.results[0].status,'conflict');assert.equal(await e.read(text.local_path),'xyz');
 assert.equal(e.libCalls.filter(x=>x.type==='CAE_ASSET_START').length,calls);
 assert(!JSON.stringify(again).includes('download_url'));
 console.log('PASS: selected-only originals, unsaved Project Source remains selectable, correct groups, 415 isolated/no retry, disk SHA-256, dedup, same-size/same-mtime local edits protected');
})().catch(e=>{console.error(e);process.exitCode=1;});
