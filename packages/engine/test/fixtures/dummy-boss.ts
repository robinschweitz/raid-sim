import { applyAura } from '../../src/auras';
import { EventScriptedAI, type BossContext, type MechanicStatus } from '../../src/boss';
import { edgeDistance } from '../../src/movement';
import type { BossModule } from '../../src/run';
import { threatFor } from '../../src/threat';

const FILE = 'packages/engine/test/fixtures/dummy-boss.ts';
const configured = { kind: 'configured', file: FILE } as const;

export const DUMMY_DATA = [
  { key: 'dummy.pick_interval_ms', value: 12000, source: configured },
  { key: 'dummy.pick_range_yd', value: 30, source: configured },
  { key: 'dummy.mark_duration_ms', value: 3000, source: configured },
  { key: 'dummy.guess', value: 1, source: { kind: 'assumption', rationale: 'fixture assumption', confirmBy: 'never: test fixture' } },
];

const EVENT_MARK = 1;

/** Every interval, marks two random players within range of the boss. */
class DummyAI extends EventScriptedAI {
  readonly bossId = 'dummy';
  readonly mechanics: readonly MechanicStatus[] = [
    { key: 'dummy.mark', status: 'implemented', omissions: [], validation: 'unvalidated' },
    { key: 'dummy.cleave', status: 'partial', omissions: ['cleave arc not modelled'], validation: 'unvalidated' },
  ];
  readonly knownServerDifferences: readonly string[] = ['fixture: no real server'];

  constructor(
    private readonly intervalMs: number,
    private readonly rangeYd: number,
  ) {
    super();
  }

  protected engage(_ctx: BossContext): void {
    this.events.schedule(EVENT_MARK, this.intervalMs);
  }

  protected executeEvent(id: number, ctx: BossContext): void {
    if (id !== EVENT_MARK) return;
    const eligible = ctx.sim.players().filter((p) => p.alive && edgeDistance(ctx.self, p, ctx.sim.now) <= this.rangeYd);
    const picked = ctx.pick('mark', eligible, 2);
    const ev = ctx.ai('mark', { eligible: eligible.map((u) => u.id), picked: picked.map((u) => u.id) });
    for (const u of picked) applyAura(ctx.sim, 'mark', ctx.self.id, u.id, [ev]);
    ctx.publishTimer('mark', this.intervalMs, this.intervalMs, [ev]);
    this.events.schedule(EVENT_MARK, this.intervalMs);
  }
}

export const dummyBoss: BossModule = {
  id: 'dummy',
  data: DUMMY_DATA,
  overrides: [],
  setup({ sim, data }) {
    sim.addUnit({ id: 'dummy', name: 'Training Dummy', kind: 'creature', role: 'boss', maxHealth: 10000000, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
    sim.catalog.addAura({ id: 'mark', durationMs: data.num('dummy.mark_duration_ms'), maxStacks: 1 });
    data.num('dummy.guess');
    return {
      script: new DummyAI(data.num('dummy.pick_interval_ms'), data.num('dummy.pick_range_yd')),
      bossUnitId: 'dummy',
      pull(s) {
        const tank = s.players().find((p) => p.role === 'tank');
        const threat = threatFor(s)!;
        if (tank) threat.add('dummy', tank.id, 1);
        for (const p of s.players()) threat.add('dummy', p.id, 0);
      },
    };
  },
};
