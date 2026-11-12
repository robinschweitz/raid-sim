import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/catalog';

const self = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self' } as const;

describe('catalog reference check', () => {
  it('is empty when every referenced spell and aura exists', () => {
    const c = new Catalog();
    c.addAura({ id: 'a1', durationMs: 1000, maxStacks: 1 });
    c.addSpell({ ...self, id: 's1', effects: [{ type: 'apply_aura', aura: 'a1' }] });
    c.addSpell({ ...self, id: 's2', effects: [{ type: 'trigger_spell', spell: 's1', on: 'caster' }, { type: 'force_cast', spell: 's1' }] });
    expect(c.unresolvedReferences()).toEqual([]);
  });

  it('finds unknown ids in every effect kind, including nested and aura effects', () => {
    const c = new Catalog();
    c.addSpell({ ...self, id: 's1', effects: [{ type: 'trigger_spell', spell: 'nope1', on: 'caster' }] });
    c.addSpell({
      ...self,
      id: 's2',
      effects: [
        { type: 'area', radius: 5, center: 'caster', relation: 'any', effects: [{ type: 'force_cast', spell: 'nope2' }, { type: 'apply_aura', aura: 'nope3' }] },
        { type: 'on_caster', effects: [{ type: 'remove_aura', aura: 'nope4' }] },
      ],
    });
    c.addAura({
      id: 'a1',
      durationMs: 1000,
      maxStacks: 1,
      periodic: { intervalMs: 500, effects: [{ type: 'periodic_trigger', spell: 'nope5' }, { type: 'area', radius: 3, center: 'target', relation: 'ally', effects: [{ type: 'apply_aura', aura: 'nope6' }] }] },
      onExpire: [{ type: 'on_caster', effects: [{ type: 'force_cast', spell: 'nope7' }] }],
    });
    expect(c.unresolvedReferences()).toEqual([
      { owner: 'aura a1', kind: 'aura', id: 'nope6' },
      { owner: 'aura a1', kind: 'spell', id: 'nope5' },
      { owner: 'aura a1', kind: 'spell', id: 'nope7' },
      { owner: 'spell s1', kind: 'spell', id: 'nope1' },
      { owner: 'spell s2', kind: 'aura', id: 'nope3' },
      { owner: 'spell s2', kind: 'aura', id: 'nope4' },
      { owner: 'spell s2', kind: 'spell', id: 'nope2' },
    ]);
  });
});
