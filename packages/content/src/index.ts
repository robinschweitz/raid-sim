import type { ContentRegistry } from '@raid/engine';
import { genericCaster } from './generic/caster';
import { genericHealer } from './generic/healer';
import { festergut } from './festergut/boss';
import { FESTERGUT_CHECKS } from './festergut/checks';
import { FESTERGUT_TEXT_EN } from './festergut/text';
import { trainingDummy } from './training-dummy/boss';
import { trainingCaster } from './training-dummy/caster';
export * from './spelldata/file';
export * from './spelldata/variants';
export * from './spelldata/entries';

export const CONTENT: ContentRegistry = {
  bosses: new Map([
    [festergut.id, festergut],
    [trainingDummy.id, trainingDummy],
  ]),
  policies: new Map([
    [genericCaster.spec, genericCaster],
    [genericHealer.spec, genericHealer],
    [trainingCaster.spec, trainingCaster],
  ]),
  actions: new Map(),
  checks: new Map(FESTERGUT_CHECKS),
};

/** English names of content abilities and scenario texts, for the formatter. */
export const CONTENT_TEXT_EN: Readonly<Record<string, string>> = {
  ...FESTERGUT_TEXT_EN,
  'ability.mark': 'Mark of the Dummy',
  'ability.melee': 'Melee',
  'ability.training_bolt': 'Training Bolt',
  'ability.standin_damage': 'attack',
  'ability.standin_heal': 'heal',
  'ability.caster_bolt': 'Bolt',
  'ability.healer_heal': 'Heal',
  'scenario.training_dummy_clean.observation': 'The dummy marks two players in range every 12 seconds; marked players run out of range.',
};
