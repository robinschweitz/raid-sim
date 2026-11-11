/** Builds a WDBC file for tests. Missing values default to 0 (or '' for strings). */
export function buildWdbc(fmt: string, records: readonly (readonly (number | string)[])[]): Uint8Array {
  const encoder = new TextEncoder();
  const strings: number[] = [0];
  const offsets = new Map<string, number>([['', 0]]);
  const offsetOf = (s: string): number => {
    const known = offsets.get(s);
    if (known !== undefined) return known;
    const off = strings.length;
    strings.push(...encoder.encode(s), 0);
    offsets.set(s, off);
    return off;
  };
  const width = [...fmt].reduce((n, c) => n + (c === 'b' || c === 'X' ? 1 : 4), 0);
  const body = new Uint8Array(records.length * width);
  const view = new DataView(body.buffer);
  records.forEach((rec, r) => {
    let o = r * width;
    [...fmt].forEach((c, i) => {
      const v = rec[i] ?? (c === 's' ? '' : 0);
      if (c === 'b' || c === 'X') {
        view.setUint8(o, Number(v));
        o += 1;
      } else if (c === 'f') {
        view.setFloat32(o, Number(v), true);
        o += 4;
      } else if (c === 's') {
        view.setUint32(o, offsetOf(String(v)), true);
        o += 4;
      } else if (c === 'n') {
        view.setUint32(o, Number(v), true);
        o += 4;
      } else {
        view.setInt32(o, Number(v), true);
        o += 4;
      }
    });
  });
  const header = new DataView(new ArrayBuffer(20));
  header.setUint32(0, 0x43424457, true);
  header.setUint32(4, records.length, true);
  header.setUint32(8, fmt.length, true);
  header.setUint32(12, width, true);
  header.setUint32(16, strings.length, true);
  const out = new Uint8Array(20 + body.length + strings.length);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(body, 20);
  out.set(Uint8Array.from(strings), 20 + body.length);
  return out;
}
