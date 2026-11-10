export type Dictionary = Readonly<Record<string, string>>;

/** English templates per event kind. Ability names come from content dictionaries (`ability.<id>`). */
export const EN: Dictionary = {
  'event.engage': '{boss} engaged',
  'event.ai_event': '{boss}: {event}',
  'event.cast_start': '{caster} begins casting {spell} → {target}',
  'event.cast_success': '{caster} casts {spell} → {target}',
  'event.cast_failed': '{caster} fails to cast {spell} ({reason})',
  'event.cast_interrupted': '{unit} is interrupted casting {spell} ({reason})',
  'event.spell_hit': '{spell} hits {target}',
  'event.damage': '{source} {ability} hits {target} for {amount}',
  'event.heal': '{source} {ability} heals {target} for {amount}',
  'event.aura_applied': '{unit} gains {aura}',
  'event.aura_stack': '{unit} gains {aura} ({stacks})',
  'event.aura_removed': '{aura} fades from {unit} ({reason})',
  'event.periodic_tick': '{aura} ticks on {unit}',
  'event.move_start': '{unit} starts moving',
  'event.move_end': '{unit} stops moving',
  'event.rule_fired': '{actor} reacts: {rule}',
  'event.action_failed': '{actor} fails {action} ({reason})',
  'event.phase_change': 'Phase: {phase}',
  'event.timer_window': '{ability} expected between {earliestMs} and {latestMs}',
  'event.death': '{unit} dies',
  'event.outcome': 'Outcome: {kind}',
};
