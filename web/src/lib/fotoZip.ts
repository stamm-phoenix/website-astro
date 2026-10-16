/**
 * A ZIP archive built in the browser from files downloaded from SharePoint. Photos and videos
 * are compressed already, so the entries are stored as they are; that keeps the archive fast to
 * build on a phone. No ZIP64: the archive stays below 4 GB (see `MAX_ZIP_BYTES`).
 */

/** Largest selection packed into one archive; phones keep the archive in memory. */
export const MAX_ZIP_BYTES = 1024 ** 3;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Continues a CRC-32 over the next bytes; start with 0 and pass the result back in. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  data: Blob;
  crc: number;
  modified: Date;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const UTF8_NAMES = 0x0800;

/** Packs the files into a ZIP archive; names must be unique. */
export function buildZip(files: ZipFile[]): Blob {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const { time, day } = dosDateTime(file.modified);
    const size = file.data.size;

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, UTF8_NAMES, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, time, true);
    l.setUint16(12, day, true);
    l.setUint32(14, file.crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8_NAMES, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, file.crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    entry.set(name, 46);

    parts.push(local, file.data);
    central.push(entry);
    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/**
 * Downloads a file and computes its CRC-32 on the way.
 * @param onBytes Called with the number of bytes received since the last call.
 */
export async function downloadForZip(
  url: string,
  signal: AbortSignal,
  onBytes: (bytes: number) => void
): Promise<{ data: Blob; crc: number }> {
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32(value, crc);
    chunks.push(value);
    onBytes(value.length);
  }
  return { data: new Blob(chunks), crc };
}
