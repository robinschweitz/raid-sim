import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, victimOf, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { Simulation } from '../src/sim';

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
  if (withVictim) sim.unit('boss').threat.set('p1', 100);
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

  it('picks the victim by highest threat, ties by id, skipping the dead', () => {
    const sim = newSim(false);
    const boss = sim.unit('boss');
    boss.threat.set('p3', 50);
    boss.threat.set('p2', 50);
    expect(victimOf(sim, 'boss')?.id).toBe('p2');
    sim.unit('p2').alive = false;
    expect(victimOf(sim, 'boss')?.id).toBe('p3');
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
});
