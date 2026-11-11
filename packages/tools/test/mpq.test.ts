import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MPQ_FLAGS,
  bytesSource,
  clientArchiveOrder,
  decryptBlock,
  encryptBlock,
  fileByteSource,
  findInArchives,
  hashString,
  installedLocales,
  openArchive,
} from '../src/mpq';
import { buildMpq, withFormatVersion, type SyntheticFile } from './mpq-builder';

/** 1500 bytes: three 512-byte sectors, the last one partial and not a multiple of four. */
function sample(seed: number, length = 1501): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i % 7 === 0 ? (i * seed) & 0xff : i % 13) + seed;
  return out;
}

const NAME = 'DBFilesClient\\Spell.dbc';

function only(file: Omit<SyntheticFile, 'name' | 'data'> & { name?: string; data?: Uint8Array }) {
  return openArchive('test.MPQ', bytesSource(buildMpq([{ name: NAME, data: sample(3), ...file }])));
}

describe('MPQ hashing and crypt', () => {
  it('hashes the table names to the known values', () => {
    expect(hashString('(hash table)', 3)).toBe(0xc3af3770);
    expect(hashString('(block table)', 3)).toBe(0xec83b3a3);
  });

  it('hashes case-insensitively and treats / like \\', () => {
    for (const type of [0, 1, 2, 3]) {
      expect(hashString('dbfilesclient/spell.DBC', type)).toBe(hashString(NAME, type));
    }
    expect(hashString(NAME, 1)).not.toBe(hashString(NAME, 2));
  });

  it('decrypts what it encrypts, and the result differs in between', () => {
    const plain = Uint32Array.from([1, 2, 3, 0xffffffff, 0x12345678]);
    const w = Uint32Array.from(plain);
    encryptBlock(w, 0xdeadbeef);
    expect([...w]).not.toEqual([...plain]);
    decryptBlock(w, 0xdeadbeef);
    expect([...w]).toEqual([...plain]);
  });
});

