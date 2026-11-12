import type { DataRegistry } from '@raid/data';
import { EventScriptedAI, removeAuras, type BossContext, type MechanicStatus, type Unit } from '@raid/engine';
import type { FestergutSpellName } from './spell-ids';

export const FESTERGUT_ID = 'festergut';

// Event ids as in boss_festergut.cpp 68–77.
const EVENT_BERSERK = 1;
const EVENT_INHALE_BLIGHT = 2;
const EVENT_VILE_GAS = 3;
const EVENT_GAS_SPORE = 4;
const EVENT_GASTRIC_BLOAT = 5;
/** EventMap group of Vile Gas (boss_festergut.cpp 126, 235), which Gas Spore delays (222). */
const GROUP_VILE_GAS = 1;

/** boss_festergut.cpp 63: the ambient blight applied after the first and the second inhale; none after the third. */
const GASEOUS_BLIGHT: readonly FestergutSpellName[] = ['gaseous_blight_large', 'gaseous_blight_medium', 'gaseous_blight_small'];

/** `DATA_INOCULATED_STACK` (boss_festergut.cpp 66): the highest Inoculated stack a player reached. */
export const DATA_INOCULATED_STACK = 69291;

const SOURCE = 'azerothcore_source' as const;
const HIT = 'spell hit and resist rolls are not modelled: the spell always lands in full';

export const FESTERGUT_MECHANICS: readonly MechanicStatus[] = [
  {
    key: 'festergut.gaseous_blight',
    status: 'partial',
    omissions: [
      HIT,
      'the gas visuals (FORCE_CAST 69126/69152/69154 on the gas dummy, NPC 36659) are left out: areas cannot filter by creature entry',
      'Professor Putricide is not a unit: the first gas is applied after a fixed delay (festergut.first_gas_delay_ms), without the map-update latency of his arrival',
      'the quest script of the damage spell (Residue Rendezvous) is left out',
      'RemoveBlight only acts when the gas dummy exists (boss_festergut.cpp 172); here every inhale removes the gas, as there is no gas dummy',
    ],
    validation: SOURCE,
  },
  { key: 'festergut.inhale_blight', status: 'implemented', omissions: [], validation: SOURCE },
  { key: 'festergut.pungent_blight', status: 'implemented', omissions: [], validation: SOURCE },
  {
    key: 'festergut.gas_spore',
    status: 'partial',
    omissions: [
      'the DUMMY aura of Gas Spore (effect 1, radius 0, no target) is left out',
      `Blighted Spores: ${HIT}`,
    ],
    validation: SOURCE,
  },
  {
    key: 'festergut.inoculated',
    status: 'partial',
    omissions: [
      'the PERIODIC_DUMMY effect of Inoculated (effect 1, value 0) is left out',
      'the achievement Flu Shot Shortage is not evaluated; the highest stack is recorded',
      'dead-player Inoculated: aura application on a dead target not traced past CheckCast (research §8)',
    ],
    validation: SOURCE,
  },
  {
    key: 'festergut.vile_gas',
    status: 'partial',
    omissions: [
      HIT,
      'the missile travel time (20 yd/s) is left out: Vile Gas lands at once',
      'the 1 s root of the splash (71288 effect 1) is left out',
      'the LINKED slow and confuse aura 69248 is left out',
      're-applying Vile Gas to a player who has it keeps the tick schedule; AzerothCore restarts it (A-009)',
      'the Vile Gas distance test is 2D here, 3D in the source (Unit.cpp 779–782)',
    ],
    validation: SOURCE,
  },
  { key: 'festergut.gastric_bloat', status: 'implemented', omissions: [], validation: SOURCE },
  {
    key: 'festergut.gastric_explosion',
    status: 'partial',
    omissions: ['Gastric Explosion is cast by a player and could crit; crits are not modelled (A-028)'],
    validation: SOURCE,
  },
  {
    key: 'festergut.melee',
    status: 'partial',
    omissions: ['no crits, crushing blows or block (A-022)', 'Festergut does not move: he does not chase his victim'],
    validation: SOURCE,
  },
  { key: 'festergut.berserk', status: 'implemented', omissions: [], validation: SOURCE },
  {
    key: 'festergut.emotes',
    status: 'not_implemented',
    omissions: ['boss emotes and yells are not emitted (EMOTE_WARN_GAS_SPORE, boss_festergut.cpp 218; EMOTE_WARN_PUNGENT_BLIGHT, 200; SAY_BERSERK, 194)'],
    validation: SOURCE,
  },
  {
    key: 'festergut.evade',
    status: 'not_implemented',
    omissions: [
      'Festergut never evades: CheckRequiredBosses with EnterEvadeMode at the engage (boss_festergut.cpp 116–120) and the evade Professor Putricide calls when Festergut is not in combat on his arrival (bCallEvade, boss_professor_putricide.cpp 434–437) are left out',
    ],
    validation: SOURCE,
  },
];

