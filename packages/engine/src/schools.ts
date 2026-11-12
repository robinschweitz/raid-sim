import type { School, SchoolSet } from './catalog';

/** SpellSchoolMask bits (SharedDefines.h lines 288–290 at the pinned commit). */
export const SCHOOL_BITS: Readonly<Record<School, number>> = {
  physical: 1,
  holy: 2,
  fire: 4,
  nature: 8,
  frost: 16,
  shadow: 32,
  arcane: 64,
};

const ORDER: readonly School[] = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'];

/** SPELL_SCHOOL_MASK_ALL. */
export const ALL_SCHOOLS_MASK = 127;

export function schoolMask(s: SchoolSet): number {
  const list: readonly School[] = typeof s === 'string' ? [s] : s;
  let mask = 0;
  for (const school of list) {
    const bit = SCHOOL_BITS[school];
    if (bit === undefined) throw new Error(`unknown school ${school}`);
    mask |= bit;
  }
  if (mask === 0) throw new Error('a school set needs at least one school');
  return mask;
}

/** The schools of a SpellSchoolMask, in bit order. */
export function schoolsOfMask(mask: number): School[] {
  if (!Number.isInteger(mask) || mask <= 0 || mask > ALL_SCHOOLS_MASK) throw new Error(`invalid school mask ${mask}`);
  return ORDER.filter((s) => (mask & SCHOOL_BITS[s]) !== 0);
}

/** Misc-value mask matching (Unit.cpp 6116–6124): two school sets match when they share a school. */
export function overlaps(a: SchoolSet, b: SchoolSet): boolean {
  return (schoolMask(a) & schoolMask(b)) !== 0;
}

/** Trace label: the school name, or several joined by '+' in bit order ('nature+shadow'). */
export function schoolLabel(s: SchoolSet): string {
  return schoolsOfMask(schoolMask(s)).join('+');
}
