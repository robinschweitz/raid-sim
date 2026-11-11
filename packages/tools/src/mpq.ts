/**
 * Read-only access to MPQ archives (format versions 0 and 1, as used by the WotLK 3.3.5a client),
 * written from the public description of the format. Only what we need to pull DBC files out of the
 * client: hash/block tables, encryption, single-unit and sectored files, zlib compression.
 */
import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Uint8Array;
}

export interface FileByteSource extends ByteSource {
  close(): void;
}

function outOfRange(what: string, offset: number, length: number, size: number): Error {
  return new Error(`${what}: read of ${length} bytes at ${offset} goes past the end (size ${size})`);
}

/** An in-memory byte source (tests, small files). */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > bytes.length) throw outOfRange('bytes', offset, length, bytes.length);
      return bytes.subarray(offset, offset + length);
    },
  };
}

/** Reads a file on demand, so multi-GB archives are never loaded whole. */
export function fileByteSource(path: string): FileByteSource {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  return {
    size,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) throw outOfRange(path, offset, length, size);
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const n = readSync(fd, out, done, length - done, offset + done);
        if (n === 0) throw outOfRange(path, offset, length, size);
        done += n;
      }
      return out;
    },
    close() {
      closeSync(fd);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Crypt table, name hashing, block encryption

const CRYPT_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i1 = 0; i1 < 0x100; i1++) {
    for (let i2 = i1, n = 0; n < 5; n++, i2 += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const hi = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      table[i2] = (hi | (seed & 0xffff)) >>> 0;
    }
  }
  return table;
})();

/** MPQ name hash. Type 0: hash table index, 1 and 2: name checks A and B, 3: file key. */
export function hashString(name: string, type: number): number {
  let seed1 = 0x7fed7fed;
  let seed2 = 0xeeeeeeee;
  for (let i = 0; i < name.length; i++) {
    let ch = name.charCodeAt(i) & 0xff;
    if (ch >= 0x61 && ch <= 0x7a) ch -= 0x20;
    else if (ch === 0x2f) ch = 0x5c;
    seed1 = (CRYPT_TABLE[type * 0x100 + ch]! ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed2 = (ch + seed1 + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0;
  }
  return seed1;
}

const nextKey = (key: number): number => ((((~key << 21) >>> 0) + 0x11111111) | (key >>> 11)) >>> 0;

export function decryptBlock(words: Uint32Array, key: number): void {
  let seed = 0xeeeeeeee;
  let k = key >>> 0;
  for (let i = 0; i < words.length; i++) {
    seed = (seed + CRYPT_TABLE[0x400 + (k & 0xff)]!) >>> 0;
    const plain = (words[i]! ^ ((k + seed) >>> 0)) >>> 0;
    words[i] = plain;
    k = nextKey(k);
    seed = (plain + seed + ((seed << 5) >>> 0) + 3) >>> 0;
  }
}

export function encryptBlock(words: Uint32Array, key: number): void {
  let seed = 0xeeeeeeee;
  let k = key >>> 0;
  for (let i = 0; i < words.length; i++) {
    seed = (seed + CRYPT_TABLE[0x400 + (k & 0xff)]!) >>> 0;
    const plain = words[i]!;
    words[i] = (plain ^ ((k + seed) >>> 0)) >>> 0;
    k = nextKey(k);
    seed = (plain + seed + ((seed << 5) >>> 0) + 3) >>> 0;
  }
}

function readWords(bytes: Uint8Array): Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.length >>> 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

/** Decrypts the whole dwords of a copy of `bytes`; trailing bytes are not encrypted in MPQ. */
function decryptBytes(bytes: Uint8Array, key: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const words = readWords(out);
  decryptBlock(words, key);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i]!, true);
  return out;
}

export const MPQ_FLAGS = {
  IMPLODE: 0x100,
  COMPRESS: 0x200,
  ENCRYPTED: 0x10000,
  FIX_KEY: 0x20000,
  PATCH_FILE: 0x100000,
  SINGLE_UNIT: 0x1000000,
  DELETE_MARKER: 0x2000000,
  SECTOR_CRC: 0x4000000,
  EXISTS: 0x80000000,
} as const;

