# Adaptations from AzerothCore

Each entry is a deliberate difference from AzerothCore behaviour, or a rule AzerothCore does not
define (player behaviour). Tests named in the last column pin the behaviour.

| ID | Rule | Reason | Test |
| --- | --- | --- | --- |
| A-001 | Events at the same millisecond run in classes: spell hits, periodic ticks, aura expiries, AI updates, player decisions; within a class in schedule order. | AzerothCore order depends on map update internals; we need a fixed, documented order (§8.2). | `queue.test.ts`, `sim.test.ts` |
| A-002 | The boss AI update runs at a fixed interval (default 10 ms, an `assumption` in `core-data.ts`). | AzerothCore's diff varies with server load. | `boss.test.ts` |
| A-003 | Distances are 2D. Range between units = centre distance − both combat reaches; area radius = distance from the area centre − the target's combat reach; never negative. | Festergut's room is flat; one rule for range and area checks until Plan 2 verifies spell-specific cases. | `movement.test.ts`, `auras.test.ts` |
| A-004 | Movement is a straight line at constant speed, no pathing. | Festergut's room has no obstacles. | `movement.test.ts` |
| A-005 | Players react to plan rule triggers after a reaction delay drawn per player; rotation decisions have no delay. | Players are not part of AzerothCore. | `rules.test.ts` |
| A-006 | Instant spells resolve inside the event that cast them. | Equivalent to AzerothCore's immediate spell handling for instant casts without travel time. | `casting.test.ts` |
| A-007 | Random numbers come from named streams per mechanic and per actor purpose. | AzerothCore uses one global generator; we need comparable runs (§8.7). | `rng.test.ts`, `run.test.ts` |
| A-008 | Healing a dead unit has no effect and writes no event. | Death is final within the millisecond (§8.2). | `sim.test.ts` |
| A-009 | Refreshing a stacking aura resets its duration and keeps its periodic tick schedule. | Simplification until a mechanic needs otherwise. | `auras.test.ts` |
| A-010 | Plan rule actions compete only for movement: a rule move pre-empts a running rule move of lower priority; other actions run regardless. | Instant actions such as taunt do not conflict with movement in the game. | `rules.test.ts` |
| A-011 | Stand-ins act once per second, produce nothing while moving, and use fixed ranges (melee and tank 5 yd, ranged and healer 40 yd; all parameters are `assumption` entries in `core-data.ts`). A healer stand-in heals the injured player in range with the lowest health percentage (not lowest absolute health), ties broken by id. | Stand-ins are approximations by definition (§6.3). | `standin.test.ts` |
| A-012 | Removal of an aura by death does not trigger its on-expire effect. | Generic rule; until a dedicated hook exists (Plan 2), a boss script can handle the specific aura via `sim.subscribe`. | `auras.test.ts` |
| A-013 | A new move_start ends any previous move without a move_end; death ends a running cast and move without cast_interrupted/move_end (the death event closes them). | Keeps the trace small; consumers pair starts with the next move_start, move_end, cast_*, or death. | `sim.test.ts` |
| A-014 | Policy decisions: a move does not end the decision (an instant may follow); a policy may ask to be woken at a later time; more than 64 decisions by one actor in one millisecond is an error. | Kiting casters and timer-gated policies; wake loops must fail loudly. | `controller.test.ts` |
| A-015 | health_below is evaluated on damage and heal events of the watched unit; the killing blow does not fire it (the unit is dead). | Rules react to the living. | `rules.test.ts` |
| A-016 | Auras stack per caster: an aura instance is keyed by aura and caster (`aura|caster`), so two casters' copies of one aura coexist and only the same caster's copy stacks and refreshes. | One rule for stacking; matches how per-caster debuffs behave in the game. | `auras.test.ts` |
| A-017 | Damage and healing amounts are rounded half-up to whole numbers before they are applied. | Health is an integer; one deterministic rounding rule. | `sim.test.ts` |
| A-018 | A spell's cooldown starts when the cast succeeds, not when it begins. | A cast that fails or is interrupted does not consume the cooldown. | `casting.test.ts` |