export interface FestergutTimers {
  readonly berserkMs: number;
  readonly inhaleFirst: readonly [number, number];
  readonly inhaleRepeatMs: number;
  readonly inhalesBeforePungent: number;
  readonly gasSporeFirst: readonly [number, number];
  readonly gasSporeRepeat: readonly [number, number];
  readonly gasSporeAfterPungent: readonly [number, number];
  readonly gasSporeTargets: number;
  readonly vileGasFirst: readonly [number, number];
  readonly vileGasRepeat: readonly [number, number];
  readonly vileGasFloorAfterSporeMs: number;
  readonly vileGasMinFarTargets: number;
  readonly vileGasFarDistanceYd: number;
  readonly gastricBloatFirst: readonly [number, number];
  readonly gastricBloatRepeat: readonly [number, number];
  readonly firstGasDelayMs: number;
}

/** Reads the script's timers and constants from the registry (`code` sources with their line in boss_festergut.cpp). */
export function festergutTimers(data: DataRegistry): FestergutTimers {
  const n = (key: string): number => data.num(`festergut.${key}`);
  const pair = (key: string): readonly [number, number] => [n(`${key}_min_ms`), n(`${key}_max_ms`)];
  return {
    berserkMs: n('berserk_ms'),
    inhaleFirst: pair('inhale_first'),
    inhaleRepeatMs: n('inhale_repeat_ms'),
    inhalesBeforePungent: n('inhales_before_pungent'),
    gasSporeFirst: pair('gas_spore_first'),
    gasSporeRepeat: pair('gas_spore_repeat'),
    gasSporeAfterPungent: pair('gas_spore_after_pungent'),
    gasSporeTargets: n('gas_spore_targets'),
    vileGasFirst: pair('vile_gas_first'),
    vileGasRepeat: pair('vile_gas_repeat'),
    vileGasFloorAfterSporeMs: n('vile_gas_floor_after_spore_ms'),
    vileGasMinFarTargets: n('vile_gas_min_far_targets'),
    vileGasFarDistanceYd: n('vile_gas_far_distance_yd'),
    gastricBloatFirst: pair('gastric_bloat_first'),
    gastricBloatRepeat: pair('gastric_bloat_repeat'),
    firstGasDelayMs: n('first_gas_delay_ms'),
  };
}

/** Port of boss_festergutAI (boss_festergut.cpp 89–267), 25-player normal. Heroic Malleable Goo is Gate 4. */
export class FestergutAI extends EventScriptedAI {
  readonly bossId = FESTERGUT_ID;
  readonly mechanics = FESTERGUT_MECHANICS;
  readonly knownServerDifferences: readonly string[] = [
    'Rising-Gods has not been compared yet (Gate 2): every timer and value is the AzerothCore baseline',
  ];
  private inhaleCounter = 0;
  private maxInoculatedStack = 0;
  /** Time left until Professor Putricide arrives and the first Gaseous Blight is applied; null once done. */
  private firstGasInMs: number | null = null;
  private engageEvent: readonly string[] = [];

  constructor(private readonly t: FestergutTimers) {
    super();
  }

  /** boss_festergut.cpp 254–258: only a higher stack is recorded. Called by the Blighted Spores aura script. */
  setData(type: number, value: number): void {
    if (type === DATA_INOCULATED_STACK && value > this.maxInoculatedStack) this.maxInoculatedStack = value;
  }

  /** boss_festergut.cpp 260–266. */
  getData(type: number): number {
    return type === DATA_INOCULATED_STACK ? this.maxInoculatedStack : 0;
  }

  /** JustEngagedWith (boss_festergut.cpp 114–139). The zone-in-combat of line 133 is done by the engine (A-033). */
  protected engage(ctx: BossContext, _who: Unit | null): void {
    const t = this.t;
    this.inhaleCounter = 0;
    this.maxInoculatedStack = 0;
    const ev = ctx.ai('engaged');
    this.engageEvent = [ev];
    this.events.schedule(EVENT_BERSERK, t.berserkMs);
    this.publishWindow(ctx, 'berserk', EVENT_BERSERK, t.berserkMs, t.berserkMs, [ev]);
    this.events.scheduleRange(EVENT_INHALE_BLIGHT, ...t.inhaleFirst);
    this.publishWindow(ctx, 'inhale_blight', EVENT_INHALE_BLIGHT, ...t.inhaleFirst, [ev]);
    this.events.scheduleRange(EVENT_GAS_SPORE, ...t.gasSporeFirst);
    this.publishWindow(ctx, 'gas_spore', EVENT_GAS_SPORE, ...t.gasSporeFirst, [ev]);
    this.events.scheduleRange(EVENT_VILE_GAS, ...t.vileGasFirst, GROUP_VILE_GAS);
    this.publishWindow(ctx, 'vile_gas', EVENT_VILE_GAS, ...t.vileGasFirst, [ev]);
    this.events.scheduleRange(EVENT_GASTRIC_BLOAT, ...t.gastricBloatFirst);
    this.publishWindow(ctx, 'gastric_bloat', EVENT_GASTRIC_BLOAT, ...t.gastricBloatFirst, [ev]);
    // Line 138: Putricide runs to his watch position; on arrival Festergut gets the large Gaseous Blight (A-036).
    this.firstGasInMs = t.firstGasDelayMs;
  }

