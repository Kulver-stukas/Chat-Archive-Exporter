/* Streaming SHA-256 for source checksums without materializing whole files.
 * No dependencies, no source content is decoded as text. */
(function (root) {
  'use strict';
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const initial = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rr = (n, b) => (n >>> b) | (n << (32 - b));
  class Sha256 {
    constructor() {
      this.h = new Uint32Array(initial);
      this.block = new Uint8Array(64);
      this.words = new Uint32Array(64);
      this.used = 0;
      this.length = 0;
      this.finished = false;
    }
    process() {
      const w = this.words, b = this.block;
      for (let i = 0; i < 16; i++) {
        const j = i * 4;
        w[i] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = rr(x, 7) ^ rr(x, 18) ^ (x >>> 3);
        const s1 = rr(y, 17) ^ rr(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b0, c, d, e, f, g, h] = this.h;
      for (let i = 0; i < 64; i++) {
        const s1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
        const s0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const maj = (a & b0) ^ (a & c) ^ (b0 & c);
        const t2 = (s0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b0; b0 = a; a = (t1 + t2) >>> 0;
      }
      const state = [a, b0, c, d, e, f, g, h];
      for (let i = 0; i < 8; i++) this.h[i] = (this.h[i] + state[i]) >>> 0;
    }
    update(input) {
      if (this.finished) throw new Error('SHA-256 digest already finalized.');
      if (!(input instanceof Uint8Array)) throw new TypeError('SHA-256 input must be Uint8Array.');
      this.length += input.byteLength;
      if (!Number.isSafeInteger(this.length)) throw new Error('SHA-256 input too large.');
      let offset = 0;
      while (offset < input.byteLength) {
        const count = Math.min(64 - this.used, input.byteLength - offset);
        this.block.set(input.subarray(offset, offset + count), this.used);
        this.used += count; offset += count;
        if (this.used === 64) { this.process(); this.used = 0; }
      }
      return this;
    }
    digest() {
      if (this.finished) throw new Error('SHA-256 digest already finalized.');
      const bitsHigh = Math.floor(this.length / 0x20000000) >>> 0;
      const bitsLow = (this.length * 8) >>> 0;
      this.block[this.used++] = 0x80;
      if (this.used > 56) { this.block.fill(0, this.used); this.process(); this.used = 0; }
      this.block.fill(0, this.used, 56);
      const view = new DataView(this.block.buffer);
      view.setUint32(56, bitsHigh, false);
      view.setUint32(60, bitsLow, false);
      this.process(); this.finished = true;
      const result = new Uint8Array(32), out = new DataView(result.buffer);
      for (let i = 0; i < 8; i++) out.setUint32(i * 4, this.h[i], false);
      this.block.fill(0); this.words.fill(0);
      return result;
    }
    hex() { return [...this.digest()].map(n => n.toString(16).padStart(2, '0')).join(''); }
  }
  const hex = bytes => new Sha256().update(bytes).hex();
  const api = { Sha256, hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveHash = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
