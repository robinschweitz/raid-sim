import type { ContentRegistry } from '@raid/engine';
import { trainingDummy } from './training-dummy/boss';
import { trainingCaster } from './training-dummy/caster';
export * from './spelldata/file';
export * from './spelldata/variants';
export * from './spelldata/entries';

export const CONTENT: ContentRegistry = {
  bosses: new Map([[trainingDummy.id, trainingDummy]]),
  policies: new Map([[trainingCaster.spec, trainingCaster]]),
  actions: new Map(),
  checks: new Map(),
};

/** English names of content abilities and scenario texts, for the formatter. */
export const CONTENT_TEXT_EN: Readonly<Record<string, string>> = {
  'ability.mark': 'Mark of the Dummy',
  'ability.melee': 'Melee',
  'ability.training_bolt': 'Training Bolt',
  'ability.standin_damage': 'attack',
  'ability.standin_heal': 'heal',
  'scenario.training_dummy_clean.observation': 'The dummy marks two players in range every 12 seconds; marked players run out of range.',
};
