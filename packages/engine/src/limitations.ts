import type { DataRegistry } from '@raid/data';
import type { BossScript } from './boss';
import type { Member } from './plan/schema';
import type { Simulation } from './sim';
import { byId } from './units';

export interface Limitations {
  readonly standIns: readonly string[];
  readonly assumptions: readonly { readonly key: string; readonly rationale: string; readonly confirmBy: string }[];
  readonly partialMechanics: readonly {
    readonly boss: string;
    readonly key: string;
    readonly status: string;
    readonly omissions: readonly string[];
  }[];
  readonly knownServerDifferences: readonly string[];
  readonly unappliedOverrides: readonly string[];
  /**
   * Profile values the plan sets for its stand-ins (spec §6.3): health and rate always, armor, avoidance and threat only
   * when they differ from the defaults. Sorted by unit id, then in field order.
   */
  readonly profileValues: readonly ProfileValue[];
}

export interface ProfileValue {
  readonly unit: string;
  readonly field: string;
  readonly value: number;
  readonly reason: string;
}

export const DEFAULT_PROFILE_REASON = 'stand-in profile set by the plan (spec §6.3)';

function profileValues(roster: readonly Member[]): ProfileValue[] {
  const out: ProfileValue[] = [];
  for (const m of [...roster].sort(byId)) {
    if (m.kind !== 'standin') continue;
    const reason = m.reason ?? DEFAULT_PROFILE_REASON;
    const add = (field: string, value: number): void => void out.push({ unit: m.id, field, value, reason });
    add('maxHealth', m.maxHealth);
    add('ratePerSecond', m.ratePerSecond);
    if (m.armor !== 0) add('armor', m.armor);
    const a = m.avoidance;
    if (a.missPct !== 0) add('avoidance.missPct', a.missPct);
    if (a.dodgePct !== 0) add('avoidance.dodgePct', a.dodgePct);
    if (a.parryPct !== 0) add('avoidance.parryPct', a.parryPct);
    if (m.threatMultiplier !== 1) add('threatMultiplier', m.threatMultiplier);
  }
  return out;
}

export function collectLimitations(sim: Simulation, data: DataRegistry, scripts: readonly BossScript[], roster: readonly Member[] = []): Limitations {
  return {
    standIns: sim.sortedUnits((u) => u.approximate).map((u) => u.id),
    assumptions: data
      .accessedEntries()
      .flatMap((r) => (r.source.kind === 'assumption' ? [{ key: r.key, rationale: r.source.rationale, confirmBy: r.source.confirmBy }] : [])),
    partialMechanics: scripts.flatMap((s) =>
      s.mechanics
        .filter((m) => m.status !== 'implemented')
        .map((m) => ({ boss: s.bossId, key: m.key, status: m.status, omissions: [...m.omissions] })),
    ),
    knownServerDifferences: scripts.flatMap((s) => [...s.knownServerDifferences]),
    unappliedOverrides: data.knownUnappliedOverrides(),
    profileValues: profileValues(roster),
  };
}