/** The encryption key of a file: hash of the name after the last path separator, optionally fixed by position and size. */
export function fileKey(name: string, blockFilePos: number, fileSize: number, flags: number): number {
  const base = name.slice(Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/')) + 1);
  const key = hashString(base, 3);
  return flags & MPQ_FLAGS.FIX_KEY ? (((key + blockFilePos) >>> 0) ^ fileSize) >>> 0 : key;
}

// ---------------------------------------------------------------------------------------------
// Archive

const MAGIC_HEADER = 0x1a51504d; // 'MPQ\x1A'
const MAGIC_USER_DATA = 0x1b51504d; // 'MPQ\x1B'
const HASH_EMPTY = 0xffffffff;
const HASH_DELETED = 0xfffffffe;
/** How far into a file we look for the header (at 512-byte steps). */
const HEADER_SCAN_LIMIT = 64 * 1024 * 1024;

export interface MpqEntry {
  readonly locale: number;
  readonly blockIndex: number;
  /** Absolute position in the source. */
  readonly offset: number;
  /** Low 32 bits of the position relative to the archive header (used by FIX_KEY). */
  readonly blockFilePos: number;
  readonly compressedSize: number;
  readonly fileSize: number;
  readonly flags: number;
}

export interface MpqArchive {
  readonly name: string;
  readonly formatVersion: number;
  readonly sectorSize: number;
  /** The table entry for a file, or null when the archive has no such (existing) file. */
  find(fileName: string): MpqEntry | null;
  /** The file's contents, or null when the archive does not have it. */
  read(fileName: string): Uint8Array | null;
}

const u32 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true);
const u16 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o, true);

function findHeader(name: string, source: ByteSource): number {
  const limit = Math.min(source.size, HEADER_SCAN_LIMIT);
  for (let pos = 0; pos + 32 <= limit; pos += 512) {
    const magic = u32(source.read(pos, 4), 0);
    if (magic === MAGIC_HEADER) return pos;
    if (magic === MAGIC_USER_DATA && pos + 16 <= source.size) {
      const target = pos + u32(source.read(pos, 16), 8);
      if (target + 32 <= source.size && u32(source.read(target, 4), 0) === MAGIC_HEADER) return target;
    }
  }
  throw new Error(`${name}: no MPQ header found`);
}

const COMPRESSIONS: readonly [number, string][] = [
  [0x80, 'ADPCM stereo'],
  [0x40, 'ADPCM mono'],
  [0x20, 'sparse'],
  [0x10, 'bzip2'],
  [0x08, 'PKWARE implode'],
  [0x02, 'zlib'],
  [0x01, 'Huffman'],
];

function compressionName(mask: number): string {
  if (mask === 0x12) return 'LZMA';
  const names = COMPRESSIONS.filter(([bit]) => mask & bit).map(([, n]) => n);
  const unknown = mask & ~COMPRESSIONS.reduce((m, [bit]) => m | bit, 0);
  if (unknown) names.push(`unknown 0x${unknown.toString(16).padStart(2, '0')}`);
  return names.length > 0 ? names.join(' + ') : 'nothing';
}

