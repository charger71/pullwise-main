// A minimal .zip writer for the Media backup: files are stored as they are (pictures are already compressed), so
// there is no compression code. Parts go into a Blob as they are added, so a big library isn't held twice in memory.

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const DOS_DATE = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

export class ZipBuilder {
  constructor(now = new Date()) {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.time = DOS_TIME(now);
    this.date = DOS_DATE(now);
  }

  /** Adds one file: `name` with "/" for folders, `bytes` a Uint8Array. */
  add(name, bytes) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(bytes);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint16(8, 0, true); // stored
    head.setUint16(10, this.time, true);
    head.setUint16(12, this.date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, bytes.length, true);
    head.setUint32(22, bytes.length, true);
    head.setUint16(26, nameBytes.length, true);
    this.parts.push(head.buffer, nameBytes, bytes);
    this.central.push({ nameBytes, crc, size: bytes.length, offset: this.offset });
    this.offset += 30 + nameBytes.length + bytes.length;
  }

  finish() {
    const start = this.offset;
    let size = 0;
    for (const f of this.central) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, this.time, true);
      h.setUint16(14, this.date, true);
      h.setUint32(16, f.crc, true);
      h.setUint32(20, f.size, true);
      h.setUint32(24, f.size, true);
      h.setUint16(28, f.nameBytes.length, true);
      h.setUint32(42, f.offset, true);
      this.parts.push(h.buffer, f.nameBytes);
      size += 46 + f.nameBytes.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.central.length, true);
    end.setUint16(10, this.central.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, start, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

/**
 * Reads a .zip (a File/Blob) without loading it all: [{ name, size, read() }], where read() gives the file's bytes.
 * Handles stored and deflated entries (our own backups are stored; a zip re-made by Finder or Explorer is deflated).
 * Not zip64: a part is far smaller than 4 GB.
 */
export async function readZip(blob) {
  const tailSize = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let end = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('That isn’t a .zip file.');
  const count = tail.getUint16(end + 10, true);
  const cdSize = tail.getUint32(end + 12, true);
  const cdStart = tail.getUint32(end + 16, true);
  if (count === 0xffff || cdStart === 0xffffffff) throw new Error('That .zip is too large to read (zip64).');
  const cd = new DataView(await blob.slice(cdStart, cdStart + cdSize).arrayBuffer());
  const entries = [];
  for (let p = 0, n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('That .zip is damaged.');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const compressed = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const offset = cd.getUint32(p + 42, true);
    const name = new TextDecoder(flags & 0x0800 ? 'utf-8' : 'latin1').decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    entries.push({
      name,
      size,
      async read() {
        const lh = new DataView(await blob.slice(offset, offset + 30).arrayBuffer());
        const start = offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = blob.slice(start, start + compressed);
        if (method === 0) return new Uint8Array(await raw.arrayBuffer());
        if (method !== 8) throw new Error(`${name}: unsupported zip compression.`);
        return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      },
    });
  }
  return entries;
}
