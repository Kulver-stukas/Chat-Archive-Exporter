'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=require('./fixtures/v0.2.0-rev2-runtime.json');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const changed=[];for(const [p,h] of Object.entries(baseline.runtime_sha256)){if(sha(p)!==h)changed.push(p);}
assert.deepEqual(changed.sort(),[...new Set([...baseline.reviewed_modified,'lib/vault.js','lib/sync.js','lib/manual-jobs.js','lib/library-vault.js','lib/library-jobs.js','ui/worker-ui.js','lib/portable-preferences.js','panel.js','worker.js','panel.html','popup.html','options.html','manifest.json'])].sort());
function scan(p=''){return fs.readdirSync(path.join(root,p),{withFileTypes:true}).flatMap(x=>{const n=p?p+'/'+x.name:x.name;if(x.isDirectory())return /^(tests|tools|\.git)$/.test(n)?[]:scan(n);return /\.(js|html|css|json|png|svg)$/.test(n)?[n]:[];});}
assert.deepEqual(scan().filter(p=>!baseline.runtime_sha256[p]).sort(),[...baseline.reviewed_added,'lib/workspace-activity.js'].sort());
assert.equal(sha('tests/fixtures/v0.1.9-beta.2-parity.json'),baseline.beta2_parity_sha256);
assert.equal(sha('tests/fixtures/v0.1.9-beta.2-runtime.json'),baseline.beta2_runtime_sha256);
console.log('PASS: exact rev.2 runtime baseline, only reviewed extraction/entrypoint changes and additions, original Beta 2 fixtures unchanged');
