'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=require('./frozen-core.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Explicitly approved exception: browser Save dialog cancellation semantics.
const exception='lib/manual-jobs.js';
for(const [file,sha] of Object.entries(baseline.archive_core)){
  const actual=hash(fs.readFileSync(path.join(root,file)));
  if(file===exception)assert.notEqual(actual,sha,'Cancellation maintenance patch is missing');
  else assert.equal(actual,sha,'Frozen core changed: '+file);
}
const worker=fs.readFileSync(path.join(root,'worker.js'));
assert.equal(hash(worker.subarray(0,baseline.worker_prefix_bytes)),baseline.worker_prefix_sha256);
assert.equal(worker.subarray(baseline.worker_prefix_bytes).toString(),"\n// v0.1.7: UI-only observer/routing; archive engines remain unchanged.\nimportScripts('ui/state.js','ui/chat-list-cache.js','ui/worker-ui.js');\n");
const m=require('../manifest.json');assert.deepEqual(m.permissions,baseline.permissions);assert.deepEqual(m.host_permissions,baseline.host_permissions);assert.equal(m.minimum_chrome_version,'116');
console.log('PASS: core frozen except one approved manual delivery maintenance patch; original worker intact; no permission expansion');