describe('openArchive', () => {
  it('finds files by name, case-insensitively and with / or \\', () => {
    const a = openArchive('test.MPQ', bytesSource(buildMpq([
      { name: 'a.txt', data: sample(1), storage: 'raw' },
      { name: NAME, data: sample(2), storage: 'raw' },
    ])));
    expect(a.read('dbfilesclient/SPELL.dbc')).toEqual(sample(2));
    expect(a.read('A.TXT')).toEqual(sample(1));
    expect(a.read('DBFilesClient\\SpellRange.dbc')).toBeNull();
  });

  const variants: [string, Omit<SyntheticFile, 'name' | 'data'>][] = [
    ['uncompressed', { storage: 'raw' }],
    ['zlib, several sectors', { storage: 'zlib' }],
    ['single unit', { storage: 'single' }],
    ['single unit, zlib', { storage: 'single-zlib' }],
    ['uncompressed, encrypted', { storage: 'raw', encrypt: true }],
    ['zlib, encrypted', { storage: 'zlib', encrypt: true }],
    ['zlib, encrypted with FIX_KEY', { storage: 'zlib', encrypt: true, fixKey: true }],
    ['single unit, zlib, encrypted with FIX_KEY', { storage: 'single-zlib', encrypt: true, fixKey: true }],
    ['uncompressed, encrypted with FIX_KEY', { storage: 'raw', encrypt: true, fixKey: true }],
  ];
  for (const [label, storage] of variants) {
    it(`reads a file stored ${label}`, () => {
      expect(only(storage).read(NAME)).toEqual(sample(3));
    });
  }

  it('reads files when the sector size is larger than the file', () => {
    const a = openArchive('test.MPQ', bytesSource(buildMpq([{ name: NAME, data: sample(4), storage: 'zlib', encrypt: true }], { sectorShift: 3 })));
    expect(a.read(NAME)).toEqual(sample(4));
  });

  it('reads empty files', () => {
    expect(only({ storage: 'zlib', data: new Uint8Array(0) }).read(NAME)).toEqual(new Uint8Array(0));
  });

  it('prefers the neutral locale entry and reports the locale', () => {
    const a = openArchive('test.MPQ', bytesSource(buildMpq([
      { name: NAME, data: sample(5), storage: 'raw', locale: 0x407 },
      { name: NAME, data: sample(6), storage: 'raw', locale: 0 },
      { name: 'b.txt', data: sample(7), storage: 'raw', locale: 0x407 },
    ])));
    expect(a.find(NAME)?.locale).toBe(0);
    expect(a.read(NAME)).toEqual(sample(6));
    expect(a.find('b.txt')?.locale).toBe(0x407);
    expect(a.read('b.txt')).toEqual(sample(7));
  });

  it('works behind a user-data header', () => {
    const a = openArchive('test.MPQ', bytesSource(buildMpq([{ name: NAME, data: sample(8), storage: 'zlib', encrypt: true, fixKey: true }], { userData: true })));
    expect(a.read(NAME)).toEqual(sample(8));
  });

  it('finds a header at a later 512-byte step', () => {
    const archive = buildMpq([{ name: NAME, data: sample(9), storage: 'zlib' }]);
    const shifted = new Uint8Array(1024 + archive.length);
    shifted.set(archive, 1024);
    expect(openArchive('test.MPQ', bytesSource(shifted)).read(NAME)).toEqual(sample(9));
  });

  it('rejects files without an MPQ header', () => {
    expect(() => openArchive('junk.MPQ', bytesSource(new Uint8Array(2048)))).toThrow('junk.MPQ: no MPQ header found');
  });

  it('rejects unsupported format versions', () => {
    const archive = withFormatVersion(buildMpq([{ name: NAME, data: sample(1), storage: 'raw' }]), 2);
    expect(() => openArchive('v2.MPQ', bytesSource(archive))).toThrow('v2.MPQ: MPQ format version 2 is not supported (only 0 and 1)');
  });

  it('names unsupported compressions', () => {
    expect(() => only({ storage: 'zlib', fakeMask: 0x10 }).read(NAME)).toThrow(
      `${NAME} in test.MPQ: sector 0 is compressed with bzip2 (mask 0x10): not supported`,
    );
    expect(() => only({ storage: 'single-zlib', fakeMask: 0x08 }).read(NAME)).toThrow(/compressed with PKWARE implode \(mask 0x08\): not supported/);
    expect(() => only({ storage: 'zlib', fakeMask: 0x41 }).read(NAME)).toThrow(/ADPCM mono \+ Huffman \(mask 0x41\)/);
  });

  it('rejects imploded files', () => {
    expect(() => only({ storage: 'raw', extraFlags: MPQ_FLAGS.IMPLODE }).read(NAME)).toThrow(`${NAME} in test.MPQ is imploded (PKWARE): not supported`);
  });

  it('rejects delete markers and incremental patch files', () => {
    expect(() => only({ storage: 'raw', extraFlags: MPQ_FLAGS.DELETE_MARKER }).read(NAME)).toThrow(`${NAME} in test.MPQ is a delete marker: not supported`);
    expect(() => only({ storage: 'raw', extraFlags: MPQ_FLAGS.PATCH_FILE }).read(NAME)).toThrow(`${NAME} in test.MPQ is an incremental patch file: not supported`);
  });
});

