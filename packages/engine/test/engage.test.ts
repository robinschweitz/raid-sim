import { describe, expect, it } from 'vitest';
import { EventScriptedAI, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { engageEncounter } from '../src/engage';
import { Simulation } from '../src/sim';
import { ThreatManager, threatFor } from '../src/threat';
import type { Unit } from '../src/units';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

class Probe extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  readonly seen: string[] = [];
  protected engage(ctx: BossContext, who: Unit | null): void {
    this.seen.push(`${who?.id}:${ctx.victim()?.id}:${ctx.threatList().length}`);
  }
  protected executeEvent(): void {}
}

function newSim(withThreat = true, melee = false) {
  const sim = new Simulation({ seed: 5, maxDurationMs: 3000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, combatReach: 8, pos: { x: 0, y: 0 }, ...(melee ? { melee: { minDamage: 10, maxDamage: 10, attackTimeMs: 2000 } } : {}) });
  for (const id of ['a_first', 'p_pull', 'z_last']) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: melee ? 3 : 10, y: 0 } });
  if (withThreat) new ThreatManager(sim, 1000).install();
  return sim;
}

describe('engage with a puller (A-033)', () => {
  it('the puller becomes the victim; everyone else joins with 0 threat before the script engage code', () => {
    const sim = newSim();
    const probe = new Probe();
    const engage = engageEncounter(sim, probe, 'boss', 10, 'p_pull');
    expect(sim.trace.get(engage)?.data).toEqual({ boss: 'boss', who: 'p_pull' });
    expect(probe.seen).toEqual(['p_pull:p_pull:3']);
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => e.data.target)).toEqual(['p_pull']);
    expect(threatFor(sim)!.listed('boss').map((u) => u.id)).toEqual(['a_first', 'p_pull', 'z_last']);
  });

  it('the victim is set before the engage event, and zone-in-combat adds only 0 threat', () => {
    const sim = newSim();
    engageEncounter(sim, new Probe(), 'boss', 10, 'p_pull');
    expect(sim.trace.list().map((e) => e.kind)).toEqual(['threat_target', 'engage']);
    expect(['a_first', 'p_pull', 'z_last'].map((id) => threatFor(sim)!.threatOf('boss', id))).toEqual([0, 0, 0]);
  });

  it('skips dead players in zone-in-combat', () => {
    const sim = newSim();
    sim.damage('z_last', 1e9, { sourceId: 'boss', ability: 'x', school: 'physical' }, []);
    const probe = new Probe();
    engageEncounter(sim, probe, 'boss', 10, 'p_pull');
    expect(probe.seen).toEqual(['p_pull:p_pull:2']);
  });

  it('rejects a who that is not a living player', () => {
    const sim = newSim();
    expect(() => engageEncounter(sim, new Probe(), 'boss', 10, 'boss')).toThrow(/living player/);
    expect(() => engageEncounter(sim, new Probe(), 'boss', 10, 'ghost')).toThrow(/living player/);
  });

  it('needs a threat manager', () => {
    expect(() => engageEncounter(newSim(false), new Probe(), 'boss', 10, 'p_pull')).toThrow(/threat manager/);
  });
});

describe('engage order and first swing (A-033)', () => {
  it('zone-in adds players in unit id order, after the engage event and before the script engage code', () => {
    const sim = newSim();
    const order: string[] = [];
    const threat = threatFor(sim)!;
    const add = threat.add.bind(threat);
    threat.add = (c, u, amount, causes) => {
      order.push(`add:${u}`);
      add(c, u, amount, causes);
    };
    class Order extends Probe {
      protected override engage(): void {
        order.push('script');
      }
    }
    engageEncounter(sim, new Order(), 'boss', 10, 'p_pull');
    expect(order).toEqual(['add:p_pull', 'add:a_first', 'add:p_pull', 'add:z_last', 'script']);
    expect(sim.players().map((p) => p.id)).toEqual(['a_first', 'p_pull', 'z_last']);
  });

  it('the first melee swing on the puller path happens at the first AI update', () => {
    const sim = newSim(true, true);
    class Swing extends Probe {
      override updateAI(ctx: BossContext): void {
        ctx.meleeIfReady();
      }
    }
    engageEncounter(sim, new Swing(), 'boss', 10, 'p_pull');
    sim.run();
    const swings = sim.trace.list().filter((e) => e.data.ability === 'melee' || e.kind === 'melee_avoided');
    expect(swings[0]?.t).toBe(10);
    expect(swings[1]?.t).toBe(2010);
  });

  it('a later threat gain by another player below 110 % does not displace the puller; above it does', () => {
    const victims = (other: number): unknown[] => {
      const sim = newSim();
      engageEncounter(sim, new Probe(), 'boss', 10, 'p_pull');
      threatFor(sim)!.add('boss', 'p_pull', 1000);
      threatFor(sim)!.add('boss', 'a_first', other);
      sim.run();
      return sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => e.data.target);
    };
    expect(victims(1099)).toEqual(['p_pull']);
    expect(victims(1101)).toEqual(['p_pull', 'a_first']);
  });
});
