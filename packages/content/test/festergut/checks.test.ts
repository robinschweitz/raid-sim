import { TraceWriter, type Trace, type TraceValue } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { FESTERGUT_CHECKS } from '../../src/festergut/checks';
import { CONTENT } from '../../src/index';

type Data = Readonly<Record<string, TraceValue>>;

/** A small hand-written trace: `add` returns the event id, to be used as a cause. */
function traceOf(build: (add: (t: number, kind: Parameters<TraceWriter['emit']>[1], data: Data, causes?: string[]) => string) => void, mistakes: unknown[] = []): Trace {
  const w = new TraceWriter();
  build((t, kind, data, causes = []) => w.emit(t, kind, data, causes).id);
  const unit = (id: string, kind: 'player' | 'creature') => ({ id, name: id, kind, role: kind === 'player' ? 'ranged' : 'boss', approximate: true });
  return w.build({
    engineVersion: 'test', azerothcoreCommit: 'test', spellDataVersions: [], scenario: 'test', plan: 'test', maxDurationMs: 1, mistakes: mistakes.map((m) => JSON.stringify(m)),
    boss: 'festergut', difficulty: '25n', seed: 1, profile: 'azerothcore', aiUpdateIntervalMs: 10, sampleIntervalMs: 100,
    units: [unit('festergut', 'creature'), unit('a', 'player'), unit('b', 'player'), unit('t1', 'player')],
  });
}

const check = (name: string, trace: Trace, params: Record<string, unknown> = {}) => FESTERGUT_CHECKS.get(name)!({ trace, params });

/** One Pungent Blight on a (stacks, damage) and b. */
function pungent(a: [number, number], b: [number, number]): Trace {
  return traceOf((add) => {
    for (const [unit, [stacks]] of [['a', a], ['b', b]] as const) {
      if (stacks > 0) add(100, 'aura_applied', { unit, aura: 'inoculated', caster: unit, stacks: 1, expiresMs: 1 });
      for (let s = 2; s <= stacks; s++) add(100 + s, 'aura_stack', { unit, aura: 'inoculated', caster: unit, stacks: s, expiresMs: 1 });
    }
    const cast = add(1000, 'cast_success', { caster: 'festergut', spell: 'pungent_blight', target: 'festergut' });
    for (const [unit, [stacks, damage]] of [['a', a], ['b', b]] as const) {
      const hit = add(1000, 'spell_hit', { caster: 'festergut', spell: 'pungent_blight', target: unit }, [cast]);
      if (stacks > 0) add(1000, 'aura_removed', { unit, aura: 'inoculated', caster: unit, reason: 'removed' }, [hit]);
      add(1000, 'damage', { target: unit, source: 'festergut', ability: 'pungent_blight', school: 'shadow', amount: Math.min(damage, 30000), overkill: Math.max(0, damage - 30000) }, [hit]);
    }
    add(1000, 'spell_hit', { caster: 'festergut', spell: 'pungent_blight', target: 'festergut' }, [cast]);
  });
}

describe('Festergut observation checks', () => {
  it('are registered in the content', () => {
    expect([...CONTENT.checks.keys()].sort()).toEqual(['festergut.inoculated_at_pungent', 'festergut.late_swap', 'festergut.missed_spores', 'raid.no_player_deaths']);
  });

  it('raid.no_player_deaths ignores the boss', () => {
    const kill = traceOf((add) => void add(5, 'death', { unit: 'festergut' }));
    expect(check('raid.no_player_deaths', kill)).toEqual({ pass: true, detail: 'no player died' });
    const loss = traceOf((add) => void add(5, 'death', { unit: 'b' }));
    expect(check('raid.no_player_deaths', loss)).toEqual({ pass: false, detail: 'died: b' });
  });

  it('festergut.inoculated_at_pungent reads the stacks at the hit, before they are removed', () => {
    expect(check('festergut.inoculated_at_pungent', pungent([3, 12500], [3, 12600]), { minStacks: 3 })).toEqual({ pass: true, detail: '1 Pungent Blight cast(s); lowest stacks 3' });
    expect(check('festergut.inoculated_at_pungent', pungent([3, 12500], [1, 37500]), { minStacks: 3 })).toEqual({ pass: false, detail: 'b had 1 at 1000 ms' });
    expect(check('festergut.inoculated_at_pungent', pungent([3, 12500], [1, 37500]), { minStacks: 3, except: ['b'] }).pass).toBe(true);
    expect(check('festergut.inoculated_at_pungent', traceOf(() => {}))).toEqual({ pass: false, detail: 'Pungent Blight was never cast' });
    // Nobody left to check: the check fails and says why (no Infinity in the detail).
    expect(check('festergut.inoculated_at_pungent', pungent([3, 12500], [1, 37500]), { minStacks: 3, except: ['a', 'b'] })).toEqual({
      pass: false,
      detail: 'Pungent Blight hit no player outside except',
    });
  });

  it('festergut.missed_spores compares the player with everyone else; overkill counts as damage', () => {
    expect(check('festergut.missed_spores', pungent([3, 12500], [0, 50000]), { player: 'b' })).toEqual({
      pass: true,
      detail: 'b: 0 stacks, 50000 damage; the others: at least 3 stacks, at most 12500 damage',
    });
    expect(check('festergut.missed_spores', pungent([3, 12500], [3, 12400]), { player: 'b' }).pass).toBe(false);
    expect(check('festergut.missed_spores', pungent([3, 12500], [0, 50000]), { player: 't1' })).toEqual({ pass: false, detail: 't1 was not hit by the first Pungent Blight' });
    expect(() => check('festergut.missed_spores', pungent([3, 1], [0, 2]), {})).toThrow(/param player/);
  });

  it('festergut.late_swap links the explosion, the last stack, the late rule and the mistake', () => {
    const build = (ruleFires: boolean) => (add: Parameters<Parameters<typeof traceOf>[0]>[0]) => {
      const hit = add(900, 'spell_hit', { caster: 'festergut', spell: 'gastric_bloat', target: 't1' });
      const stack = add(900, 'aura_stack', { unit: 't1', aura: 'gastric_bloat', caster: 'festergut', stacks: 10, expiresMs: 1 }, [hit]);
      if (ruleFires) add(900, 'rule_fired', { rule: 'swap-to-t2', actor: 't2' }, [stack]);
      add(900, 'cast_start', { caster: 't1', spell: 'gastric_explosion', target: 't1', castTimeMs: 0, endMs: 900, triggered: true }, [hit]);
    };
    const mistake = { type: 'set_stack_threshold', rule: 'swap-to-t2', atLeast: 10 };
    const params = { rule: 'swap-to-t2', tank: 't1' };
    expect(check('festergut.late_swap', traceOf(build(true), [mistake]), params)).toEqual({
      pass: true,
      detail: 'rule swap-to-t2 (threshold 10, a scenario mistake) fired at 900 ms on stack 10 of Gastric Bloat, the stack that made t1 explode',
    });
    expect(check('festergut.late_swap', traceOf(build(false), [mistake]), params).detail).toMatch(/did not fire on the stack that caused the explosion/);
    expect(check('festergut.late_swap', traceOf(build(true)), params).detail).toMatch(/no set_stack_threshold mistake/);
    expect(check('festergut.late_swap', traceOf(() => {}, [mistake]), params)).toEqual({ pass: false, detail: 't1 never cast Gastric Explosion' });
  });
});