  override updateAI(ctx: BossContext, diffMs: number): void {
    // Putricide's arrival is his own movement, not an event of Festergut's EventMap: casting does not hold it back.
    if (this.firstGasInMs !== null) {
      this.firstGasInMs -= diffMs;
      if (this.firstGasInMs <= 0) {
        this.firstGasInMs = null;
        const ev = ctx.ai('first_gas', {}, this.engageEvent);
        ctx.cast(GASEOUS_BLIGHT[0], ctx.self.id, [ev], { triggered: true });
      }
    }
    super.updateAI(ctx, diffMs);
  }

  /** The switch of UpdateAI (boss_festergut.cpp 190–249). */
  protected executeEvent(eventId: number, ctx: BossContext): void {
    const t = this.t;
    const self = ctx.self.id;
    switch (eventId) {
      case EVENT_BERSERK: {
        const ev = ctx.ai('berserk');
        ctx.cast('berserk', self, [ev], { triggered: true });
        ctx.clearTimer('berserk', [ev]);
        return;
      }
      case EVENT_INHALE_BLIGHT: {
        const ev = ctx.ai('inhale_blight', { inhales: this.inhaleCounter });
        // RemoveBlight (170–178).
        for (const aura of GASEOUS_BLIGHT) removeAuras(ctx.sim, self, aura, 'removed', [ev]);
        if (this.inhaleCounter === t.inhalesBeforePungent) {
          ctx.cast('pungent_blight', self, [ev]);
          this.inhaleCounter = 0;
          this.events.rescheduleRange(EVENT_GAS_SPORE, ...t.gasSporeAfterPungent);
          this.publishWindow(ctx, 'gas_spore', EVENT_GAS_SPORE, ...t.gasSporeAfterPungent, [ev]);
        } else {
          ctx.cast('inhale_blight', self, [ev]);
          this.inhaleCounter += 1;
          if (this.inhaleCounter < t.inhalesBeforePungent) ctx.cast(GASEOUS_BLIGHT[this.inhaleCounter], self, [ev], { triggered: true });
        }
        this.events.schedule(EVENT_INHALE_BLIGHT, t.inhaleRepeatMs);
        // The next inhale event casts Pungent Blight once the counter is full: the window carries that name.
        const next = this.inhaleCounter === t.inhalesBeforePungent ? 'pungent_blight' : 'inhale_blight';
        this.publishWindow(ctx, next, EVENT_INHALE_BLIGHT, t.inhaleRepeatMs, t.inhaleRepeatMs, [ev]);
        return;
      }
      case EVENT_GAS_SPORE: {
        const ev = ctx.ai('gas_spore');
        // CastCustomSpell with SPELLVALUE_MAX_TARGETS (220).
        ctx.cast('gas_spore', self, [ev], { maxTargets: t.gasSporeTargets, targetStream: `boss:${FESTERGUT_ID}.gas_spore.targets` });
        this.events.scheduleRange(EVENT_GAS_SPORE, ...t.gasSporeRepeat);
        this.publishWindow(ctx, 'gas_spore', EVENT_GAS_SPORE, ...t.gasSporeRepeat, [ev]);
        this.events.delayEventsToMax(t.vileGasFloorAfterSporeMs, GROUP_VILE_GAS);
        this.raiseWindow(ctx, EVENT_VILE_GAS, t.vileGasFloorAfterSporeMs, [ev]);
        return;
      }
      case EVENT_VILE_GAS: {
        // 226–234: prefer a player at least 5 yd away when at least 8 such players exist, else any player (research §5).
        const far = { minDistanceYd: t.vileGasFarDistanceYd, playersOnly: true };
        const farCount = ctx.countTargets(far);
        const target = ctx.selectTarget('vile_gas.targets', farCount >= t.vileGasMinFarTargets ? far : { playersOnly: true });
        const ev = ctx.ai('vile_gas', { farTargets: farCount, target: target?.id ?? null });
        if (target) ctx.cast('vile_gas', target.id, [ev]);
        this.events.scheduleRange(EVENT_VILE_GAS, ...t.vileGasRepeat, GROUP_VILE_GAS);
        this.publishWindow(ctx, 'vile_gas', EVENT_VILE_GAS, ...t.vileGasRepeat, [ev]);
        return;
      }
      case EVENT_GASTRIC_BLOAT: {
        const victim = ctx.victim();
        const ev = ctx.ai('gastric_bloat', { target: victim?.id ?? null });
        if (victim) ctx.cast('gastric_bloat', victim.id, [ev]);
        this.events.scheduleRange(EVENT_GASTRIC_BLOAT, ...t.gastricBloatRepeat);
        this.publishWindow(ctx, 'gastric_bloat', EVENT_GASTRIC_BLOAT, ...t.gastricBloatRepeat, [ev]);
        return;
      }
      default:
        return;
    }
  }
}
