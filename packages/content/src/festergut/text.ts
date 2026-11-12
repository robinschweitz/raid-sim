/** English names of Festergut's spells and auras (`ability.<engine id>`) and the texts of the Festergut scenarios. */
export const FESTERGUT_TEXT_EN: Readonly<Record<string, string>> = {
  'ability.inhale_blight': 'Inhale Blight',
  'ability.inhaled_blight': 'Inhaled Blight',
  'ability.pungent_blight': 'Pungent Blight',
  'ability.gaseous_blight_large': 'Gaseous Blight (strong)',
  'ability.gaseous_blight_medium': 'Gaseous Blight (medium)',
  'ability.gaseous_blight_small': 'Gaseous Blight (weak)',
  'ability.gaseous_blight_large_damage': 'Gaseous Blight (strong)',
  'ability.gaseous_blight_medium_damage': 'Gaseous Blight (medium)',
  'ability.gaseous_blight_small_damage': 'Gaseous Blight (weak)',
  'ability.gas_spore': 'Gas Spore',
  'ability.gas_spore_carrier': 'Gas Spore',
  'ability.blighted_spores': 'Blighted Spores',
  'ability.inoculated': 'Inoculated',
  'ability.vile_gas': 'Vile Gas',
  'ability.vile_gas_splash': 'Vile Gas (splash)',
  'ability.gastric_bloat': 'Gastric Bloat',
  'ability.gastric_explosion': 'Gastric Explosion',
  'ability.berserk': 'Berserk',
  'scenario.festergut_clean_kill.observation':
    'A clean kill before the berserk: the raid stacks for every Gas Spore, so everyone has three Inoculated stacks when Pungent Blight hits, and the tanks swap at nine Gastric Bloat stacks.',
  'scenario.festergut_missed_spore_group.observation':
    'One ranged player stays out when the raid stacks for the Gas Spores: without Inoculated, Pungent Blight hits that player for its full damage.',
  'scenario.festergut_late_tank_swap.observation':
    'The tank swap is set to ten Gastric Bloat stacks instead of nine: the tenth stack is Gastric Explosion, which kills the tank and hits everyone within 10 yards.',
  'scenario.festergut.note.first_spores': 'Gas Spore: three random players carry a spore that explodes after 12 seconds. Everyone within 8 yards of a carrier gets Blighted Spores and, when it ends, one Inoculated stack.',
  'scenario.festergut.note.pungent_blight': 'Pungent Blight: about 50,000 shadow damage to everyone; each Inoculated stack takes off a quarter.',
  'scenario.festergut.note.tank_swap': 'The second tank taunts at nine Gastric Bloat stacks.',
  'scenario.festergut.note.stays_out': 'This player does not run in and misses the spores.',
  'scenario.festergut.note.gastric_explosion': 'The tenth Gastric Bloat stack: Gastric Explosion.',
};
