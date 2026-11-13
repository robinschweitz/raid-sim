import { DataRegistry } from '@raid/data';
import { CORE_DATA, Simulation, ThreatManager, engageEncounter, installCoreRules, type Role, type TraceEvent } from '@raid/engine';
import type { FestergutAI } from '../../src/festergut/ai';
import { festergut } from '../../src/festergut/boss';

/** Festergut's spawn (creature.sql line 138459); test players are placed relative to it. */
export const BOSS = { x: 4267.92, y: 3137.26 };

export interface TestPlayer {
  readonly id: string;
  readonly role?: Exclude<Role, 'boss' | 'add'>;
  /** Position relative to Festergut, in yards. */
  readonly dx: number;
  readonly dy: number;
  readonly maxHealth?: number;
  readonly armor?: number;
}

export interface FightOptions {
  readonly seed?: number;
  readonly maxDurationMs: number;
  readonly players: readonly TestPlayer[];
}

/** The tank in melee range and `count` players on a circle of `radius` yards around Festergut, ids r01, r02, … */
export function ring(count: number, radius: number, extra: readonly TestPlayer[] = []): TestPlayer[] {
  const out: TestPlayer[] = [{ id: 't1', role: 'tank', dx: 0, dy: -9.5 }];
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    out.push({ id: `r${String(i + 1).padStart(2, '0')}`, role: 'ranged', dx: radius * Math.cos(a), dy: radius * Math.sin(a) });
  }
  return [...out, ...extra];
}

/**
 * A Festergut fight without a plan: the boss module is set up as in a run, the players only stand where they are put.
 * They have 100 million health unless a test says otherwise, so the boss's behaviour can be watched undisturbed.
 */
export function newFight(options: FightOptions) {
  const data = new DataRegistry([...CORE_DATA, ...festergut.data]);
  const sim = new Simulation({ seed: options.seed ?? 1, maxDurationMs: options.maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  new ThreatManager(sim, data.num('core.threat_update_interval_ms')).install();
  const setup = festergut.setup({ sim, data, difficulty: '25n' });
  for (const p of options.players) {
    sim.addUnit({
      id: p.id,
      name: p.id,
      kind: 'player',
      role: p.role ?? 'ranged',
      maxHealth: p.maxHealth ?? 100_000_000,
      armor: p.armor ?? 0,
      pos: { x: BOSS.x + p.dx, y: BOSS.y + p.dy },
      speedYdPerSec: data.num('core.player_run_speed_yd_s'),
      combatReach: data.num('core.player_combat_reach_yd'),
      boundingRadius: data.num('core.player_bounding_radius_yd'),
    });
  }
  engageEncounter(sim, setup.script, setup.bossUnitId, data.num('core.ai_update_interval_ms'), setup.puller!(sim));
  const events = (kind: TraceEvent['kind'], where: Readonly<Record<string, unknown>> = {}): TraceEvent[] =>
    sim.trace.list().filter((e) => e.kind === kind && Object.entries(where).every(([k, v]) => e.data[k] === v));
  return { sim, data, ai: setup.script as FestergutAI, boss: sim.unit(setup.bossUnitId), events };
}
