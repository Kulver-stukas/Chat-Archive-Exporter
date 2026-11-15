const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Sha256} = require('../lib/hash');
for (const len of [0,1,3,55,56,63,64,65,127,128,1024,257000,1_000_003]) {
 const payload = crypto.randomBytes(len);
 const expected = crypto.createHash('sha256').update(payload).digest('hex');
 for (const chunkSize of [1,17,64,16384,256*1024]) {
  const h = new Sha256();
  for (let i = 0; i < len; i += chunkSize) h.update(new Uint8Array(payload.subarray(i,i+chunkSize)));
  assert.equal(h.hex(),expected,`SHA256 ${len} bytes / chunk ${chunkSize}`);
  assert.throws(()=>h.update(new Uint8Array([1])));
 }
}
console.log('PASS: incremental SHA-256 equals Node crypto across unaligned and boundary lengths');
