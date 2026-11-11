# Engine contract changes to schedule in Plans 2 and 3

Source: final review of `feat/engine-contract` (Plan 1), 2026-11-10. These are known gaps
between the Plan 1 engine and what Festergut (Plan 2) and real class specs (Plan 3) need.
Each item should become a task in the respective plan, so it is designed rather than
discovered mid-implementation.

## Plan 2 — Festergut

1. **Victim and threat.** `victimOf` is a pure threat maximum with ties to the lowest id. Needed:  (done in Plan 2a)
   a stateful current victim, AzerothCore's 110 %/130 % target-switch rule, taunt (copy top
   threat + fixate), and threat generated centrally in `Simulation.damage`/`heal` so stand-ins
   generate threat too (§6.3). The runner's `currentTank` must follow this victim.
2. **Melee.** `EventScriptedAI.updateAI` needs an `afterEvents(ctx)` step (only when not casting)  (done in Plan 2a)
   for `DoMeleeAttackIfReady`, with a swing timer, armor mitigation and avoidance.
3. **Cast options in `BossContext.cast`:** triggered casts (skip cast state, GCD and range, e.g.  (done in Plan 2a; casting as another unit remains for Gate 4)
   applying the next Gaseous Blight while inhaling); a maximum target count chosen at launch
   (Gas Spore 2 or 3, `SPELLVALUE_MAX_TARGETS`); casting as another unit (Putricide's Malleable
   Goo from Festergut's script).
4. **Aura model:** permanent auras (no duration); a removal hook that knows the reason (Blighted  (done in Plan 2a)
   Spores granting Inoculated and recording the count on the boss); an on-stack hook (Gastric
   Bloat at its limit → Gastric Explosion); per-target hit hooks ordered relative to damage
   (Pungent Blight removes Inoculated after its damage); a stacking-scope flag (today auras
   always stack per caster). Then reword A-012 again.
5. **Damage modifiers** driven by auras (Inoculated reduction, Inhaled Blight boss damage,  (done in Plan 2a)
   berserk). Design together with Plan 3's crit and armor.
6. **Target selection helpers** on the threat list, like AzerothCore `SelectTarget(Random,  (done in Plan 2a)
   minDist)`: Vile Gas prefers targets beyond a distance; Goo picks a random non-tank.
7. **Several scripted units per encounter.** `role: 'boss'` currently drives the kill outcome,  (done in Plan 2a)
   stand-in damage targets and the `boss` reference (inconsistently: rules match any boss but
   resolve to the first). Add an explicit set of units the encounter must kill; Putricide is
   not one of them.
8. **Timer windows go stale** after `delayEventsToMax`/`reschedule`. Add an EventMap query like  (partly: `clearTimer`)
   `GetTimeUntilEvent` and derive published windows from it.
9. **Script state** (AzerothCore `SetData`/`GetData`) for spore and Inoculated bookkeeping.  (done in Plan 2a)
10. **Plan validation against content:** after setup, check rule trigger aura and spell ids  (done in Plan 2a)
    against the catalog. Today a typo means a rule silently never fires.
11. **"Cause chain links it to the rule threshold"** (§10.3): a rule that never fired is not in
    any chain. Use a custom observation check or a threshold annotation.
12. **Point-targeted areas** (Goo on a location; area effects are always centred on a unit).
    Gate 4, but shape the effect type now.
13. Also from Plan 1 reviews: EventMap `AddPhase`/`RemovePhase`/`IsInPhase`; an
    `EventScriptedAI.setPhase` helper that sets both the sim phase and the EventMap phase mask;
    `Rng.pick` draws `min(n, pool)` values, so a short pool shifts later selections in the same
    stream — consider always drawing `n` or one sub-stream per occurrence.
14. Post-outcome guard: damage, heal, auras, casts and rules stop once the fight is over
    (`Simulation.over`), but boss-script emits (`ctx.ai`, `publishTimer`, `setPhase`) later in
    the same callback are not blocked. Decide whether `emit` should refuse events after the
    outcome once real scripts exist.

## Plan 3 — class specs

1. **Resources** in `Unit`, `UnitView` and `UnitSnapshot` (bumps the trace `schemaVersion`), a
   resource event kind, and wake-ups on resource threshold crossings.
2. **Haste:** cast time and GCD per caster instead of read from the static `SpellDef`.
3. **Random streams:** separate `.hit` and `.crit` streams per actor (§8.7); heal school is
   hard-coded to holy.
4. **Spell-power coefficients**, and tying effect numbers to sourced data keys so §7 applies to
   content, not only to engine constants.
5. **`PolicyFactory.create` receives `sim`,** so a policy could close over hidden state (§8.6).
   Pass the catalog and data, or a restricted API.
6. **Stand-ins:** the `buffs` field is parsed but unused — list it in the limitation report
   until modelled; stand-ins need armor and a profile reference instead of inline `maxHealth`.
7. **Statuses:** `MechanicStatus` lacks a decision-policy status (§6.1); spec support statuses
   need a place in the summary.
8. `action_failed.reason` is a free string from content handlers; restrict it to the text-key
   pattern (D6). `Unit.boundingRadius` is not read yet (melee range in Plan 2).
