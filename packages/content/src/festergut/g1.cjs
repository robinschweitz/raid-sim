const edit=require('./e.cjs');
edit('src/run.ts',[
["  const controllers: ActorController[] = [];\n  for (const m of plan.roster) {","  // Roster order must not matter (§8.7): everything below walks the roster sorted by id.\n  const roster = [...plan.roster].sort(byId);\n  const controllers: ActorController[] = [];\n  for (const m of roster) {"],
["for (const m of plan.roster) if (m.kind === 'standin')","for (const m of roster) if (m.kind === 'standin')"],
["import type { Role, UnitInit } from './units';","import { byId, type Role, type UnitInit } from './units';"],
]);
edit('src/rules.ts',[
["        for (const actorId of rule.who) this.fire(rule, actorId, []);","        for (const actorId of this.whoOf(rule)) this.fire(rule, actorId, []);"],
["for (const rule of this.ordered) for (const actorId of rule.who) this.evaluate(rule, actorId, ev);","for (const rule of this.ordered) for (const actorId of this.whoOf(rule)) this.evaluate(rule, actorId, ev);"],
["  isMoving(actorId: string)","  /** Each rule's actors sorted by id, so list order in the plan never changes the result (§8.7). */\n  private whoOf(rule: Rule): readonly string[] {\n    let sorted = this.whoSorted.get(rule.id);\n    if (!sorted) {\n      sorted = [...rule.who].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));\n      this.whoSorted.set(rule.id, sorted);\n    }\n    return sorted;\n  }\n\n  isMoving(actorId: string)"],
["  private readonly ordered: Rule[];\n","  private readonly ordered: Rule[];\n  private readonly whoSorted = new Map<string, readonly string[]>();\n"],
]);
