'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=require('./frozen-core.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Explicit v0.1.8 integrity, v0.1.9 selective export, and v0.2.0 rev.1 routing changes. Unrelated
// archival modules and permission scope still match the original baseline.
const approvedChanges=new Set(['lib/manual-jobs.js','lib/manual-store.js','lib/sync-policy.js','lib/library-inventory.js','lib/library-jobs.js',
 'lib/library-policy.js','lib/library-vault.js','lib/paths.js','lib/meta.js','lib/sync.js',
 'lib/vault-transfer.js','lib/vault.js','lib/normalize.js','lib/manual-output.js',
 'lib/api.js','lib/config-inventory.js','lib/source-transfer.js','content.js','lib/tab-bootstrap.js','sync-watch.js','lib/library-store.js','lib/vault-context.js','lib/vault-diagnostics.js','offscreen.js','offscreen.html']);
for(const [file,sha] of Object.entries(baseline.archive_core)){
  const actual=hash(fs.readFileSync(path.join(root,file)));
  if(approvedChanges.has(file))assert.notEqual(actual,sha,'Expected approved technical delta: '+file);
  else assert.equal(actual,sha,'Unexpected technical change outside v0.1.8/v0.1.9 scope: '+file);
}
// The merged worker intentionally changes authorization and startup; pin the reviewed implementation.
assert.equal(hash(fs.readFileSync(path.join(root,'worker.js'))),'6df823731e35394c00fd17cf5e637befb9881a998fa2406c0c809262226f428d');
const m=require('../manifest.json');assert.deepEqual(m.permissions,baseline.permissions);assert.deepEqual(m.host_permissions,baseline.host_permissions);assert.equal(m.minimum_chrome_version,'116');
console.log('PASS: explicit integrity/selection delta allowlist, unrelated core and worker routes unchanged, no permission expansion');
