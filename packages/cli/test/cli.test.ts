import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli, type Io } from '../src/cli';

function memoryIo() {
  const written = new Map<string, string>();
  const lines: string[] = [];
  const io: Io = {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, c) => void written.set(p.replace(/\\/g, '/'), c),
    mkdir: () => {},
    out: (l) => void lines.push(l),
  };
  return { io, written, lines };
}

describe('raid-sim run', () => {
  it('runs a scenario and writes trace, summary and log', () => {
    const { io, written, lines } = memoryIo();
    const code = runCli(['run', 'scenarios/training-dummy/clean.yaml', '--out', 'out/test'], io);
    expect(code).toBe(0);
    expect([...written.keys()].sort()).toEqual(['out/test/log.txt', 'out/test/summary.json', 'out/test/trace.json']);
    expect(lines[0]).toMatch(/^training-dummy-clean: kill at \d\d:\d\d\.\d{3}$/);
    expect(written.get('out/test/log.txt')).toContain('Training Dummy engaged');
    expect(JSON.parse(written.get('out/test/trace.json')!).schemaVersion).toBe(1);
  });

  it('reports a write failure instead of throwing', () => {
    const { io, lines } = memoryIo();
    const failing: Io = { ...io, writeFile: () => { throw new Error('disk full'); } };
    expect(runCli(['run', 'scenarios/training-dummy/clean.yaml', '--out', 'out/test'], failing)).toBe(1);
    expect(lines.at(-1)?.replaceAll('\\', '/')).toBe('cannot write out/test/trace.json: disk full');
    const noDir: Io = { ...io, mkdir: () => { throw new Error('read-only'); } };
    const out = memoryIo();
    expect(runCli(['run', 'scenarios/training-dummy/clean.yaml', '--out', 'out/test'], { ...out.io, mkdir: noDir.mkdir })).toBe(1);
    expect(out.lines.at(-1)).toBe('cannot write out/test: read-only');
  });

  it('overrides the seed', () => {
    const { io, written } = memoryIo();
    runCli(['run', 'scenarios/training-dummy/clean.yaml', '--out', 'o', '--seed', '7'], io);
    expect(JSON.parse(written.get('o/trace.json')!).meta.seed).toBe(7);
  });

  it('reports invalid input with exit code 2 and usage errors with 64', () => {
    const missing = memoryIo();
    expect(runCli(['run', 'scenarios/does-not-exist.yaml'], { ...missing.io, readFile: () => { throw new Error('ENOENT'); } })).toBe(2);
    expect(runCli(['walk'], memoryIo().io)).toBe(64);
    expect(runCli(['run', 'x.yaml', '--seed', '-1'], memoryIo().io)).toBe(64);
  });
});
