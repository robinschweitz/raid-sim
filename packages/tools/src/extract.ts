import { difficultyVariants, type ClientSpellData } from '@raid/data';

export interface ExtractedFile {
  readonly name: string;
  readonly sha256: string;
  readonly dataVersion: string;
}

export interface ExtractedEffect {
  readonly index: number;
  readonly effect: number;
  readonly basePoints: number;
  readonly dieSides: number;
  readonly implicitTargetA: number;
  readonly implicitTargetB: number;
  readonly applyAuraName: number;
  readonly amplitude: number;
  readonly chainTarget: number;
  readonly miscValue: number;
  readonly triggerSpell: number;
  readonly radiusIndex: number;
  readonly radiusYd: { readonly radius: number; readonly max: number } | null;
}

export interface ExtractedSpell {
  readonly id: number;
  readonly name: string;
  readonly attributes: number;
  readonly attributesEx: number;
  readonly schoolMask: number;
  readonly dmgClass: number;
  readonly castTimeMs: number | null;
  readonly durationMs: { readonly base: number; readonly perLevel: number; readonly max: number } | null;
  readonly rangeYd: { readonly minHostile: number; readonly minFriendly: number; readonly maxHostile: number; readonly maxFriendly: number } | null;
  readonly speed: number;
  readonly stackAmount: number;
  readonly recoveryTime: number;
  readonly categoryRecoveryTime: number;
  readonly startRecoveryTime: number;
  readonly maxAffectedTargets: number;
  readonly procFlags: number;
  readonly procChance: number;
  readonly interruptFlags: number;
  readonly auraInterruptFlags: number;
  readonly effects: readonly ExtractedEffect[];
  readonly difficultyVariants: readonly number[] | null;
}

export interface Extraction {
  readonly client: '3.3.5a (12340)';
  readonly files: readonly ExtractedFile[];
  readonly spells: readonly ExtractedSpell[];
  readonly missing: readonly number[];
}

export function dataVersionOf(fileName: string, sha256: string): string {
  return `client-12340:${fileName}:${sha256.slice(0, 12)}`;
}

/** Extracts the root spells plus every triggered spell and difficulty variant they reach. */
export function extractSpells(data: ClientSpellData, files: readonly ExtractedFile[], roots: readonly number[]): Extraction {
  const seen = new Set<number>();
  const missing = new Set<number>();
  const queue = [...roots];
  const out: ExtractedSpell[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === 0 || seen.has(id)) continue;
    seen.add(id);
    const s = data.spells.get(id);
    if (!s) {
      missing.add(id);
      continue;
    }
    const variants = difficultyVariants(data, id);
    if (variants) queue.push(...variants);
    const effects: ExtractedEffect[] = [];
    s.effects.forEach((e, index) => {
      if (e.effect === 0) return;
      if (e.triggerSpell !== 0) queue.push(e.triggerSpell);
      const r = e.radiusIndex ? data.radius.get(e.radiusIndex) : undefined;
      effects.push({
        index,
        effect: e.effect,
        basePoints: e.basePoints,
        dieSides: e.dieSides,
        implicitTargetA: e.implicitTargetA,
        implicitTargetB: e.implicitTargetB,
        applyAuraName: e.applyAuraName,
        amplitude: e.amplitude,
        chainTarget: e.chainTarget,
        miscValue: e.miscValue,
        triggerSpell: e.triggerSpell,
        radiusIndex: e.radiusIndex,
        radiusYd: r ? { radius: r.radius, max: r.max } : null,
      });
    });
    const range = data.ranges.get(s.rangeIndex);
    out.push({
      id: s.id,
      name: s.name,
      attributes: s.attributes,
      attributesEx: s.attributesEx,
      schoolMask: s.schoolMask,
      dmgClass: s.dmgClass,
      castTimeMs: data.castTimes.get(s.castingTimeIndex)?.castTime ?? null,
      durationMs: data.duration.get(s.durationIndex) ?? null,
      rangeYd: range
        ? { minHostile: range.minHostile, minFriendly: range.minFriendly, maxHostile: range.maxHostile, maxFriendly: range.maxFriendly }
        : null,
      speed: s.speed,
      stackAmount: s.stackAmount,
      recoveryTime: s.recoveryTime,
      categoryRecoveryTime: s.categoryRecoveryTime,
      startRecoveryTime: s.startRecoveryTime,
      maxAffectedTargets: s.maxAffectedTargets,
      procFlags: s.procFlags,
      procChance: s.procChance,
      interruptFlags: s.interruptFlags,
      auraInterruptFlags: s.auraInterruptFlags,
      effects,
      difficultyVariants: variants ? [...variants] : null,
    });
  }
  out.sort((a, b) => a.id - b.id);
  return { client: '3.3.5a (12340)', files: [...files], spells: out, missing: [...missing].sort((a, b) => a - b) };
}
