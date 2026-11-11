import { deflateSync } from 'node:zlib';
import { MPQ_FLAGS, encryptBlock, fileKey, hashString } from '../src/mpq';

/** How a synthetic file is stored in the archive. */
export type Storage = 'raw' | 'zlib' | 'single' | 'single-zlib';

export interface SyntheticFile {
  readonly name: string;
  readonly data: Uint8Array;
  readonly storage: Storage;
  readonly encrypt?: boolean;
  readonly fixKey?: boolean;
  readonly locale?: number;
  /** Store every sector as `[mask, ...junk]` (shorter than the sector) instead of real compression. */
  readonly fakeMask?: number;
  /** Extra block flags (for example DELETE_MARKER or PATCH_FILE). */
  readonly extraFlags?: number;
}

export interface BuildOptions {
  /** Sector size is 512 << sectorShift (default 0: 512-byte sectors, so small files span sectors). */
  readonly sectorShift?: number;
  /** Put a 512-byte user-data block (MPQ\x1B) in front of the archive header. */
  readonly userData?: boolean;
  /** Hash table entries (power of two, default 16). */
  readonly hashTableSize?: number;
}

function words(bytes: Uint8Array): Uint32Array {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Uint32Array(copy.buffer, 0, bytes.length >>> 2);
}

/** Encrypts the whole dwords of `bytes` in place (trailing bytes stay as they are, like the client). */
function encryptBytes(bytes: Uint8Array, key: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const w = words(out);
  encryptBlock(w, key);
  out.set(new Uint8Array(w.buffer, 0, w.length * 4));
  return out;
}

function compressSector(sector: Uint8Array, fakeMask: number | undefined): Uint8Array {
  if (fakeMask !== undefined) return Uint8Array.from([fakeMask, 1, 2, 3]);
  const z = deflateSync(sector);
  if (z.length + 1 >= sector.length) return sector;
  const out = new Uint8Array(z.length + 1);
  out[0] = 0x02;
  out.set(z, 1);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Stores one file's data as it would sit in the archive at `filePos` (relative to the header). */
function storeFile(f: SyntheticFile, filePos: number, sectorSize: number): { stored: Uint8Array; flags: number } {
  let flags = MPQ_FLAGS.EXISTS | (f.extraFlags ?? 0);
  if (f.encrypt) flags |= MPQ_FLAGS.ENCRYPTED;
  if (f.fixKey) flags |= MPQ_FLAGS.FIX_KEY;
  const key = f.encrypt ? fileKey(f.name, filePos, f.data.length, flags) : 0;
  const enc = (b: Uint8Array, k: number): Uint8Array => (f.encrypt ? encryptBytes(b, k) : b);
  if (f.storage === 'single' || f.storage === 'single-zlib') {
    flags |= MPQ_FLAGS.SINGLE_UNIT;
    let body = f.data;
    if (f.storage === 'single-zlib') {
      flags |= MPQ_FLAGS.COMPRESS;
      body = compressSector(f.data, f.fakeMask);
    }
    return { stored: enc(body, key), flags };
  }
  const sectors: Uint8Array[] = [];
  for (let o = 0; o < f.data.length; o += sectorSize) sectors.push(f.data.subarray(o, Math.min(o + sectorSize, f.data.length)));
  if (f.storage === 'raw') return { stored: concat(sectors.map((s, i) => enc(s, key + i))), flags };
  flags |= MPQ_FLAGS.COMPRESS;
  const bodies = sectors.map((s, i) => enc(compressSector(s, f.fakeMask), key + i));
  const table = new Uint32Array(sectors.length + 1);
  table[0] = table.length * 4;
  bodies.forEach((b, i) => (table[i + 1] = table[i]! + b.length));
  if (f.encrypt) encryptBlock(table, (key - 1) >>> 0);
  return { stored: concat([new Uint8Array(table.buffer), ...bodies]), flags };
}

/** Builds a small format-0 MPQ archive with encrypted hash and block tables. */
export function buildMpq(files: readonly SyntheticFile[], opts: BuildOptions = {}): Uint8Array {
  const sectorShift = opts.sectorShift ?? 0;
  const sectorSize = 512 << sectorShift;
  const hashSize = opts.hashTableSize ?? 16;
  const parts: Uint8Array[] = [];
  let pos = 32;
  const blocks: number[] = [];
  for (const f of files) {
    const { stored, flags } = storeFile(f, pos, sectorSize);
    blocks.push(pos, stored.length, f.data.length, flags);
    parts.push(stored);
    pos += stored.length;
  }
  const hash = new Uint32Array(hashSize * 4).fill(0xffffffff);
  files.forEach((f, i) => {
    let h = hashString(f.name, 0) & (hashSize - 1);
    while (hash[h * 4 + 3] !== 0xffffffff) h = (h + 1) & (hashSize - 1);
    hash[h * 4] = hashString(f.name, 1);
    hash[h * 4 + 1] = hashString(f.name, 2);
    hash[h * 4 + 2] = (f.locale ?? 0) & 0xffff;
    hash[h * 4 + 3] = i;
  });
  const block = Uint32Array.from(blocks);
  encryptBlock(hash, hashString('(hash table)', 3));
  encryptBlock(block, hashString('(block table)', 3));
  const hashPos = pos;
  const blockPos = hashPos + hash.length * 4;
  const archiveSize = blockPos + block.length * 4;
  const header = new DataView(new ArrayBuffer(32));
  header.setUint32(0, 0x1a51504d, true);
  header.setUint32(4, 32, true);
  header.setUint32(8, archiveSize, true);
  header.setUint16(12, 0, true);
  header.setUint16(14, sectorShift, true);
  header.setUint32(16, hashPos, true);
  header.setUint32(20, blockPos, true);
  header.setUint32(24, hashSize, true);
  header.setUint32(28, files.length, true);
  const archive = concat([new Uint8Array(header.buffer), ...parts, new Uint8Array(hash.buffer), new Uint8Array(block.buffer)]);
  if (!opts.userData) return archive;
  const user = new DataView(new ArrayBuffer(512));
  user.setUint32(0, 0x1b51504d, true);
  user.setUint32(4, 16, true);
  user.setUint32(8, 512, true);
  user.setUint32(12, 16, true);
  return concat([new Uint8Array(user.buffer), archive]);
}

/** Patches the format version field of an archive built without user data. */
export function withFormatVersion(archive: Uint8Array, version: number): Uint8Array {
  const out = new Uint8Array(archive);
  new DataView(out.buffer).setUint16(12, version, true);
  return out;
}
