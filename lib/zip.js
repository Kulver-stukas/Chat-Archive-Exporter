/* Bounded, incremental ZIP builder. Source bytes are stored verbatim (no re-encoding).
 * The resulting archive is still a Blob, not a streaming-to-disk Vault writer. */
(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  const TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let x = i;
    for (let k = 0; k < 8; k++) x = x & 1 ? (0xedb88320 ^ (x >>> 1)) : x >>> 1;
    TABLE[i] = x >>> 0;
  }
  function crc32(bytes) {
    let result = 0xffffffff;
    for (const b of bytes) result = TABLE[(result ^ b) & 0xff] ^ (result >>> 8);
    return (result ^ 0xffffffff) >>> 0;
  }
  async function crc32Cooperative(bytes) {
    let result = 0xffffffff;
    for (let start = 0; start < bytes.length; start += 1024 * 1024) {
      const end = Math.min(start + 1024 * 1024, bytes.length);
      for (let i = start; i < end; i++) result = TABLE[(result ^ bytes[i]) & 0xff] ^ (result >>> 8);
      if (end < bytes.length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return (result ^ 0xffffffff) >>> 0;
  }
  const u16 = (v, offset, n) => v.setUint16(offset, n, true);
  const u32 = (v, offset, n) => v.setUint32(offset, n >>> 0, true);
  const header = size => new DataView(new ArrayBuffer(size));
  function dosTimeDate(date) {
    return [((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
      (((Math.max(1980, Math.min(2107, date.getFullYear())) - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)];
  }
  async function compress(bytes) {
    if (typeof CompressionStream !== 'function') return { method: 0, data: bytes };
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const packed = new Uint8Array(await new Response(stream).arrayBuffer());
      return packed.length < bytes.length ? { method: 8, data: packed } : { method: 0, data: bytes };
    } catch (_err) { return { method: 0, data: bytes }; }
  }
  async function bytesOf(value) {
    if (typeof value === 'string') return encoder.encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (value == null) return new Uint8Array();
    throw new TypeError('ZIP entry must be text, bytes, or a Blob.');
  }
  function createWriter({ maxBytes = 128 * 1024 * 1024 } = {}) {
    const local = [], central = [], names = new Set();
    let offset = 0, totalBytes = 0, finished = false;
    const [time, date] = dosTimeDate(new Date());
    return {
      get totalBytes() { return totalBytes; },
      get count() { return names.size; },
      get remainingBytes() { return Math.max(0, maxBytes - totalBytes); },
      async add(file) {
        if (finished) throw new Error('ZIP builder is closed.');
        const path = String(file.path);
        if (!path || /^(?:\/|[a-z]:)/i.test(path) || /[\\\x00-\x1f]/.test(path) || path.split('/').some(x => !x || x === '.' || x === '..'))
          throw new Error('Unsafe ZIP path.');
        if (names.has(path.toLocaleLowerCase('en-US'))) throw new Error('Duplicate ZIP path: ' + path);
        if (names.size >= 65535) throw new Error('ZIP contains too many files.');
        const name = encoder.encode(path);
        const source = await bytesOf(file.bytes ?? file.content);
        if (name.length > 65535 || source.byteLength > 0xffffffff) throw new Error('ZIP entry is too large.');
        if (source.byteLength + totalBytes > maxBytes) {
          const error = new Error('Test ZIP byte budget exceeded. Select fewer chats or a smaller project.');
          error.code = 'ZIP_LIMIT'; throw error;
        }
        const packed = file.store || file.bytes != null ? { method: 0, data: source } : await compress(source);
        const crc = await crc32Cooperative(source);
        const l = header(30);
        u32(l, 0, 0x04034b50); u16(l, 4, 20); u16(l, 6, 0x0800); u16(l, 8, packed.method);
        u16(l, 10, time); u16(l, 12, date); u32(l, 14, crc);
        u32(l, 18, packed.data.length); u32(l, 22, source.length); u16(l, 26, name.length); u16(l, 28, 0);
        const c = header(46);
        u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x0800); u16(c, 10, packed.method);
        u16(c, 12, time); u16(c, 14, date); u32(c, 16, crc); u32(c, 20, packed.data.length); u32(c, 24, source.length);
        u16(c, 28, name.length); u16(c, 30, 0); u16(c, 32, 0); u16(c, 34, 0); u16(c, 36, 0); u32(c, 38, 0); u32(c, 42, offset);
        if (offset + 30 + name.length + packed.data.length > 0xffffffff) throw new Error('ZIP exceeds the ZIP32 limit.');
        // Copy each finished entry into a Blob, releasing its input ArrayBuffer
        // before the next source is read. The final Blob joins these immutable parts.
        local.push(new Blob([l.buffer, name, packed.data]));
        central.push(c.buffer, name);
        offset += 30 + name.length + packed.data.length;
        totalBytes += source.byteLength;
        names.add(path.toLocaleLowerCase('en-US'));
      },
      finish() {
        if (finished) throw new Error('ZIP builder is closed.');
        const centralBytes = central.reduce((sum, part) => sum + part.byteLength, 0);
        const end = header(22);
        u32(end, 0, 0x06054b50); u16(end, 4, 0); u16(end, 6, 0); u16(end, 8, names.size); u16(end, 10, names.size);
        u32(end, 12, centralBytes); u32(end, 16, offset); u16(end, 20, 0);
        const blob = new Blob([...local, ...central, end.buffer], { type: 'application/zip' });
        finished = true; local.length = 0; central.length = 0;
        return blob;
      },
      dispose() { finished = true; local.length = 0; central.length = 0; names.clear(); }
    };
  }
  async function makeZip(files, options) {
    if (!Array.isArray(files)) throw new TypeError('ZIP entries must be an array.');
    const writer = createWriter(options);
    try { for (const file of files) await writer.add(file); return writer.finish(); }
    finally { writer.dispose(); }
  }
  const api = { crc32, makeZip, createWriter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveZip = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
