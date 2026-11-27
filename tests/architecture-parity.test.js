'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),baseline=require('./fixtures/v0.1.9-beta.2-runtime.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const reviewedRepairDeltas=['lib/library-store.js','lib/library-vault.js','lib/paths.js','lib/vault-context.js','lib/vault-diagnostics.js','lib/vault.js','offscreen.js','styles.css','ui/widget.js'];
const rev3Deltas=['lib/normalize.js','lib/config-inventory.js','lib/library-inventory.js','lib/source-transfer.js','offscreen.html'];
const expectedDeltas=[...new Set([...baseline.rev1_expected_deltas,...reviewedRepairDeltas,...rev3Deltas])];
const changed=[];
for(const [name,sha]of Object.entries(baseline.runtime_sha256)){
 const actual=hash(fs.readFileSync(path.join(base,name)));
 if(actual!==sha)changed.push(name);
 if(!expectedDeltas.includes(name))assert.equal(actual,sha,'Unreviewed runtime delta: '+name);
}
assert.deepEqual(changed.sort(),expectedDeltas.slice().sort());
const worker=fs.readFileSync(path.join(base,'worker.js'),'utf8');
assert(worker.startsWith("importScripts('contracts/provider.js','providers/chatgpt/descriptor.js','providers/registry.js');\n"),'provider composition must load before worker consumers');
const code=fs.readFileSync(path.join(base,'contracts/provider.js'),'utf8');
assert(!/chatgpt\.com|backend-api|chrome\.|document\.|indexedDB/.test(code),'generic contracts must not depend on Chrome or provider internals');
const m=require('../manifest.json'),boot=require('./provider-bootstrap').boot({window:{}});
const vm=require('node:vm');vm.runInContext(fs.readFileSync(path.join(base,'providers/chatgpt/api.js'),'utf8'),boot);
assert.deepEqual(Object.keys(boot.window.ChatArchiveApi).sort(),Array.from(boot.ChatArchiveProviders.legacy.operations).sort(),'legacy API must implement exactly the declared operations');
assert.equal(m.version,'0.2.0.5');
console.log(`PASS: ${Object.keys(baseline.runtime_sha256).length-changed.length} unchanged runtime/assets, ${changed.length} reviewed routing, entrypoint and rev.6-8 repair changes, pure contract layer and exact declared API`);