describe('malformed archives', () => {
  const file: SyntheticFile = { name: NAME, data: sample(1), storage: 'raw' };

  it('rejects sector size shifts above 15', () => {
    expect(() => openArchive('shift.MPQ', bytesSource(buildMpq([file], { sectorShift: 16 })))).toThrow('shift.MPQ: MPQ sector size shift 16 is not supported');
    expect(() => openArchive('shift.MPQ', bytesSource(buildMpq([file], { sectorShift: 32 })))).toThrow(/sector size shift 32 is not supported/);
    expect(openArchive('ok.MPQ', bytesSource(buildMpq([file], { sectorShift: 15 }))).sectorSize).toBe(512 << 15);
  });

  it('rejects huge file sizes before allocating', () => {
    for (const storage of ['raw', 'single', 'zlib', 'single-zlib'] as const) {
      const a = openArchive('big.MPQ', bytesSource(buildMpq([{ ...file, storage, declaredSize: 0xffffffff }])));
      expect(() => a.read(NAME), storage).toThrow(`${NAME} in big.MPQ is too large (4294967295 bytes)`);
    }
  });

  it('rejects uncompressed files that do not fit in the archive', () => {
    const a = openArchive('short.MPQ', bytesSource(buildMpq([{ ...file, storage: 'single', declaredSize: 100000 }])));
    expect(() => a.read(NAME)).toThrow(`${NAME} in short.MPQ is too large (100000 bytes)`);
  });

  it('maps an inflate that exceeds the sector size to a length error', () => {
    expect(() => only({ storage: 'zlib', inflateBomb: true }).read(NAME)).toThrow(`${NAME} in test.MPQ: sector 0 inflates to more than 512 bytes, expected 512`);
    expect(() => only({ storage: 'single-zlib', inflateBomb: true }).read(NAME)).toThrow(/inflates to more than 1501 bytes, expected 1501/);
  });

  it('rejects empty stored sectors', () => {
    expect(() => only({ storage: 'zlib', emptySectors: true }).read(NAME)).toThrow(`${NAME} in test.MPQ: sector 0 is empty`);
    expect(() => only({ storage: 'single-zlib', emptySectors: true }).read(NAME)).toThrow(`${NAME} in test.MPQ: sector 0 is empty`);
  });

  it('reads a format 1 archive (44-byte header, zero hi-block table)', () => {
    const archive = buildMpq([{ name: NAME, data: sample(5), storage: 'zlib', encrypt: true, fixKey: true }, { name: 'b.txt', data: sample(6), storage: 'raw' }], { v1: true });
    expect(new DataView(archive.buffer, archive.byteOffset).getUint32(4, true)).toBe(44);
    const a = openArchive('v1.MPQ', bytesSource(archive));
    expect(a.formatVersion).toBe(1);
    expect(a.read(NAME)).toEqual(sample(5));
    expect(a.read('b.txt')).toEqual(sample(6));
  });
});

describe('findInArchives', () => {
  const older = { name: 'Data/common.MPQ', source: bytesSource(buildMpq([{ name: NAME, data: sample(1), storage: 'zlib' }, { name: 'only-old.txt', data: sample(2), storage: 'raw' }])) };
  const newer = { name: 'Data/patch.MPQ', source: bytesSource(buildMpq([{ name: NAME, data: sample(3), storage: 'raw' }])) };

  it('takes the first archive in the given order that has the file', () => {
    expect(findInArchives([newer, older], NAME)).toEqual({ archive: 'Data/patch.MPQ', bytes: sample(3) });
    expect(findInArchives([older, newer], NAME)?.archive).toBe('Data/common.MPQ');
    expect(findInArchives([newer, older], 'only-old.txt')).toEqual({ archive: 'Data/common.MPQ', bytes: sample(2) });
  });

  it('returns null when no archive has the file', () => {
    expect(findInArchives([newer, older], 'nothing.dbc')).toBeNull();
  });
});

