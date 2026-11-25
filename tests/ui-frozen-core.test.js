'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=require('./frozen-core.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Explicit v0.1.8 integrity + v0.1.9 selective-export changes. Unrelated
// archival modules and permission scope still match the original baseline.
const approvedChanges=new Set(['lib/manual-jobs.js','lib/library-inventory.js','lib/library-jobs.js',
 'lib/library-policy.js','lib/library-vault.js','lib/paths.js','lib/sync.js',
 'lib/vault-transfer.js','lib/vault.js','lib/normalize.js','lib/manual-output.js',
 'lib/api.js','content.js','lib/tab-bootstrap.js']);
for(const [file,sha] of Object.entries(baseline.archive_core)){
  const actual=hash(fs.readFileSync(path.join(root,file)));
  if(approvedChanges.has(file))assert.notEqual(actual,sha,'Expected approved technical delta: '+file);
  else assert.equal(actual,sha,'Unexpected technical change outside v0.1.8/v0.1.9 scope: '+file);
}
let legacy=fs.readFileSync(path.join(root,'worker.js'),'utf8')
 .replace("'lib/export-selection.js','lib/export-preferences.js',",'')
 .replace("'lib/manual-attachments.js',",'');
const begin=legacy.indexOf("  if(message?.type?.startsWith('CAE_EXPORT_PREFS_')){"),
 end=legacy.indexOf("  if (message?.type?.startsWith('CAE_LIBRARY_JOB_'))",begin);
assert(begin>0&&end>begin,'Worker contains the reviewed preferences route');
legacy=legacy.slice(0,begin)+legacy.slice(end);
const worker=Buffer.from(legacy);
assert.equal(hash(worker.subarray(0,baseline.worker_prefix_bytes)),baseline.worker_prefix_sha256);
assert.equal(worker.subarray(baseline.worker_prefix_bytes).toString(),"\n// v0.1.7: UI-only observer/routing; archive engines remain unchanged.\nimportScripts('ui/state.js','ui/chat-list-cache.js','ui/worker-ui.js');\n");
const m=require('../manifest.json');assert.deepEqual(m.permissions,baseline.permissions);assert.deepEqual(m.host_permissions,baseline.host_permissions);assert.equal(m.minimum_chrome_version,'116');
console.log('PASS: explicit integrity/selection delta allowlist, unrelated core and worker routes unchanged, no permission expansion');
