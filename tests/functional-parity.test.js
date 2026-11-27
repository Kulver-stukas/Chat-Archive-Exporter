/* Compare actual export and inventory outputs against the fixed Beta 2 fixture.
 * Never regenerate the expected result to hide a difference. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v0.1.9-beta.2-parity.json'),'utf8'));
const actual=JSON.parse(cp.execFileSync(process.execPath,[path.join(__dirname,'parity-capture.js'),path.resolve(__dirname,'..')],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}));
// The fake filesystem advances an integer clock on each file creation. Two
// writer claims are created and their JSON is committed before metadata files are created.
// Allow precisely that observed test-clock delta, not arbitrary index changes.
const indexPath='ChatGPT/.chat-archive/index.json';
const oldIndex=JSON.parse(Buffer.from(expected.vault[indexPath],'base64'));
const newIndex=JSON.parse(Buffer.from(actual.vault[indexPath],'base64'));
const keys=Object.keys(oldIndex.metadata);assert.equal(keys.length,2);
for(const key of keys){
 assert.equal(newIndex.metadata[key].local_last_modified,oldIndex.metadata[key].local_last_modified+4,'Expected claim-creation and JSON commit clock offset: '+key);
 newIndex.metadata[key].local_last_modified=oldIndex.metadata[key].local_last_modified;
}
actual.vault[indexPath]=Buffer.from(JSON.stringify(newIndex,null,2)+'\n').toString('base64');
assert.deepEqual(actual,expected,'Functional parity with v0.1.9 Beta 2 changed');
console.log('PASS: original Beta 2 snapshot; Markdown, ZIP contents, Vault bytes/indexes and Library placements identical except two explicitly checked synthetic mtime offsets');
