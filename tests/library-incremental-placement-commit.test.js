'use strict';
const assert=require('node:assert/strict');
const {createLibraryEnvironment,fid}=require('./library-job-fixtures');
(async()=>{
 const e=createLibraryEnvironment();e.rootRows=[e.node(1,'Existing.md')];
 await e.start(true);let r=await e.drainLib();assert.equal(r.job.status,'complete');
 const path=e.prefix+'/_Library/_inventory.json';
 const baseline=JSON.parse(await e.read(path));
 assert.equal(baseline.catalog.items.length,1);
 assert.equal(baseline.catalog.project_references.length,0);
 e.projectRefs=[{...e.ref(99),name:'Extra source.md',conversation_id:'6af9c044-9788-83ea-964a-8ba29a2e145c',message_id:'m-456'}];
 e.advance(6*60_000);e.reload();r=await e.drainLib();
 assert.equal(r.job.status,'complete');
 assert.equal(r.catalog.incremental.added,0,'no newly created Library file');
 assert.equal(r.catalog.summary.project_source_only,1);
 const saved=JSON.parse(await e.read(path));
 assert.equal(saved.catalog.project_references.length,1,'new Project Source link must persist to Vault');
 assert.equal(saved.catalog.items.length,2);
 assert.equal(saved.catalog.message_references.length,1);
 assert.equal(saved.catalog.message_references[0].message_role,'unknown');
 assert.equal(saved.baseline_at,baseline.baseline_at,'incremental linkage must not reset baseline');
 const unchanged=await e.read(path);
 e.advance(6*60_000);e.reload();r=await e.drainLib();
 assert.equal(r.job.status,'complete');
 assert.equal(await e.read(path),unchanged,'unchanged links should not write another snapshot');
 // A previously Source-only file is now present in Library with an older
 // creation time; a promotion is still necessary and must reach disk.
 e.rootRows.push(e.node(99,'Existing source.md'));
 e.advance(6*60_000);e.reload();r=await e.drainLib();
 assert.equal(r.job.status,'complete');
 assert.equal(r.catalog.incremental.promoted_from_source_only,1);
 const promoted=JSON.parse(await e.read(path));
 assert.equal(promoted.catalog.items.filter(x=>x.file_id===fid(99)).length,1);
 assert.equal(promoted.catalog.items.find(x=>x.file_id===fid(99)).source_only,undefined);
 assert.equal(promoted.catalog.summary.project_source_only,0);
 assert.equal(promoted.catalog.message_references.length,1);
 console.log('PASS: incremental Source-only references and messages are durably committed; unchanged polls do not rewrite; old Library promotion removes duplicate');
})().catch(e=>{console.error(e);process.exitCode=1;});
