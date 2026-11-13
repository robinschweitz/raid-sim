import type { DataRegistry, Difficulty } from '@raid/data';
import rawSpellData from '../../data/spelldata/festergut.json';
import { spellKey } from '../spelldata/entries';
import { parseSpellDataFile, type SpellDataFile } from '../spelldata/file';
import { SpellVariants } from '../spelldata/variants';

/** The client spell extraction for this fight (docs/sources.md, "Spell data"). */
export const FESTERGUT_SPELL_FILE: SpellDataFile = parseSpellDataFile(rawSpellData);

/**
 * Engine id → base spell id as the AzerothCore scripts name it (boss_festergut.cpp 48–54 and 63, icecrown_citadel.h 48;
 * the others are reached through trigger fields of the spell data). The engine id does not depend on the difficulty.
 */
export const FESTERGUT_BASE_IDS = {
  inhale_blight: 69165,
  inhaled_blight: 69166,
  pungent_blight: 69195,
  gaseous_blight_large: 69157,
  gaseous_blight_medium: 69162,
  gaseous_blight_small: 69164,
  gaseous_blight_large_damage: 69159,
  gaseous_blight_medium_damage: 69161,
  gaseous_blight_small_damage: 69163,
  gas_spore: 69278,
  gas_spore_carrier: 69279,
  blighted_spores: 69290,
  inoculated: 69291,
  vile_gas: 69240,
  vile_gas_splash: 69244,
  gastric_bloat: 72219,
  gastric_explosion: 72227,
  berserk: 47008,
} as const;

export type FestergutSpellName = keyof typeof FESTERGUT_BASE_IDS;

const DIFFICULTIES: readonly Difficulty[] = ['10n', '25n', '10h', '25h'];
const NAMES = Object.keys(FESTERGUT_BASE_IDS) as FestergutSpellName[];

/**
 * The fight's spells for one difficulty: resolves base ids to their difficulty variant like GetSpellIdForDifficulty
 * (SpellMgr.cpp 538–578), and maps any numeric id of a spell (base or variant) to its engine id. Spell and aura scripts
 * get this object, so their lookups work like the script's `sSpellMgr->GetSpellIdForDifficulty(...)` calls.
 */
export class FestergutSpells {
  private readonly variants = new SpellVariants(FESTERGUT_SPELL_FILE);
  private readonly names = new Map<number, FestergutSpellName>();

  constructor(readonly difficulty: Difficulty) {
    for (const name of NAMES) {
      const base = FESTERGUT_BASE_IDS[name];
      for (const id of [base, ...DIFFICULTIES.map((d) => this.variants.variantFor(base, d))]) {
        const known = this.names.get(id);
        if (known && known !== name) throw new Error(`spell ${id} belongs to ${known} and ${name}`);
        this.names.set(id, name);
      }
    }
  }

  /** The numeric spell id used in this difficulty. */
  variant(name: FestergutSpellName): number {
    return this.variants.variantFor(FESTERGUT_BASE_IDS[name], this.difficulty);
  }

  /** Every numeric id used in this difficulty, sorted. */
  variantIds(): number[] {
    return NAMES.map((n) => this.variant(n)).sort((a, b) => a - b);
  }

  /** The engine id of a numeric spell id (base or any difficulty variant). */
  id(spellId: number): FestergutSpellName {
    const name = this.names.get(spellId);
    if (!name) throw new Error(`spell ${spellId} is not part of the Festergut fight`);
    return name;
  }

  /** Data key of a field of the spell's variant in this difficulty. */
  key(name: FestergutSpellName, field: string): string {
    return spellKey(this.variant(name), field);
  }

  /** Reads a numeric spell field through the registry, so the access is recorded with its source. */
  num(data: DataRegistry, name: FestergutSpellName, field: string): number {
    return data.num(this.key(name, field));
  }
}
