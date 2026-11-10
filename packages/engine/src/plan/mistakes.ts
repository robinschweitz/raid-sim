import type { Mistake, Plan } from './schema';

/** Returns the effective plan; the base plan is not changed. */
export function applyMistakes(plan: Plan, mistakes: readonly Mistake[]): Plan {
  const out: Plan = structuredClone(plan);
  for (const mk of mistakes) {
    switch (mk.type) {
      case 'disable_rule':
        out.rules = out.rules.filter((r) => r.id !== mk.rule);
        break;
      case 'exclude_from_rule':
        for (const r of out.rules) if (r.id === mk.rule) r.who = r.who.filter((w) => w !== mk.player);
        break;
      case 'set_stack_threshold':
        for (const r of out.rules) if (r.id === mk.rule && r.when.on === 'aura_stacks') r.when = { ...r.when, atLeast: mk.atLeast };
        break;
      case 'reaction':
        out.roster = out.roster.map((m) => (m.id === mk.player ? { ...m, reaction: { minMs: mk.minMs, maxMs: mk.maxMs } } : m));
        break;
    }
  }
  out.rules = out.rules.filter((r) => r.who.length > 0);
  return out;
}
