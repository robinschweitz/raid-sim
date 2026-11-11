import { EventScriptedAI, applyAura, edgeDistance, threatFor, type BossContext, type BossModule, type MechanicStatus } from '@raid/engine';
import { TRAINING_DUMMY_DATA } from './data';

const EVENT_MARK = 1;
const ID = 'training_dummy';

class TrainingDummyAI extends EventScriptedAI {
  readonly bossId = ID;
  readonly mechanics: readonly MechanicStatus[] = [
    { key: 'training_dummy.mark', status: 'implemented', omissions: [], validation: 'unvalidated' },
    { key: 'training_dummy.melee', status: 'implemented', omissions: [], validation: 'unvalidated' },
  ];

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
    const eligible = ctx.threatList().filter((p) => edgeDistance(ctx.self, p, ctx.sim.now) <= this.rangeYd);
    const picked = ctx.pick('mark', eligible, 2);
    const ev = ctx.ai('mark', { eligible: eligible.map((u) => u.id), picked: picked.map((u) => u.id) });
    for (const u of picked) applyAura(ctx.sim, 'mark', ctx.self.id, u.id, [ev]);
    ctx.publishTimer('mark', this.intervalMs, this.intervalMs, [ev]);
    this.events.schedule(EVENT_MARK, this.intervalMs);
  }
}

export const trainingDummy: BossModule = {
  id: ID,
  data: TRAINING_DUMMY_DATA,
  overrides: [],
  setup({ sim, data }) {
    sim.addUnit({
      id: ID,
      name: 'Training Dummy',
      kind: 'creature',
      role: 'boss',
      level: data.num('training_dummy.level'),
      maxHealth: data.num('training_dummy.health'),
      pos: { x: 0, y: 0 },
      speedYdPerSec: data.num('training_dummy.speed_yd_s'),
      combatReach: data.num('training_dummy.combat_reach_yd'),
      boundingRadius: data.num('training_dummy.bounding_radius_yd'),
      melee: { minDamage: data.num('training_dummy.melee_min'), maxDamage: data.num('training_dummy.melee_max'), attackTimeMs: data.num('training_dummy.attack_time_ms') },
    });
    sim.catalog.addAura({ id: 'mark', durationMs: data.num('training_dummy.mark_duration_ms'), maxStacks: 1 });
    return {
      script: new TrainingDummyAI(data.num('training_dummy.mark_interval_ms'), data.num('training_dummy.mark_range_yd')),
      bossUnitId: ID,
      pull(s) {
        const threat = threatFor(s)!;
        const tank = s.players().find((p) => p.role === 'tank');
        if (tank) threat.add(ID, tank.id, 1);
        for (const p of s.players()) threat.add(ID, p.id, 0);
      },
    };
  },
};
