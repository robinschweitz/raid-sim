import type { DataRegistry } from '@raid/data';
import type { BossScript } from './boss';
import type { Simulation } from './sim';

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
}

export function collectLimitations(sim: Simulation, data: DataRegistry, scripts: readonly BossScript[]): Limitations {
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
  };
}
