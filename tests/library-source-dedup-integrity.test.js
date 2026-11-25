'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createLibraryEnvironment,fid,pid}=require('./library-job-fixtures');
(async()=>{
 const e=createLibraryEnvironment();
 e.rootRows=[e.node(1,'report.md'),e.node(2,'shared-source.txt')];
 e.projectRefs=[e.ref(2),e.ref(99),{...e.ref(98),project_id:'g-p-22222222222222222222222222222222',source_record_id:'another_99',file_id:fid(99)}];
 e.detailMap[fid(1)]={use_case:'my_files',size:3};
 e.blobs.set(fid(2),new TextEncoder().encode('src'));
 await e.start(false);let r=await e.drainLib();
 assert.equal(r.job.status,'complete');
 assert.equal(r.catalog.summary.total,3,'Library 2 + one source-only id + no double count across Projects');
 assert.equal(r.catalog.summary.project_source_only,1);
 const sourceOnly=r.catalog.items.find(x=>x.source_only);
 assert.equal(sourceOnly.file_id,fid(99));
 assert.equal(sourceOnly.placements.filter(x=>x.type==='project_source').length,2);
 assert.equal(sourceOnly.archive_eligibility.selectable,false);
 const shared=r.catalog.items.find(x=>x.file_id===fid(2));
 assert.equal(shared.managed_by_project_sources,true);
 assert.equal(shared.source_copy_verified,false);
 assert.equal(shared.archive_eligibility.selectable,true,'membership alone never excludes Library original');
 // Add a *completed* Project Source copy in the same Vault, verified by bytes.
 const bytes=new TextEncoder().encode('src'),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 const v=await e.box.ChatArchiveVault.openStore(e.root);await v.useWorkspace(e.prefix,e.account);
 const job={key:pid+':'+fid(2),projectId:pid,fileId:fid(2),name:'shared-source.txt',
   expectedBytes:bytes.length,path:e.prefix+'/Project test/Sources/shared-source.txt',sourceIdentity:'test-library-source'};
 const decision=await v.decideSource(job,e.account),target=await v.beginSource(decision);
 await target.stream.write(bytes);await target.stream.close();await v.completeSource(job,decision,target,sha,bytes.length);
 await e.start(false);r=await e.drainLib();
 let saved=r.catalog.items.find(x=>x.file_id===fid(2));
 assert.equal(saved.source_copy_verified,true);
 assert.equal(saved.archive_eligibility.selectable,false);
 assert.equal(r.catalog.summary.project_source_excluded,1);
 await assert.rejects(e.L.submitArchive({accountId:e.account,ids:[saved.id],tabId:1}),/eligible original|Project Source/i);
 // Same size and mtime local modification is NOT a verified archived copy.
 const loc=await e.box.ChatArchiveVault.lookupFile(e.root,decision.path),mtime=loc.handle.mtime;
 loc.handle.bytes=new TextEncoder().encode('bad');loc.handle.mtime=mtime;
 await e.start(false);r=await e.drainLib();
 saved=r.catalog.items.find(x=>x.file_id===fid(2));
 assert.equal(saved.source_copy_verified,false);
 assert.equal(saved.archive_eligibility.selectable,true);
 // Corrupt copies must never be overwritten by a duplicate Library download.
 await e.L.submitArchive({accountId:e.account,ids:[saved.id],tabId:1});r=await e.drainLib();
 assert.equal(r.report.results[0].status,'conflict');
 assert(!e.libCalls.some(x=>x.type==='CAE_ASSET_START'&&x.fileId===fid(2)));
 // Missing Source copy means Library original may be restored once to a new tracked path.
 await loc.dir.removeEntry(loc.filename);await e.start(false);r=await e.drainLib();
 await e.L.submitArchive({accountId:e.account,ids:[saved.id],tabId:1});r=await e.drainLib();
 assert.equal(r.report.results[0].status,'saved');
 assert.equal((await e.read(r.report.results[0].local_path)),'src');
 console.log('PASS: verified on-disk Source SHA dedup; unarchived, corrupt and missing Sources never falsely exclude Library; conflict safety; standalone Source refs');
})().catch(e=>{console.error(e);process.exitCode=1;});