export function openArchive(name: string, source: ByteSource): MpqArchive {
  const base = findHeader(name, source);
  const header = source.read(base, Math.min(44, source.size - base));
  const headerSize = u32(header, 4);
  const formatVersion = u16(header, 12);
  if (formatVersion > 1) throw new Error(`${name}: MPQ format version ${formatVersion} is not supported (only 0 and 1)`);
  if (formatVersion === 1 && (headerSize < 44 || header.length < 44)) throw new Error(`${name}: format 1 header is too short (${headerSize} bytes)`);
  const sectorSize = 512 << u16(header, 14);
  const hi = (o: number): number => (formatVersion === 1 ? u16(header, o) * 0x100000000 : 0);
  const hashPos = base + u32(header, 16) + hi(40);
  const blockPos = base + u32(header, 20) + hi(42);
  const hashCount = u32(header, 24);
  const blockCount = u32(header, 28);
  if (hashCount === 0 || (hashCount & (hashCount - 1)) !== 0) throw new Error(`${name}: hash table size ${hashCount} is not a power of two`);

  const hash = readWords(source.read(hashPos, hashCount * 16));
  decryptBlock(hash, hashString('(hash table)', 3));
  const block = readWords(source.read(blockPos, blockCount * 16));
  decryptBlock(block, hashString('(block table)', 3));
  let hiBlock: Uint8Array | null = null;
  if (formatVersion === 1) {
    const hiPos = u32(header, 32) + u32(header, 36) * 0x100000000;
    if (hiPos !== 0) hiBlock = source.read(base + hiPos, blockCount * 2);
  }

  function find(fileName: string): MpqEntry | null {
    const mask = hashCount - 1;
    const start = hashString(fileName, 0) & mask;
    const a = hashString(fileName, 1);
    const b = hashString(fileName, 2);
    const found: { locale: number; blockIndex: number }[] = [];
    let i = start;
    do {
      const blockIndex = hash[i * 4 + 3]!;
      if (blockIndex === HASH_EMPTY) break;
      if (blockIndex !== HASH_DELETED && hash[i * 4] === a && hash[i * 4 + 1] === b && blockIndex < blockCount) {
        found.push({ locale: hash[i * 4 + 2]! & 0xffff, blockIndex });
      }
      i = (i + 1) & mask;
    } while (i !== start);
    const pick = found.find((f) => f.locale === 0) ?? found[0];
    if (!pick) return null;
    const j = pick.blockIndex * 4;
    const flags = block[j + 3]!;
    if (!(flags & MPQ_FLAGS.EXISTS)) return null;
    const blockFilePos = block[j]!;
    const high = hiBlock ? u16(hiBlock, pick.blockIndex * 2) * 0x100000000 : 0;
    return {
      locale: pick.locale,
      blockIndex: pick.blockIndex,
      offset: base + blockFilePos + high,
      blockFilePos,
      compressedSize: block[j + 1]!,
      fileSize: block[j + 2]!,
      flags,
    };
  }

  function sector(fileName: string, index: number, stored: Uint8Array, expected: number, compressed: boolean): Uint8Array {
    if (!compressed || stored.length >= expected) return stored.subarray(0, expected);
    const mask = stored[0]!;
    if (mask !== 0x02) {
      throw new Error(
        `${fileName} in ${name}: sector ${index} is compressed with ${compressionName(mask)} (mask 0x${mask.toString(16).padStart(2, '0')}): not supported; export the file with an MPQ editor instead`,
      );
    }
    let out: Uint8Array;
    try {
      const z = inflateSync(stored.subarray(1));
      out = new Uint8Array(z.buffer, z.byteOffset, z.length);
    } catch (e) {
      throw new Error(`${fileName} in ${name}: sector ${index}: zlib data is broken (${e instanceof Error ? e.message : String(e)})`);
    }
    if (out.length !== expected) throw new Error(`${fileName} in ${name}: sector ${index} inflates to ${out.length} bytes, expected ${expected}`);
    return out;
  }

  function read(fileName: string): Uint8Array | null {
    const e = find(fileName);
    if (!e) return null;
    const { flags, fileSize, compressedSize } = e;
    if (flags & MPQ_FLAGS.DELETE_MARKER) throw new Error(`${fileName} in ${name} is a delete marker: not supported`);
    if (flags & MPQ_FLAGS.PATCH_FILE) throw new Error(`${fileName} in ${name} is an incremental patch file: not supported`);
    if (flags & MPQ_FLAGS.IMPLODE) throw new Error(`${fileName} in ${name} is imploded (PKWARE): not supported; export the file with an MPQ editor instead`);
    if (fileSize === 0) return new Uint8Array(0);
    const encrypted = (flags & MPQ_FLAGS.ENCRYPTED) !== 0;
    const compressed = (flags & MPQ_FLAGS.COMPRESS) !== 0;
    const key = encrypted ? fileKey(fileName, e.blockFilePos, fileSize, flags) : 0;
    const decrypt = (bytes: Uint8Array, k: number): Uint8Array => (encrypted ? decryptBytes(bytes, k >>> 0) : bytes);

    let out: Uint8Array;
    if (flags & MPQ_FLAGS.SINGLE_UNIT) {
      out = sector(fileName, 0, decrypt(source.read(e.offset, compressedSize), key), fileSize, compressed);
    } else {
      const count = Math.ceil(fileSize / sectorSize);
      const expected = (i: number): number => Math.min(sectorSize, fileSize - i * sectorSize);
      out = new Uint8Array(fileSize);
      let written = 0;
      if (compressed) {
        const table = readWords(source.read(e.offset, (count + 1) * 4));
        if (encrypted) decryptBlock(table, (key - 1) >>> 0);
        for (let i = 0; i < count; i++) {
          const from = table[i]!;
          const to = table[i + 1]!;
          if (to < from || to > compressedSize) throw new Error(`${fileName} in ${name}: broken sector table (sector ${i}: ${from}..${to}, stored size ${compressedSize})`);
          const data = sector(fileName, i, decrypt(source.read(e.offset + from, to - from), key + i), expected(i), true);
          out.set(data, written);
          written += data.length;
        }
      } else {
        for (let i = 0; i < count; i++) {
          const data = decrypt(source.read(e.offset + i * sectorSize, expected(i)), key + i);
          out.set(data, written);
          written += data.length;
        }
      }
      if (written !== fileSize) throw new Error(`${fileName} in ${name}: read ${written} bytes, expected ${fileSize}`);
    }
    if (out.length !== fileSize) throw new Error(`${fileName} in ${name}: read ${out.length} bytes, expected ${fileSize}`);
    return out;
  }

  return { name, formatVersion, sectorSize, find, read };
}

