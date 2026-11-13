import { parsePlan, parseScenario, prepareRun, runScenario, type ActorView, type UnitView } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { chooseHealTarget } from '../src/generic/healer';
import { CONTENT, CONTENT_TEXT_EN } from '../src/index';

const PLAN = `
id: generic-actors
boss: training_dummy
roster:
  - { id: t1, name: Tanky, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 600, armor: 25000, threatMultiplier: 30, reaction: { minMs: 300, maxMs: 300 } }
  - { id: h1, name: Healy, kind: modelled, spec: generic_healer, profile: default, reaction: { minMs: 300, maxMs: 300 } }
  - { id: c1, name: Casty, kind: modelled, spec: generic_caster, profile: default, reaction: { minMs: 300, maxMs: 300 } }
spots:
  tank: { x: 6, y: 0 }
  heal: { x: -20, y: 0 }
  ranged: { x: 20, y: 0 }
  out: { x: 44, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, h1: heal, c1: ranged }
rules:
  - id: run-when-marked
    who: [c1]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: out }
    priority: 60
`;
const SCENARIO = `
id: generic-actors
plan: plan.yaml
difficulty: 25n
seed: 5
maxDurationMs: 30000
observation:
  text: scenario.training_dummy_clean.observation
  checks:
    - { check: outcome_is, outcome: kill }
`;

function run() {
  const plan = parsePlan('plan.yaml', PLAN);
  const scenario = parseScenario('scenario.yaml', SCENARIO);
  if (!plan.ok || !scenario.ok) throw new Error(JSON.stringify([plan, scenario]));
  const prepared = prepareRun({ plan: plan.value, planFile: 'plan.yaml', scenario: scenario.value, scenarioFile: 'scenario.yaml' });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  const r = runScenario(prepared.value, CONTENT);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  return r;
}

describe('generic role actors (A-035)', () => {
  const r = run();
  const of = (kind: string, where: Record<string, unknown>) => r.trace.events.filter((e) => e.kind === kind && Object.entries(where).every(([k, v]) => e.data[k] === v));

  it('the caster casts its 2 s bolt at the boss, and movement interrupts it', () => {
    const casts = of('cast_start', { caster: 'c1', spell: 'caster_bolt' });
    expect(casts[0]).toMatchObject({ t: 0, data: { target: 'training_dummy', castTimeMs: 2000 } });
    const hits = of('damage', { source: 'c1', ability: 'caster_bolt' });
    expect(hits[0].t).toBe(2000);
    // The last hit can be cut short by the dummy's remaining health: amount + overkill is the full hit.
    const full = (e: (typeof hits)[number]): number => Number(e.data.amount) + Number(e.data.overkill);
    expect(hits.every((e) => full(e) >= 22000 && full(e) <= 26000 && e.data.school === 'fire')).toBe(true);
    // The dummy marks at 12 s; the caster runs out, which interrupts the cast it had started at 12 s.
    expect(of('cast_interrupted', { unit: 'c1', spell: 'caster_bolt' }).map((e) => e.data.reason)).toEqual(['moved']);
  });

  it('the healer heals the tank once it misses enough health, never the boss', () => {
    const heals = of('heal', { source: 'h1', ability: 'healer_heal' });
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.every((e) => e.data.target !== 'training_dummy')).toBe(true);
    expect(heals.some((e) => e.data.target === 't1' && Number(e.data.amount) + Number(e.data.overheal) >= 12000)).toBe(true);
    const first = of('cast_start', { caster: 'h1', spell: 'healer_heal' })[0];
    expect(first.data).toMatchObject({ target: 't1', castTimeMs: 1500 });
  });

  it('both are stand-ins in the limitation report, and their numbers are assumptions', () => {
    expect(r.summary.limitations.standIns).toEqual(['c1', 'h1', 't1']);
    const keys = r.summary.limitations.assumptions.map((a) => a.key);
    for (const key of ['generic_caster.bolt_min', 'generic_caster.health', 'generic_healer.heal_min', 'generic_healer.splash_targets', 'generic_healer.tank_first_below_pct']) {
      expect(keys, key).toContain(key);
    }
    expect(CONTENT_TEXT_EN['ability.caster_bolt']).toBe('Bolt');
    expect(CONTENT_TEXT_EN['ability.healer_heal']).toBe('Heal');
  });
});

describe('chooseHealTarget', () => {
  const unit = (id: string, role: UnitView['role'], health: number, maxHealth: number, cast: UnitView['cast'] = null): UnitView => ({
    id,
    name: id,
    kind: role === 'boss' ? 'creature' : 'player',
    role,
    health,
    maxHealth,
    alive: health > 0,
    x: 0,
    y: 0,
    moving: false,
    combatReach: 1.5,
    auras: [],
    cast,
  });
  const view = (units: UnitView[], outOfRange: string[] = []): ActorView =>
    ({
      now: 0,
      self: units.find((u) => u.id === 'h1')!,
      units,
      canCast: (_spell: string, target: string) => (outOfRange.includes(target) ? { ok: false, reason: 'out_of_range' } : { ok: true }),
    }) as unknown as ActorView;
  const h1 = unit('h1', 'healer', 30000, 30000);
  const choose = (units: UnitView[], outOfRange: string[] = []) => chooseHealTarget(view([h1, ...units], outOfRange), 13000, 6000, 85);

  it('takes the lowest health percentage, ties to the lowest id, and skips small deficits and the dead', () => {
    expect(choose([unit('a', 'ranged', 20000, 30000), unit('b', 'ranged', 15000, 30000)])).toBe('b');
    expect(choose([unit('b', 'ranged', 15000, 30000), unit('a', 'ranged', 15000, 30000)].sort((x, y) => (x.id < y.id ? -1 : 1)))).toBe('a');
    expect(choose([unit('a', 'ranged', 25000, 30000)])).toBeNull();
    expect(choose([unit('a', 'ranged', 0, 30000), unit('boss', 'boss', 10, 1000000)])).toBeNull();
  });

  it('counts the heals other healers are casting', () => {
    const h2 = unit('h2', 'healer', 30000, 30000, { spell: 'healer_heal', target: 'a', endsAtMs: 1000 });
    // a: 12,000 + 13,000 incoming = 25,000 of 30,000, a deficit below 6,000: b is next.
    expect(choose([h2, unit('a', 'ranged', 12000, 30000), unit('b', 'ranged', 20000, 30000)])).toBe('b');
  });

  it('a tank below 85 % comes first; a target out of range is skipped', () => {
    const units = [unit('a', 'ranged', 9000, 30000), unit('t1', 'tank', 60000, 80000)];
    expect(choose(units)).toBe('t1');
    expect(choose(units, ['t1'])).toBe('a');
    expect(choose([unit('a', 'ranged', 9000, 30000), unit('t1', 'tank', 70000, 80000)])).toBe('a');
  });
});
