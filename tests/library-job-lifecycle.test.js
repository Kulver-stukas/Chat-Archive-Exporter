'use strict';
const assert=require('node:assert/strict');
const {createLibraryEnvironment,fid}=require('./library-job-fixtures');
(async()=>{
 const e=createLibraryEnvironment();
 e.rootRows=[e.node(1),{kind:'directory',id:'folder_sources',name:'Project test',parent_directory_id:'libdir_root'},e.node(3,'Generated.png',{mime_type:'image/png'})];
 e.folders.folder_sources=[e.node(2,'Source.txt',{parent_directory_id:'folder_sources'})];
 e.projectRefs=[e.ref(2),e.ref(99)];e.gallery=[e.image(3),e.image(4)];
 e.detailMap[fid(1)]={use_case:'my_files',mime_type:'text/plain',size:3,metadata:{source_ip:'PRIVATE',upload_source:'user'}};
 await e.start(true);
 let r=await e.drainLib();
 assert.equal(r.job.status,'complete');assert.equal(r.enabled,true);assert.equal(r.catalog.summary.total,5);
 assert.equal(r.catalog.summary.project_source_excluded,0);
 assert.equal(r.catalog.summary.project_source_linked,2);
 assert.equal(r.catalog.summary.project_source_only,1);
 assert.equal(r.catalog.collections.descriptors.attempted,1);
 assert.deepEqual(e.libCalls.filter(x=>x.query?.kind==='details').flatMap(x=>x.query.fileIds),[fid(1)]);
 const disk=JSON.parse(await e.read(e.prefix+'/_Library/_inventory.json'));
 assert.equal(disk.baseline_at,r.baseline_at);assert.equal(disk.catalog.items.length,5);
 assert.equal(disk.catalog.project_references.length,2);
 assert(!JSON.stringify(disk).includes('PRIVATE'));
 const before=e.libCalls.length;await e.L.startup();await e.L.tick();assert.equal(e.libCalls.length,before,'startup and idle tick must not re-scan');
 // Old entries, a later modification of an old entry, and undated new entries are not backfilled.
 e.advance(6*60_000);const now=new e.box.Date().toISOString();
 e.rootRows[0].updated_at=now;
 e.rootRows.push(e.node(5,'New.txt',{record_creation_time:now}),e.node(6,'Older-discovered.txt'),e.node(7,'Undated.txt',{record_creation_time:null}));
 e.detailMap[fid(5)]={use_case:'caas',size:3,mime_type:'text/plain'};
 e.projectRefs.push(e.ref(8));e.rootRows.push(e.node(8,'NewSource.txt',{record_creation_time:now}));
 e.reload();r=await e.drainLib();
 assert.equal(r.job.status,'complete');assert.equal(r.catalog.summary.total,7);
 const detailIds=e.libCalls.filter(x=>x.query?.kind==='details').flatMap(x=>x.query.fileIds);
 assert.deepEqual(detailIds,[fid(1),fid(5)],'only new non-Source files should get descriptors');
 assert.equal(r.catalog.incremental.older_not_enrolled,1);assert.equal(r.catalog.incremental.undated_not_enrolled,1);
 assert.equal(r.baseline_at,disk.baseline_at,'incremental writes cannot advance the baseline');
 assert(!e.libCalls.some(x=>x.type==='CAE_ASSET_START'),'metadata monitoring must not download originals');
 // Stop persists and does not restart on worker reload or elapsed timers.
 await e.L.stop(e.account);e.advance(1000*60*60);e.reload();const count=e.libCalls.length;await e.L.startup();await e.L.tick();
 assert.equal(e.libCalls.length,count);assert.equal((await e.L.inspect(e.account)).enabled,false);
 // No fixed 400-entry limit and no repeated unknown descriptors on a manual refresh.
 await e.start(false);r=await e.drainLib();assert.equal(r.job.status,'complete');
 assert.equal(e.libCalls.filter(x=>x.query?.kind==='details').flatMap(x=>x.query.fileIds).filter(x=>x===fid(1)).length,1);
 console.log('PASS: manual-only baseline, disk commit, Source exclusions, durable incremental new-only metadata, no polling after stop, no implicit original downloads');
})().catch(e=>{console.error(e);process.exitCode=1;});
