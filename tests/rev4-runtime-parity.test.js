'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),base=require('./fixtures/v0.2.0-rev3-hotfix2-runtime.json');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const changed=Object.keys(base.runtime_sha256).filter(p=>sha(p)!==base.runtime_sha256[p]);
function scan(dir=''){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(x=>{const p=dir?dir+'/'+x.name:x.name;return x.isDirectory()?(/^(tests|tools|\.git|\.github)$/.test(p)?[]:scan(p)):/\.(js|html|css|json|png|svg)$/.test(p)?[p]:[];});}
assert.deepEqual(changed.sort(),base.reviewed_modified.slice().sort());
assert.deepEqual(scan().filter(p=>!base.runtime_sha256[p]).sort(),base.reviewed_added.slice().sort());
console.log('PASS: exact rev.3 hotfix 2 runtime baseline; reviewed rev.4 deltas only');