// ---------------------------------------------------------------------------------------------
// Several archives

export interface NamedSource {
  readonly name: string;
  readonly source: ByteSource;
}

const opened = new WeakMap<ByteSource, MpqArchive>();

/** The file from the first archive (in the given order: newest first) that has it. */
export function findInArchives(archives: readonly NamedSource[], fileName: string): { archive: string; bytes: Uint8Array } | null {
  for (const { name, source } of archives) {
    let archive = opened.get(source);
    if (!archive) {
      archive = openArchive(name, source);
      opened.set(source, archive);
    }
    const bytes = archive.read(fileName);
    if (bytes) return { archive: name, bytes };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Client folder layout

export interface ClientArchive {
  /** Relative to the client folder, forward slashes, as spelled on disk. */
  readonly name: string;
  readonly path: string;
}

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Orders `names` (as on disk) by the given lower-case wanted names; numbered patches first, highest first. */
function ordered(names: readonly string[], numbered: RegExp, fixed: readonly string[]): string[] {
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const extra = names
    .map((n) => ({ n, m: numbered.exec(n.toLowerCase()) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]))
    .map((x) => x.n);
  return [...extra, ...fixed.flatMap((f) => (lower.has(f) ? [lower.get(f)!] : []))];
}

/** Locale folders (`Data/xxXX`) of a client. */
export function installedLocales(clientDir: string): string[] {
  const data = entriesOf(clientDir).find((n) => n.toLowerCase() === 'data');
  if (!data) return [];
  return entriesOf(join(clientDir, data))
    .filter((n) => /^[a-z]{2}[A-Z]{2}$/.test(n) && isDir(join(clientDir, data, n)))
    .sort();
}

/** The client's archives that exist, newest first (the order the client applies them in reverse). */
export function clientArchiveOrder(clientDir: string, locale: string): ClientArchive[] {
  const data = entriesOf(clientDir).find((n) => n.toLowerCase() === 'data' && isDir(join(clientDir, n)));
  if (!data) throw new Error(`no Data folder in ${clientDir}`);
  const dataDir = join(clientDir, data);
  const loc = entriesOf(dataDir).find((n) => n.toLowerCase() === locale.toLowerCase() && isDir(join(dataDir, n)));
  if (!loc) throw new Error(`no locale folder ${data}/${locale} in ${clientDir}`);
  const l = locale.toLowerCase();
  const escaped = l.replace(/[^a-z0-9]/g, '\\$&');
  const locNames = ordered(entriesOf(join(dataDir, loc)), new RegExp(`^patch-${escaped}-(\\d+)\\.mpq$`), [
    `patch-${l}.mpq`,
    `lichking-locale-${l}.mpq`,
    `expansion-locale-${l}.mpq`,
    `locale-${l}.mpq`,
  ]);
  const baseNames = ordered(entriesOf(dataDir), /^patch-(\d+)\.mpq$/, ['patch.mpq', 'lichking.mpq', 'expansion.mpq', 'common-2.mpq', 'common.mpq']);
  return [
    ...locNames.map((n) => ({ name: `${data}/${loc}/${n}`, path: join(dataDir, loc, n) })),
    ...baseNames.map((n) => ({ name: `${data}/${n}`, path: join(dataDir, n) })),
  ];
}
