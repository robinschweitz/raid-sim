import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, makeBossContext, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

class TestAI extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [
    { key: 'test.channel', status: 'implemented', omissions: [], validation: 'unvalidated' },
  ];
  protected engage(_ctx: BossContext): void {
    this.events.schedule(1, 1000);
    this.events.schedule(2, 1500);
    this.events.schedule(3, 2500);
  }
  protected executeEvent(id: number, ctx: BossContext): void {
    const ev = ctx.ai(`event_${id}`);
    if (id === 1) ctx.cast('channel', ctx.self.id, [ev]);
  }
}

function newSim(withVictim = true) {
  const sim = new Simulation({ seed: 11, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  for (const id of ['p1', 'p2', 'p3']) {
    sim.addUnit({ id, name: id, kind: 'player', role: 'ranged', maxHealth: 1000, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  }
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  if (withVictim) threat.add('boss', 'p1', 100);
  sim.catalog.addSpell({ id: 'channel', castTimeMs: 2000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
  return sim;
}

const aiEvents = (sim: Simulation) =>
  sim.trace
    .list()
    .filter((e) => e.kind === 'ai_event')
    .map((e) => [e.t, e.data.event]);

describe('boss AI (§5.1)', () => {
  it('timers advance while casting, nothing executes while casting, one event per update', () => {
    const sim = newSim();
    attachBoss(sim, new TestAI(), 'boss', 10);
    sim.run();
    expect(aiEvents(sim)).toEqual([
      [1000, 'event_1'],
      [3000, 'event_2'],
      [3010, 'event_3'],
    ]);
  });

  it('does nothing without a victim', () => {
    const sim = newSim(false);
    attachBoss(sim, new TestAI(), 'boss', 10);
    sim.run();
    expect(aiEvents(sim)).toEqual([]);
  });

  it('publishes timer windows and uses one random stream per mechanic', () => {
    const sim = newSim();
    const holder: { ctx: BossContext | null } = { ctx: null };
    class Probe extends TestAI {
      protected engage(ctx: BossContext): void {
        holder.ctx = ctx;
      }
    }
    attachBoss(sim, new Probe(), 'boss', 10);
    const ctx = holder.ctx!;
    ctx.publishTimer('gas_spore', 20000, 25000, []);
    expect(sim.timerWindows.get('boss|gas_spore')).toEqual({ boss: 'boss', ability: 'gas_spore', earliestMs: 20000, latestMs: 25000 });
    const picked = ctx.pick('gas_spore', sim.players(), 2).map((u) => u.id);
    const expected = new Simulation({ seed: 11, maxDurationMs: 1, sampleIntervalMs: 1 }).rng
      .stream('boss:boss.gas_spore')
      .pick(sim.players(), 2)
      .map((u) => u.id);
    expect(picked).toEqual(expected);
  });

  it('throws when the same boss is attached twice', () => {
    const sim = newSim();
    attachBoss(sim, new TestAI(), 'boss', 10);
    expect(() => attachBoss(sim, new TestAI(), 'boss', 10)).toThrow('boss boss is already attached');
  });

  it('emits no ai_event after the boss dies', () => {
    const sim = newSim();
    class Repeater extends TestAI {
      protected engage(_ctx: BossContext): void {
        this.events.schedule(1, 100);
      }
      protected executeEvent(_id: number, ctx: BossContext): void {
        ctx.ai('tick');
        this.events.schedule(1, 100);
      }
    }
    attachBoss(sim, new Repeater(), 'boss', 10);
    sim.at(1050, EventClass.SpellHit, () => {
      sim.unit('boss').alive = false;
    });
    sim.run();
    const ts = aiEvents(sim).map((e) => e[0] as number);
    expect(ts.length).toBeGreaterThan(0);
    expect(Math.max(...ts)).toBeLessThanOrEqual(1050);
  });

  it('rejects non-positive and non-integer update intervals', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() => attachBoss(newSim(), new TestAI(), 'boss', bad)).toThrow('AI update interval must be a positive integer');
    }
  });

  it('setPhase sets the phase and emits phase_change', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    ctx.setPhase('p2', []);
    expect(sim.phase).toBe('p2');
    const ev = sim.trace.list().filter((e) => e.kind === 'phase_change');
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({ boss: 'boss', phase: 'p2' });
  });
});