describe('client archives on disk', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  function client(files: readonly string[]): string {
    dir = mkdtempSync(join(tmpdir(), 'mpq-client-'));
    for (const f of files) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), 'x');
    }
    return dir;
  }

  it('lists the archives newest first, only those that exist, matching names case-insensitively', () => {
    const root = client([
      'Data/common.MPQ', 'Data/common-2.MPQ', 'Data/expansion.MPQ', 'Data/lichking.MPQ', 'Data/patch.MPQ', 'Data/PATCH-2.mpq', 'Data/patch-3.MPQ',
      'Data/deDE/locale-deDE.MPQ', 'Data/deDE/expansion-locale-deDE.MPQ', 'Data/deDE/lichking-locale-deDE.MPQ',
      'Data/deDE/patch-deDE.MPQ', 'Data/deDE/patch-deDE-2.MPQ', 'Data/deDE/patch-dede-3.MPQ', 'Data/deDE/speech-deDE.MPQ',
      'Data/enGB/locale-enGB.MPQ',
    ]);
    expect(clientArchiveOrder(root, 'deDE').map((a) => a.name)).toEqual([
      'Data/deDE/patch-dede-3.MPQ', 'Data/deDE/patch-deDE-2.MPQ', 'Data/deDE/patch-deDE.MPQ', 'Data/deDE/lichking-locale-deDE.MPQ',
      'Data/deDE/expansion-locale-deDE.MPQ', 'Data/deDE/locale-deDE.MPQ',
      'Data/patch-3.MPQ', 'Data/PATCH-2.mpq', 'Data/patch.MPQ', 'Data/lichking.MPQ', 'Data/expansion.MPQ', 'Data/common-2.MPQ', 'Data/common.MPQ',
    ]);
    expect(clientArchiveOrder(root, 'deDE')[0]!.path).toBe(join(root, 'Data', 'deDE', 'patch-dede-3.MPQ'));
  });

  it('puts custom base patches (patch-4 and up, patch-<letter>) before the locale group, newest first', () => {
    const root = client([
      'Data/patch.MPQ', 'Data/patch-2.MPQ', 'Data/patch-3.MPQ', 'Data/patch-12.MPQ', 'Data/patch-4.MPQ', 'Data/patch-A.MPQ', 'Data/patch-b.MPQ',
      'Data/patch-ab.MPQ', 'Data/deDE/patch-deDE.MPQ', 'Data/deDE/patch-deDE-5.MPQ',
    ]);
    expect(clientArchiveOrder(root, 'deDE').map((a) => a.name)).toEqual([
      'Data/patch-b.MPQ', 'Data/patch-A.MPQ', 'Data/patch-12.MPQ', 'Data/patch-4.MPQ',
      'Data/deDE/patch-deDE-5.MPQ', 'Data/deDE/patch-deDE.MPQ',
      'Data/patch-3.MPQ', 'Data/patch-2.MPQ', 'Data/patch.MPQ',
    ]);
  });

  it('errors when the client folder has no Data folder or no such locale', () => {
    const root = client(['Data/patch.MPQ']);
    expect(() => clientArchiveOrder(root, 'deDE')).toThrow(`no locale folder Data/deDE in ${root}`);
    expect(() => clientArchiveOrder(join(root, 'nope'), 'deDE')).toThrow(/no Data folder in/);
  });

  it('lists the installed locale folders', () => {
    const root = client(['Data/patch.MPQ', 'Data/enGB/locale-enGB.MPQ', 'Data/deDE/locale-deDE.MPQ', 'Data/Cache/x', 'Data/frFR.txt']);
    expect(installedLocales(root)).toEqual(['deDE', 'enGB']);
    expect(installedLocales(join(root, 'nope'))).toEqual([]);
  });

  it('reads archives from disk through a file byte source', () => {
    dir = mkdtempSync(join(tmpdir(), 'mpq-file-'));
    const path = join(dir, 'test.MPQ');
    writeFileSync(path, buildMpq([{ name: NAME, data: sample(4), storage: 'zlib', encrypt: true }]));
    const source = fileByteSource(path);
    try {
      expect(findInArchives([{ name: 'test.MPQ', source }], NAME)?.bytes).toEqual(sample(4));
      expect(() => source.read(source.size - 2, 4)).toThrow(/past the end/);
    } finally {
      source.close();
    }
  });
});
