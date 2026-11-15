const assert = require('node:assert/strict');
const fs = require('node:fs');
const {crc32, makeZip} = require('../lib/zip');
(async()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
 const zip = await makeZip([
   {path:'ChatGPT/Work/Project/Math.md', content:'Hello, $x^2$!'},
   {path:'ChatGPT/Work/_Unassigned/Разговор.md', content:'Привет, мир!'}
 ]);
 assert(zip.size > 100);
 fs.writeFileSync('/tmp/chat-archive-zip-test.zip', Buffer.from(await zip.arrayBuffer()));
 console.log('PASS: ZIP encoding and CRC32');
})().catch(e=>{console.error(e);process.exitCode=1});
