'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=require('./frozen-core.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Explicit v0.1.8 integrity + v0.1.9 selective-export changes. Unrelated
// archival modules and permission scope still match the original baseline.
const approvedChanges=new Set(['lib/manual-jobs.js','lib/library-inventory.js','lib/library-jobs.js',
 'lib/library-policy.js','lib/library-vault.js','lib/paths.js','lib/sync.js',
 'lib/vault-transfer.js','lib/vault.js','lib/normalize.js','lib/manual-output.js',
 'lib/api.js','content.js','lib/tab-bootstrap.js','lib/library-store.js','lib/vault-context.js','lib/vault-diagnostics.js','offscreen.js']);
for(const [file,sha] of Object.entries(baseline.archive_core)){
  const actual=hash(fs.readFileSync(path.join(root,file)));
  if(approvedChanges.has(file))assert.notEqual(actual,sha,'Expected approved technical delta: '+file);
  else assert.equal(actual,sha,'Unexpected technical change outside v0.1.8/v0.1.9 scope: '+file);
}
// rev.6 deliberately changes message authorization and startup handling. Freeze
// this reviewed worker while retaining the prior core/permission baseline.
assert.equal(hash(fs.readFileSync(path.join(root,'worker.js'))),'a12f57f1642cc04b79f16625c6fe7bbc5651843c307800aabb97ca81932a9c75');
const m=require('../manifest.json');assert.deepEqual(m.permissions,baseline.permissions);assert.deepEqual(m.host_permissions,baseline.host_permissions);assert.equal(m.minimum_chrome_version,'116');
console.log('PASS: explicit integrity/selection delta allowlist, unrelated core unchanged and reviewed rev.8 worker, no permission expansion');
