export type DbcValue = number | string;
export type DbcRow = readonly (DbcValue | null)[];

export interface DbcTable {
  readonly recordCount: number;
  readonly fieldCount: number;
  readonly recordSize: number;
  /** Rows keyed by the value of the `n` (index) column. */
  readonly rows: ReadonlyMap<number, DbcRow>;
}

export class DbcFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbcFormatError';
  }
}

const WDBC_MAGIC = 0x43424457; // "WDBC" read as a little-endian uint32

function fieldWidth(c: string): number {
  if (c === 'b' || c === 'X') return 1;
  if (c === 'n' || c === 'i' || c === 'f' || c === 's' || c === 'x' || c === 'd') return 4;
  throw new DbcFormatError(`unknown format character ${c}`);
}

export interface ParseOptions {
  /**
   * Whether invalid UTF-8 in the given (zero-based) string column is an error. Default: every column is strict.
   * In a non-strict column an undecodable string becomes `null`; structural errors (offsets, termination) still throw.
   */
  readonly strictStringColumns?: (column: number) => boolean;
}

/** Parses a WDBC file using an AzerothCore format string (DBCfmt.h). */
export function parseWdbc(bytes: Uint8Array, fmt: string, options: ParseOptions = {}): DbcTable {
  if (bytes.byteLength < 20) throw new DbcFormatError('file too short for a WDBC header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== WDBC_MAGIC) throw new DbcFormatError('not a WDBC file');
  const recordCount = view.getUint32(4, true);
  const fieldCount = view.getUint32(8, true);
  const recordSize = view.getUint32(12, true);
  const stringSize = view.getUint32(16, true);
  const chars = [...fmt];
  const width = chars.reduce((n, c) => n + fieldWidth(c), 0);
  if (chars.length !== fieldCount) throw new DbcFormatError(`format has ${chars.length} fields, file has ${fieldCount}`);
  if (width !== recordSize) throw new DbcFormatError(`format record size ${width} does not match file record size ${recordSize}`);
  const indexColumn = chars.indexOf('n');
  if (indexColumn < 0) throw new DbcFormatError('format has no index column (n)');
  if (chars.lastIndexOf('n') !== indexColumn) throw new DbcFormatError('format has more than one index column (n)');
  const stringStart = 20 + recordCount * recordSize;
  if (stringStart + stringSize > bytes.byteLength) throw new DbcFormatError('file is truncated');
  if (stringStart + stringSize < bytes.byteLength) {
    throw new DbcFormatError(`file has ${bytes.byteLength - stringStart - stringSize} unexpected trailing bytes`);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const readString = (offset: number, strict: boolean): string | null => {
    if (offset >= stringSize) throw new DbcFormatError(`string offset ${offset} outside the string block`);
    let end = stringStart + offset;
    while (end < stringStart + stringSize && bytes[end] !== 0) end++;
    if (end >= stringStart + stringSize) throw new DbcFormatError(`unterminated string at offset ${offset}`);
    try {
      return decoder.decode(bytes.subarray(stringStart + offset, end));
    } catch {
      if (!strict) return null;
      throw new DbcFormatError(`invalid UTF-8 in string at offset ${offset}`);
    }
  };
  const rows = new Map<number, DbcRow>();
  for (let r = 0; r < recordCount; r++) {
    let o = 20 + r * recordSize;
    const row: (DbcValue | null)[] = [];
    for (const c of chars) {
      const column = row.length;
      switch (c) {
        case 'n':
          row.push(view.getUint32(o, true));
          break;
        case 'i':
          row.push(view.getInt32(o, true));
          break;
        case 'f':
          row.push(view.getFloat32(o, true));
          break;
        case 's':
          row.push(readString(view.getUint32(o, true), options.strictStringColumns?.(column) ?? true));
          break;
        case 'b':
          row.push(view.getUint8(o));
          break;
        case 'x':
        case 'd':
        case 'X':
          row.push(null);
          break;
        default:
          throw new DbcFormatError(`unreachable format character ${c}`);
      }
      o += fieldWidth(c);
    }
    const id = row[indexColumn] as number;
    if (rows.has(id)) throw new DbcFormatError(`duplicate id ${id}`);
    rows.set(id, row);
  }
  return { recordCount, fieldCount, recordSize, rows };
}
