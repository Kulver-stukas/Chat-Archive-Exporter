const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../lib/normalize');
const P=require('../lib/paths');
const S=require('../lib/sources');
const Z=require('../lib/zip');
const M=require('../lib/meta');
(async()=>{
 const used=new Set();
 assert.equal(P.sourceFilename('report.PDF','id','text/plain',used),'report.PDF');
 assert.equal(P.sourceFilename('REPORT.pdf','other','application/pdf',used),'REPORT [other].pdf');
 assert.equal(P.sourceFilename('noextension','id','application/pdf'), 'noextension.pdf');
 assert.equal(P.sourceFilename('noextension','id','application/unknown'), 'noextension');
 assert(P.sourceFilename('CON.txt','id','text/plain').startsWith('_CON'));
 assert(!P.sourceFilename('../bad/name.txt','id').includes('/'));
 assert(P.sourceFilename('a'.repeat(300)+'.docx','id').endsWith('.docx'));
 const layout=P.createLayout('Work',[{id:'g-p-a',name:'Same'},{id:'g-p-b',name:'same'}]);
 assert.notEqual(layout.folder('g-p-a'),layout.folder('g-p-b'));
 const bytes=Uint8Array.from([0,255,128,239,187,191,13,10,65]);
 const raw={gizmo:{id:'g-p-a',display:{name:'Same'},instructions:''},files:[
  {file_id:'file_one',name:'A.bin',size:bytes.length,type:'application/octet-stream'},
  {file_id:'file_two',name:'Space.txt',size:null,type:'text/plain',metadata:{knowledge_store_info:{source_kind:'library_file'}}},
  {file_id:'file_big',name:'big.zip',size:30*1024*1024},
  {name:'missing-id.txt'}
 ],connectors:[{scope_id:'scope',connector_type:'google_drive',connector_files:[{info:{id:'file_one',name:'Alias.bin',size:bytes.length}}]}]};
 const jobs=S.plan([M.normalizeProject(raw)],layout);
 assert.equal(jobs.length,4,'dedupe same file within a project');
 let starts=0,reads=0,closes=0;
 const transport={start:async()=>{starts++;reads=0;return{contentType:'application/octet-stream'};},read:async()=>++reads===1?{done:false,base64:Buffer.from(bytes).toString('base64'),byteLength:bytes.length}:{done:true,totalBytes:bytes.length},close:async()=>{closes++;}};
 const writer=Z.createWriter();
 const report=await S.run(jobs,{transport,sink:writer,pause:async()=>{}});
 assert.equal(report.counts.saved,2);assert.equal(report.counts.skipped,2);assert.equal(starts,2);assert.equal(closes,2);
 assert.equal(report.results[0].size_matches,true);assert.equal(report.results[1].size_matches,null);
 assert.match(report.results[0].sha256,/^[a-f0-9]{64}$/);
 const meta=M.entries({captured_at:'2026-11-09',projects:[raw],projects_complete:true,personalization_requested:false,source_downloads:report},'Work',{layout});
 assert(meta.find(f=>f.path.endsWith('_sources.md')).content.includes('"download_status": "saved"'));
 for(const entry of meta)await writer.add(entry);
 const zip=writer.finish();fs.writeFileSync('/tmp/cae-v014-binary-test.zip',Buffer.from(await zip.arrayBuffer()));
 const cancelled=await S.run(jobs,{transport,sink:Z.createWriter(),cancelled:()=>true,pause:async()=>{}});
 assert.equal(cancelled.counts.cancelled,4);
 const rate=await S.run(jobs,{transport:{...transport,start:async()=>{const e=Error('Rate limited');e.httpStatus=429;throw e;}},sink:Z.createWriter(),pause:async()=>{}});
 assert.equal(rate.counts.failed,1);assert.equal(rate.counts.skipped,3);
 const zero=await S.run([{...jobs[0],expectedBytes:0}],{transport:{start:async()=>({}),read:async()=>({done:true,totalBytes:0}),close:async()=>{}},sink:Z.createWriter(),pause:async()=>{}});
 assert.equal(zero.counts.saved,1);assert.equal(zero.results[0].size_matches,true);
 const mismatch=await S.run([{...jobs[0],expectedBytes:1}],{transport,sink:Z.createWriter(),pause:async()=>{}});
 assert.equal(mismatch.counts.saved,1);assert.equal(mismatch.results[0].size_matches,false);assert(mismatch.results[0].warning);
 const budgetWriter=Z.createWriter({maxBytes:3});await assert.rejects(budgetWriter.add({path:'a.bin',bytes}),e=>e.code==='ZIP_LIMIT');
 console.log('PASS: binary preservation, original extensions, MIME-only fallback, name collisions, dedupe, unknown/zero sizes, budgets, rate-limit stop, reports');
})().catch(e=>{console.error(e);process.exitCode=1;});
