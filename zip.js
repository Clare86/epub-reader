// Minimal read-only ZIP reader for EPUBs. Uses the browser's built-in
// DecompressionStream, so there are no third-party dependencies.
'use strict';

class ZipArchive {
  static async open(blob) {
    const zip = new ZipArchive(blob);
    await zip._readDirectory();
    return zip;
  }

  constructor(blob) {
    this.blob = blob;
    this.entries = new Map(); // path -> {method, compSize, size, offset}
  }

  async _readDirectory() {
    // The end-of-central-directory record sits in the last 22..65557 bytes.
    const tailLen = Math.min(this.blob.size, 65557);
    const tail = new DataView(await this.blob.slice(this.blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP/EPUB file (no central directory found).');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOffset = tail.getUint32(eocd + 16, true);

    const cd = new DataView(await this.blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const utf8 = new TextDecoder('utf-8');
    const latin1 = new TextDecoder('latin1');
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const flags = cd.getUint16(p + 8, true);
      const method = cd.getUint16(p + 10, true);
      const compSize = cd.getUint32(p + 20, true);
      const size = cd.getUint32(p + 24, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      const offset = cd.getUint32(p + 42, true);
      const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
      const name = (flags & 0x800 ? utf8 : latin1).decode(nameBytes);
      this.entries.set(name, { method, compSize, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(path) { return this.entries.has(path); }

  async _raw(path) {
    const e = this.entries.get(path);
    if (!e) throw new Error('Missing file in EPUB: ' + path);
    const lh = new DataView(await this.blob.slice(e.offset, e.offset + 30).arrayBuffer());
    const start = e.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const data = this.blob.slice(start, start + e.compSize);
    if (e.method === 0) return data;
    if (e.method === 8) {
      const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).blob();
    }
    throw new Error('Unsupported ZIP compression method ' + e.method + ' for ' + path);
  }

  async blobOf(path, type) {
    const b = await this._raw(path);
    return type ? new Blob([b], { type }) : b;
  }

  async text(path) {
    return await (await this._raw(path)).text();
  }
}
