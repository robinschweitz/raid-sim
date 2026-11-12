import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli, type Io } from '../src/cli';
import { readGolden } from '../src/golden';

function run(scenario: string) {
  const written = new Map<string, string>();
  const lines: string[] = [];
  const io: Io = {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, c) => void written.set(p.replace(/\\/g, '/'), c),
    mkdir: () => {},
    out: (l) => void lines.push(l),
  };
  const code = runCli(['run', `scenarios/festergut/${scenario}.yaml`, '--out', 'out/test'], io);
  return { code, lines, log: written.get('out/test/log.txt') ?? '', summary: JSON.parse(written.get('out/test/summary.json') ?? '{}') };
}

describe('raid-sim run scenarios/festergut/<name>.yaml', () => {
  it('clean kill: exit code 0, a readable log with English names, the limitation line', () => {
    const r = run('clean-kill');
    expect(r.code).toBe(0);
    expect(r.lines[0]).toMatch(/^festergut-clean-kill: kill at 04:\d\d\.\d{3}$/);
    expect(r.lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(r.lines).toContain('limitations: 25 stand-ins, 28 assumptions, 6 partial mechanics, 2 not implemented, 24 stand-in profile values');
    // The tank stand-in profile is a plan choice that stands in for cooldowns (A-039): it is reported with its reason.
    const tankProfile = r.lines.find((l) => l.startsWith('  profile t1: '));
    expect(tankProfile).toMatch(/^ {2}profile t1: maxHealth 95000, ratePerSecond 3000, armor 50000, avoidance\.missPct 8, avoidance\.dodgePct 27, avoidance\.parryPct 22, threatMultiplier 8 \(.*cooldowns.*\)$/);
    expect(r.summary.limitations.profileValues).toContainEqual(expect.objectContaining({ unit: 't2', field: 'armor', value: 50000 }));
    // Player deaths and the boss death are reported separately.
    expect(r.lines).toContain('player deaths: 0');
    expect(r.lines).toContain('boss deaths: 1');
    expect(r.lines.some((l) => /^ {2}festergut at 04:\d\d\.\d{3}/.test(l))).toBe(true);
    expect(r.log).toContain('[00:00.000] Festergut engaged');
    expect(r.log).toContain('[00:06.790] Festergut gains Gaseous Blight (strong)');
    expect(r.log).toMatch(/\[00:2\d\.\d{3}\] Festergut casts Gas Spore → Festergut/);
    expect(r.log).toMatch(/Festergut begins casting Pungent Blight → Festergut/);
    expect(r.log).toMatch(/Brakka taunts Festergut/);
    expect(r.log).toMatch(/Alice gains Inoculated \(3\)/);
    // No raw ability id is left in the lines that name abilities.
    expect(r.log.split('\n').filter((l) => /gaseous_blight|gas_spore_carrier|caster_bolt|healer_heal/.test(l) && !l.includes('Festergut: '))).toEqual([]);
  });

  it('missed spore group and late tank swap: every observation passes', () => {
    const missed = run('missed-spore-group');
    expect(missed.code).toBe(0);
    expect(missed.lines.some((l) => l.startsWith('PASS custom:festergut.missed_spores: r06: 0 stacks'))).toBe(true);
    expect(missed.lines.some((l) => /^ {2}r06 at 02:\d\d\.\d{3} \(pungent_blight from festergut\)$/.test(l))).toBe(true);
    expect(missed.lines.indexOf('player deaths: 1')).toBe(missed.lines.findIndex((l) => l.startsWith('  r06 at ')) - 1);
    const late = run('late-tank-swap');
    expect(late.code).toBe(0);
    expect(late.lines.some((l) => l.startsWith('PASS custom:festergut.late_swap: rule swap-to-t2 (threshold 10, a scenario mistake) fired'))).toBe(true);
    expect(late.summary.deaths[0].killingBlow).toMatchObject({ ability: 'gastric_explosion' });
  });

  it('the three scenarios are pinned as golden runs next to the training dummy', () => {
    expect(Object.keys(readGolden({ readFile: (p) => readFileSync(p, 'utf8') })).sort()).toEqual([
      'scenarios/festergut/clean-kill.yaml',
      'scenarios/festergut/late-tank-swap.yaml',
      'scenarios/festergut/missed-spore-group.yaml',
      'scenarios/training-dummy/clean.yaml',
    ]);
  });
});
