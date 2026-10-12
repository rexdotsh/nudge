const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA = 0x0001;
const MAX32 = 0xffffffff;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class ZipError extends Error {}

interface Entry {
  name: string;
  method: number;
  size: number;
  local: number;
}

// Windows app packages are always ZIP64, so sizes and offsets may live in the ZIP64 records instead.
function directory(view: DataView, zip: Uint8Array): Entry[] {
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END) end--;
  if (end < 0) throw new ZipError('not a zip archive');
  let count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (end >= 20 && view.getUint32(end - 20, true) === END64_LOCATOR) {
    const end64 = Number(view.getBigUint64(end - 12, true));
    if (view.getUint32(end64, true) !== END64) throw new ZipError('corrupt zip64 end record');
    count = Number(view.getBigUint64(end64 + 32, true));
    at = Number(view.getBigUint64(end64 + 48, true));
  }
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || view.getUint32(at, true) !== CENTRAL) throw new ZipError('corrupt central directory');
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    let size = view.getUint32(at + 20, true);
    let local = view.getUint32(at + 42, true);
    const uncompressed = view.getUint32(at + 24, true);
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === ZIP64_EXTRA) {
        let field = extra + 4;
        if (uncompressed === MAX32) field += 8;
        if (size === MAX32) {
          size = Number(view.getBigUint64(field, true));
          field += 8;
        }
        if (local === MAX32) local = Number(view.getBigUint64(field, true));
      }
      extra += 4 + length;
    }
    entries.push({
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      size,
      local,
    });
    at = extraEnd + view.getUint16(at + 32, true);
  }
  return entries;
}

/** Reads one entry from a zip archive by a predicate on its name (stored or deflated, ZIP64 aware). */
export async function readEntry(zip: Uint8Array, matches: (name: string) => boolean): Promise<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entry = directory(view, zip).find(({ name }) => matches(name));
  if (!entry) throw new ZipError('entry not found');
  const { name, method, size, local } = entry;
  if (view.getUint32(local, true) !== LOCAL) throw new ZipError(`corrupt entry ${name}`);
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = zip.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return inflate(data);
  throw new ZipError(`unsupported compression in ${name}`);
}

/** Writes an uncompressed zip archive. */
export function writeZip(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data } of files) {
    const path = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + path.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, path.length, true);
    local.set(path, 30);
    const entry = new Uint8Array(46 + path.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, path.length, true);
    cv.setUint32(42, offset, true);
    entry.set(path, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
