import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { swingIntervalMs } from '../src/stats';
import { ThreatManager } from '../src/threat';

class Idle extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  protected engage(_ctx: BossContext): void {}
  protected executeEvent(): void {}
}

function newSim(maxDurationMs = 3000) {
  const sim = new Simulation({ seed: 20, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, level: 83, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31, melee: { minDamage: 10000, maxDamage: 10000, attackTimeMs: 2000 } });
  sim.addUnit({ id: 't1', name: 'T1', kind: 'player', role: 'tank', maxHealth: 1e7, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  attachBoss(sim, new Idle(), 'boss', 10);
  threat.add('boss', 't1', 1);
  const auras = [['inhaled', 30, 3, true], ['berserk', 150, 1, false], ['haste', 100, 1, false], ['slow', -50, 1, false]] as const;
  for (const [id, pct, maxStacks, perStack] of auras) {
    sim.catalog.addAura({ id, durationMs: null, maxStacks, modifiers: [{ kind: 'attack_speed_pct', pct, perStack }] });
  }
  return sim;
}

const swings = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === 'melee');

describe('attack speed (A-031)', () => {
  it('multiplies the swing interval by 100 / (100 + pct) per aura, truncated to whole ms', () => {
    const sim = newSim();
    const boss = sim.unit('boss');
    for (let i = 0; i < 3; i++) applyAura(sim, 'inhaled', 'boss', 'boss', []);
    expect(swingIntervalMs(boss)).toBe(1052);
    applyAura(sim, 'berserk', 'boss', 'boss', []);
    expect(swingIntervalMs(boss)).toBe(421);
  });

  it('a slow multiplies the interval by (100 + |pct|) / 100', () => {
    const sim = newSim();
    applyAura(sim, 'slow', 'boss', 'boss', []);
    expect(swingIntervalMs(sim.unit('boss'))).toBe(3000);
  });

  it('removing an aura restores the interval', () => {
    const sim = newSim();
    applyAura(sim, 'haste', 'boss', 'boss', []);
    expect(swingIntervalMs(sim.unit('boss'))).toBe(1000);
    removeAuras(sim, 'boss', 'haste', 'removed', []);
    expect(swingIntervalMs(sim.unit('boss'))).toBe(2000);
  });

  it('a new attack speed rescales the remaining swing time', () => {
    const sim = newSim();
    sim.at(1010, EventClass.SpellHit, () => void applyAura(sim, 'haste', 'boss', 'boss', []));
    sim.run();
    // Swing at 10 → next at 2010; at 1010 the remaining 1000 ms become 500 → 1510; then every 1000 ms.
    expect(swings(sim).map((e) => e.t)).toEqual([10, 1510, 2510]);
  });

  it('removing the haste rescales the remaining swing time back', () => {
    const sim = newSim(4000);
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'haste', 'boss', 'boss', []));
    sim.at(1260, EventClass.SpellHit, () => void removeAuras(sim, 'boss', 'haste', 'removed', []));
    sim.run();
    // Swing at 10 → 1010 (hasted), swing at 1010 → 2010; at 1260 the remaining 750 of 1000 ms are 75 %, so 1500 of 2000 → 2760.
    expect(swings(sim).map((e) => e.t)).toEqual([10, 1010, 2760]);
  });

  it('does not change the damage of a swing', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'haste', 'boss', 'boss', []));
    sim.run();
    expect(swings(sim).map((e) => [e.t, e.data.amount])).toEqual([[10, 10000], [1010, 10000], [2010, 10000]]);
  });
});
