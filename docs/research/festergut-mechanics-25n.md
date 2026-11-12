# Festergut mechanics, 25-player normal — research for Plan 2b

Collected 2026-11-11 from `azerothcore/azerothcore-wotlk` at the pinned commit
`dca1a87699e380f3c19af54f9003d837c696131d` and from `packages/content/data/spelldata/festergut.json`
(client 3.3.5a 12340, deDE). This builds on `festergut-azerothcore.md`. Behaviour is described in
our own words; code is quoted only in short fragments.

Source abbreviations (all paths relative to the AzerothCore repository at the commit):

| Short | File |
| --- | --- |
| `FG` | `src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp` |
| `PP` | `src/server/scripts/Northrend/IcecrownCitadel/boss_professor_putricide.cpp` |
| `ICC.h` | `src/server/scripts/Northrend/IcecrownCitadel/icecrown_citadel.h` |
| `SD` | `src/server/shared/SharedDefines.h` |
| `SAD` | `src/server/game/Spells/Auras/SpellAuraDefines.h` |
| `SI` | `src/server/game/Spells/SpellInfo.cpp` |
| `SM` | `src/server/game/Spells/SpellMgr.cpp` |
| `SP` | `src/server/game/Spells/Spell.cpp` |
| `SE` | `src/server/game/Spells/SpellEffects.cpp` |
| `SAE` | `src/server/game/Spells/Auras/SpellAuraEffects.cpp` |
| `SA` | `src/server/game/Spells/Auras/SpellAuras.cpp` |
| `U` | `src/server/game/Entities/Unit/Unit.cpp` |
| `CR` | `src/server/game/Entities/Creature/Creature.cpp` |
| `UAI.h` | `src/server/game/AI/CoreAI/UnitAI.h` |
| `CAI` / `CAI.h` | `src/server/game/AI/CreatureAI.cpp` / `.h` |
| `TM` | `src/server/game/Combat/ThreatManager.cpp` |
| `json` | `packages/content/data/spelldata/festergut.json` (this repo), `spells[id=…]` |
| `db/<table>` | `data/sql/base/db_world/<table>.sql` |

## 0. General rules confirmed

- **Difficulty variant.** Every `Spell` object replaces its spell by the map's variant in its
  constructor (`SP` 609, `GetSpellForDifficultyFromSpell`). `GetSpellIdForDifficulty` (`SM` 538–578)
  reads `SpellDifficulty.dbc`; when a heroic slot is 0 it falls back two modes (10h → 10n, 25h → 25n),
  when the slot is still 0 it keeps the given id. Script-side lookups (`Inoculated`, `Inhaled
  Blight` in the Pungent Blight script) call the same function. Variants below come from
  `json.difficultyVariants` ([10n, 25n, 10h, 25h]).
- **Effect value.** `SpellEffectInfo::CalcValue` (`SI` 409–447): value = basePoints + roll, where
  dieSides 0 adds nothing, dieSides 1 adds exactly 1, and dieSides n > 1 adds `irand(1, n)`
  (inclusive). `RealPointsPerLevel` is 0 for every spell here and none has
  `SPELL_ATTR0_SCALES_WITH_CREATURE_LEVEL` (attribute decode below), so no level scaling applies.
- **Area target geometry.** For SRC/DEST areas (`SP` 9504–9521) the test is the **3D centre
  distance** from the area centre to the unit `<= radius`; the target's combat reach is added only
  when a player-controlled caster hits a non-player-controlled unit. All areas in this fight hit
  players, so **no reach is added**. `SRC_AREA_ENEMY` also gets the caster's leeway bonus (moving
  players only; zero for Festergut). Radius 50000 (index 28) is the whole room.
- **`SPELL_ATTR3_ONLY_ON_PLAYER`** restricts area searches to players (`SP` 2161).
- **Max targets.** After an area search, `SPELLVALUE_MAX_TARGETS` (or the DBC value) keeps a
  random subset (`RandomResize`, `SP` 1414–1419).
- **Effects with identical targeting** (same TargetA, TargetB, conditions and radius) share one
  target list (`SP` 1002–1011); otherwise each effect searches on its own.
- **Stacks scale every aura amount**: `AuraEffect::CalculateAmount` ends with
  `amount *= stackAmount` (`SAE` 580) for all aura types (periodic damage included; the DoT
  done-bonus is computed for one stack first, `SAE` 557–565).
- **Creature spells never crit** (`U` 8896–8897). A player-cast magic spell can (Gastric Explosion).

Decoded ids used below: `SD` 767–906 (effects 1 INSTAKILL, 2 SCHOOL_DAMAGE, 6 APPLY_AURA,
32 TRIGGER_MISSILE, 64 TRIGGER_SPELL, 77 SCRIPT_EFFECT, 140 FORCE_CAST); `SD` 1414–1495 (targets
1 UNIT_CASTER, 6 UNIT_TARGET_ENEMY, 7 UNIT_SRC_AREA_ENTRY, 15 UNIT_SRC_AREA_ENEMY,
16 UNIT_DEST_AREA_ENEMY, 22 SRC_CASTER, 30 UNIT_SRC_AREA_ALLY, 53 DEST_TARGET_ENEMY,
63 DEST_TARGET_ANY); `SAD` 66–347 (auras 3 PERIODIC_DAMAGE, 4 DUMMY, 5 MOD_CONFUSE,
9 MOD_ATTACKSPEED, 23 PERIODIC_TRIGGER_SPELL, 26 MOD_ROOT, 33 MOD_DECREASE_SPEED, 61 MOD_SCALE,
79 MOD_DAMAGE_PERCENT_DONE, 138 MOD_MELEE_HASTE, 226 PERIODIC_DUMMY, 229 MOD_AOE_DAMAGE_AVOIDANCE,
284 LINKED). School masks: 1 physical, 32 shadow, 40 nature + shadow, 127 all (`SD` 288–290).

## 1. Spells, 25-player normal

Variants [10n, 25n, 10h, 25h] (`json.difficultyVariants`; "—" = no SpellDifficulty row, the id is
used in every mode; a 0 slot falls back as in §0):

| Spell | Base id | 10n | 25n | 10h | 25h |
| --- | --- | --- | --- | --- | --- |
| Inhale Blight | 69165 | — | — | — | — |
| Inhaled Blight | 69166 | 69166 | 71912 | (0 → 69166) | (0 → 71912) |
| Pungent Blight | 69195 | 69195 | 71219 | 73031 | 73032 |
| Gaseous Blight auras (L/M/S) | 69157 / 69162 / 69164 | — | — | — | — |
| Gaseous Blight damage, large | 69159 | 69159 | 70135 | 70136 | 70137 |
| Gaseous Blight damage, medium | 69161 | 69161 | 70138 | 70139 | 70140 |
| Gaseous Blight damage, small | 69163 | 69163 | 70468 | 70469 | 70470 |
| Gas Spore | 69278 | 69278 | 71221 | (0 → 69278) | (0 → 71221) |
| Gas Spore (holder aura) | 69279 | — | — | — | — |
| Blighted Spores | 69290 | 69290 | 71222 | 73033 | 73034 |
| Inoculated | 69291 | 69291 | 72101 | 72102 | 72103 |
| Vile Gas | 69240 | 69240 | 71218 | 73019 | 73020 |
| Vile Gas splash | 69244 | 69244 | 71288 | 73173 | 73174 |
| Vile Gas slow (linked) | 69248 | — | — | — | — |
| Gastric Bloat | 72219 | 72219 | 72551 | 72552 | 72553 |
| Gastric Explosion | 72227 | 72227 | 72228 | 72229 | 72230 |
| Berserk | 47008 | — | — | — | — |

Value per variant (10n / 25n / 10h / 25h), from basePoints + dieSides:

| Value | 10n | 25n | 10h | 25h |
| --- | --- | --- | --- | --- |
| Gaseous Blight large tick | 3900–4100 | 4388–4612 | 5363–5637 | 6338–6662 |
| Gaseous Blight medium tick | 1950–2050 | 2925–3075 | 3413–3587 | 4388–4612 |
| Gaseous Blight small tick | 975–1025 | 1463–1537 | 1463–1537 | 2438–2562 |
| Pungent Blight | 42900–45100 | 48750–51250 | 63375–66625 | 73125–76875 |
| Inhaled Blight dmg / scale / attack speed per stack | 25 / 20 / 25 % | 30 / 20 / 30 % | 25 / 20 / 25 % | 30 / 20 / 30 % |
| Gas Spore targets (script) | 2 | 3 | 2 | 3 |
| Blighted Spores tick | 1950–2050 | 2925–3075 | 2925–3075 | 3900–4100 |
| Vile Gas tick | 3900–4100 | 4875–5125 | 4875–5125 | 6338–6662 |
| Vile Gas splash | 3900–4100 | 4875–5125 | 4875–5125 | 5850–6150 |
| Gastric Bloat hit | 9750–10250 | 12188–12812 | 12188–12812 | 14625–15375 |
| Gastric Explosion (radius) | 29250–30750 (10 yd) | 29250–30750 (10 yd) | 48750–51250 (room) | 48750–51250 (room) |
| Inoculated per stack | −25 % | −25 % | −25 % | −25 % |

### 25n detail (all from `json`, ids as listed)

| Spell (25n id) | Cast | Duration | Max stacks | Effects in order |
| --- | --- | --- | --- | --- |
| Inhale Blight 69165 | 3500 ms | — | — | e0 SCRIPT_EFFECT on caster (no script is registered for 69165 in `db/spell_script_names`, so it does nothing); e1 TRIGGER_SPELL 69166 → 71912 on caster |
| Inhaled Blight 71912 | — | permanent (−1) | 3 | e0 MOD_DAMAGE_PERCENT_DONE +30 % × stacks, misc 1 (physical only); e1 MOD_SCALE +20 % × stacks; e2 MOD_ATTACKSPEED +30 % × stacks. All on caster |
| Pungent Blight 71219 | 3000 ms | — | — | e0 SCHOOL_DAMAGE shadow 48750–51250, SRC_CASTER + UNIT_SRC_AREA_ENEMY, radius 50000 (players only, always hits); e1 SCRIPT_EFFECT value 69166 on caster; e2 TRIGGER_SPELL 69157 on caster |
| Gaseous Blight 69157 / 69162 / 69164 | — | permanent | — | e0 PERIODIC_TRIGGER_SPELL every 2000 ms → 69159 / 69161 / 69163 (→ 70135 / 70138 / 70468), on caster; e1 (69157) or e2 (69162, 69164) FORCE_CAST visual 69126 / 69152 / 69154, SRC_CASTER + UNIT_SRC_AREA_ENTRY, radius 50000 |
| Gaseous Blight damage 70135 / 70138 / 70468 | — | — | — | e0 SCHOOL_DAMAGE shadow (table above), SRC_CASTER + UNIT_SRC_AREA_ENEMY, radius 50000, players only |
| Gas Spore 71221 | 0 | 90 s (unused) | — | e0 FORCE_CAST 69279, SRC_CASTER + UNIT_SRC_AREA_ENEMY, radius 50000, max targets 3 from the script; e1 DUMMY aura with the same targets but radius index 0 (radius 0 → no target; `SI` 554–557) |
| Gas Spore 69279 (on holder) | — | 12000 ms | — | e0 PERIODIC_TRIGGER_SPELL amplitude 12000 → 69290 (→ 71222): exactly one tick, at expiry |
| Blighted Spores 71222 | — | 6000 ms | 5 | e0 PERIODIC_DAMAGE shadow 2925–3075 every 1000 ms (6 ticks), SRC_CASTER + UNIT_SRC_AREA_ALLY, radius 8 (holder included; players only) |
| Inoculated 72101 | — | 120000 ms | 3 | e0 MOD_AOE_DAMAGE_AVOIDANCE −25 % × stacks, misc 32 (shadow); e1 PERIODIC_DUMMY 1000 ms, value 0 (no effect). Death-persistent |
| Vile Gas 71218 | 0, missile 20 yd/s | 6000 ms | — | e0 PERIODIC_DAMAGE nature+shadow 4875–5125 every 2000 ms (3 ticks), DEST_TARGET_ENEMY + UNIT_DEST_AREA_ENEMY radius 8; e1 LINKED 69248; e2 PERIODIC_TRIGGER_SPELL every 2000 ms → 69244 (→ 71288). Players only |
| Vile Gas splash 71288 | — | 1000 ms | — | cast by the Vile Gas victim: e0 SCHOOL_DAMAGE 4875–5125 to allies within 8 yd (caster excluded, `SPELL_ATTR1_EXCLUDE_CASTER`); e1 MOD_ROOT 1 s on itself |
| Vile Gas slow 69248 | — | 6000 ms | — | cast by Festergut at each Vile Gas victim (`SAE` 5845, needs an explicit target): MOD_DECREASE_SPEED −50 % and MOD_CONFUSE to players within 8 yd of that victim |
| Gastric Bloat 72551 | 0 | 100000 ms | 10 | e0 SCHOOL_DAMAGE nature+shadow 12188–12812; e1 MOD_DAMAGE_PERCENT_DONE +10 % × stacks, all schools (on the target); e2 SCRIPT_EFFECT. All TARGET_UNIT_TARGET_ENEMY (the victim); always hits |
| Gastric Explosion 72228 | 0 | — | — | e0 SCHOOL_DAMAGE nature+shadow 29250–30750, SRC_CASTER + UNIT_SRC_AREA_ALLY, radius 10 (the caster is the tank); e1 INSTAKILL on caster |
| Berserk 47008 | 0 | 1800000 ms | — | e0 MOD_DAMAGE_PERCENT_DONE +900 % all schools; e1 MOD_MELEE_HASTE +150 %; e2 MOD_SCALE +25 %. On caster |

Relevant attributes (decoded from `json` attribute words against `SD` 374–635):
`SPELL_ATTR3_ONLY_ON_PLAYER` on all damage spells; `SPELL_ATTR3_ALWAYS_HIT` on Pungent Blight,
Gas Spore and Gastric Bloat (the others can miss or be resisted — not modelled today);
`SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS` on 69279, Blighted Spores and Gastric Explosion
(the caster's percentage done-mods do not apply to these, `SI` 1655–1674); Inoculated and Gastric
Explosion have `ALLOW_CAST_WHILE_DEAD`, Inoculated also `ALLOW_DEAD_TARGET` and
`ALLOW_AURA_WHILE_DEAD` (death-persistent, `SI` 1262).

Modifier rules:
- **Inoculated** reduces only damage from effects that target an area (direct, `SP` 8722–8729,
  and periodic, `SAE` 6398–6405), when the spell's school mask overlaps shadow (`U` 6116–6124).
  That covers Pungent Blight, Gaseous Blight, Blighted Spores, Vile Gas, Vile Gas splash and
  Gastric Explosion, but **not** Gastric Bloat (single target) or melee. 3 stacks → one effect of
  −75 % → damage × 0.25. The reduction is a multiplier on the damage (`U` 16030–16036).
- **Damage done %** (Inhaled Blight, Berserk, Gastric Bloat on the tank) multiplies by
  `1 + amount/100` per aura effect, all effects multiplied (`U` 6026–6050). Melee uses the physical
  ones via the main-hand TOTAL_PCT (`U` 11809–11840); spells via `SpellPctDamageModsDone`
  (`U` 8209–8260), matching school masks by overlap. Inhaled Blight (physical only) therefore
  boosts only Festergut's melee; Berserk (×10) boosts melee and all his spells.
- **Attack speed**: MOD_ATTACKSPEED and MOD_MELEE_HASTE both call `ApplyAttackTimePercentMod`
  (`SAE` 4830–4858), which divides the attack time by `1 + amount/100` (`U` 13135–13152); several
  auras multiply. 3 × Inhaled Blight (25n): 2000 / 1.9 ≈ 1053 ms; with Berserk also / 2.5.
- **Scale → reach**: MOD_SCALE amounts are summed and added to the native scale 1
  (`U` 12829–12835); a creature's combat reach is the model's 8 × scale (`CR` 3591–3607;
  `creature_model_info` 31006). 25n with 3 Inhaled Blight stacks: scale 1.6 → reach 12.8; with
  Berserk 1.85 → 14.8. This moves melee range and the Vile Gas distance threshold (§5).

## 2. Ambient Gaseous Blight: who applies it, and when

- **At engage**: Festergut's `JustEngagedWith` calls Putricide's `DoAction(ACTION_FESTERGUT_COMBAT)`
  (`FG` 137–138; `ICC.h` 552). Putricide then `MoveCharge`s at 15 yd/s to `festergutWatchPos`
  (4324.820, 3166.03, 389.3831) (`PP` 150, 472–474). `MoveCharge` does not generate a path by
  default (`MotionMaster.h` 253), so it is a straight spline. On arrival (`MovementInform`,
  `PP` 425–433), if Festergut is in combat: the boss state becomes IN_PROGRESS, Putricide talks and
  casts the release-gas visual 69125 (`ACTION_FESTERGUT_GAS`, `PP` 478–480), and **Festergut casts
  69157 on himself (triggered)**. Putricide's spawn is his table position (4356.19, 3262.90,
  389.482) (`db/creature` guid 201294; `PP` 152). Distance 101.82 yd → arrival ≈ **6788 ms after
  engage** (plus up to one map update). First Gaseous Blight tick 2000 ms later (no
  start-at-apply attribute) ≈ 8.8 s.
- **Inhale Blight event** (`FG` 196–216): all three gas auras are removed from Festergut and the
  visuals from the gas dummy (NPC 36659, `ICC.h` 267); Inhale Blight starts its 3.5 s cast; in the
  same moment, when the new counter is 1 or 2, Festergut applies 69162 or 69164 (triggered, on
  himself). The gas therefore steps large → medium → small → none without a gap; Inhaled Blight's
  stack arrives only when the cast completes (TRIGGER_SPELL runs at launch, `SE` 808–812).
- **After Pungent Blight**: Pungent Blight's own e2 TRIGGER_SPELL re-applies 69157 when the cast
  completes (launch phase). Putricide is not involved; the script's e1 handler only sends
  `ACTION_FESTERGUT_GAS` (talk + visual, `FG` 297–299).
- The gas dummy only shows the visual: the FORCE_CAST effects are limited to NPC 36659 by
  `conditions` (§4). Damage ticks are cast by Festergut (the periodic trigger spell is cast by the
  aura's target, Festergut, `SAE` 6252).

## 3. Gas Spore → Blighted Spores → Inoculated

1. Festergut casts Gas Spore 71221 with max targets 3 (`FG` 220): e0 picks 3 random players in the
   room; each is forced to cast 69279 on itself (`SE` 1043–1098, the target casts with full
   triggered flags).
2. 69279 lasts 12 s with one periodic tick at 12 s. The tick runs before the expiry removal in the
   same update (`SAE` 926–950 then `U` 3790). The holder casts 69290 → 71222 (`SAE` 6252: the
   aura target casts because 69290 needs no explicit target).
3. Blighted Spores hits all players within 8 yd (centre distance) of the holder, holder included.
   Area-targeted DoTs from **different casters do not stack** (`SA` 2131–2151: the area check
   breaks out; then the same-spell rank rule returns false, `SA` 2193–2210), so a newer holder's
   aura **replaces** the older one (removal `AURA_REMOVE_BY_DEFAULT`, `U` 4731–4751, 4914–4925).
   The same caster would add a stack (max 5, `U` 4436–4470), which cannot happen with one tick.
4. When Blighted Spores' periodic-damage effect is removed (any reason), the aura script
   (`FG` 324–346; `db/spell_script_names` 2320, 2489, 2642, 2643) runs:
   - **1 s rule**: if the removed aura's remaining time is **more than** max − 1000 ms (it was
     applied less than 1 s ago, i.e. it is being replaced), nothing happens.
   - **10 s rule**: if the target already has Inoculated and its remaining time is **more than**
     max − 10000 ms (gained or refreshed less than 10 s ago), nothing happens.
   - Otherwise the target casts Inoculated (69291 → 72101) on itself, triggered: +1 stack (max 3),
     duration refreshed to 120 s; and Festergut's `SetData` records `old stacks + 1` as the highest
     stack (achievement "Flu Shot Shortage", `FG` 254–258, 402–414).
5. `spell_linked_spell` has no rows for any of these spells; there is no `spell_proc` entry.

## 4. `conditions`, `spell_dbc`, corrections

| Source | Rows |
| --- | --- |
| `db/conditions` 5127 | (13, 2, 69157, …, 31, 0, 3, 36659): implicit targets of 69157 effect 1 must be creature entry 36659 |
| `db/conditions` 5707, 5708 | (13, 4, 69162 / 69164, …, 31, 0, 3, 36659): same for effect 2 |
| `db/disables` 152–191 | type 0, flag 64 (LOS) for 69240, 69244, 69248, 71218, 71288, 73019, 73020, 73173, 73174 (comment: Putricide uses Vile Gas during Rotface) |

Source type 13 = `CONDITION_SOURCE_TYPE_SPELL_IMPLICIT_TARGET` (SourceGroup = effect mask),
condition 31 = `CONDITION_OBJECT_ENTRY_GUID` (`ConditionMgr.h` 65, 139). There are **no**
conditions for Inhale Blight, Pungent Blight, Gaseous Blight damage, Gas Spore or Vile Gas, and
none for 69165 despite the script comment (`FG` 209). No rows in `db/spell_dbc` or
`db/spelldifficulty_dbc`, no `SpellInfoCorrections.cpp` fix, no `spell_custom_attr`, and no
hard-coded id in the core spell/aura/unit code (searched for all 59 ids).

## 5. Vile Gas target selection (`SelectTarget` distance)

`DefaultTargetSelector` (`UAI.h` 53–100) with `dist = −5`: a target is **rejected** when
`IsWithinCombatRange(target, 5)`, which is `centreDist² < (5 + reachFestergut + reachTarget)²` on
**3D centre distance** (`U` 774–788). So a player qualifies when the centre distance is
**≥ 5 + both combat reaches** (inclusive at equality), i.e. edge distance ≥ 5. For a positive dist
the test is the mirror: qualifies when edge distance < dist (strict).

Script flow (`FG` 224–236): count up to 8 (25n) qualifying players in the threat list
(`SelectTargetList`, players only, tank allowed, offline references skipped, `UAI.h` 282–343;
with more than 8 it takes a random subset, which only consumes random numbers); if 8 or more
qualify, pick uniformly among **all** qualifying players, otherwise among all players on the threat
list (`SelectTarget` → `SelectRandomContainerElement`, `UAI.h` 238–262). Festergut's reach grows
with scale (§1): 8 → 14.5 yd centre threshold vs a 1.5-reach player; 12.8 → 19.3 yd at 3 stacks.

## 6. Pungent Blight: hook order vs damage

`Spell::_cast` selects targets (`SP` 4031), runs the **launch phase** (`SP` 4091,
`HandleLaunchPhase` / `DoAllEffectOnLaunchTarget` `SP` 8619–8745), then `handle_immediate`
(`SP` 4177). `EffectSchoolDMG` only acts in `SPELL_EFFECT_HANDLE_LAUNCH_TARGET` (`SE` 330–333):
the damage, its done and taken bonuses (`SE` 677–687) and the AoE reduction (`SP` 8722–8729) are
fixed at launch. Later, per target, `DoSpellHitOnUnit` applies auras (`SP` 3253) and calls
`HandleEffects(..., HIT_TARGET)` for each effect (`SP` 3336–3354), where `OnEffectHitTarget` hooks run
before the default handler (`SP` 5866–5871, 9000–9046); only then is the damage dealt
(`SP` 2885–2957). So **Inoculated reduces the Pungent Blight hit that removes it**: the reduction
was computed at launch, the EFFECT_0 hit hook removes Inoculated afterwards, and the stored damage
is dealt last. Same for Gastric Bloat: its aura stack is added (`SP` 3253) before the e2 script
hook checks for 10 stacks.

## 7. Stack scaling; Gastric Explosion damage

- All aura amounts are multiplied by the stack count (`SAE` 580). Gastric Bloat has no periodic
  aura: its +10 % done is × stacks (up to +100 %). Inhaled Blight: all three effects × stacks
  (one aura effect each, so 3 stacks = +90 % attack speed, not 1.3³). Blighted Spores is the only
  stacking DoT (amount × stacks) but never exceeds 1 stack in practice.
- Gastric Explosion (72228): cast by **the tank** on itself when the 10th Gastric Bloat lands; the
  bloat aura is removed first (`FG` 358–366), so its +100 % does not apply. Damage = 29250 +
  irand(1, 1501); `IGNORE_CASTER_DAMAGE_MODIFIERS` drops the tank's percentage done-mods; no
  spell-power coefficient (`BonusMultiplier` 0, `U` 8650–8690); targets' Inoculated applies (area,
  shadow overlap), the creature-AoE avoidance does not (player caster); because the caster is a
  player, more than 10 targets scale each hit by 10 / targets (`SP` 8730–8735). It is a magic
  spell from a player and **can crit**. Then e1 kills the tank (`SE` 279–292).

## 8. Death of a spore holder or a spore target

- Holder dies before 12 s: 69279 is removed by death (`U` 5424–5443); it has no remove hook, so
  **no explosion**, no Blighted Spores, no Inoculated.
- A player with Blighted Spores dies: the aura is not death-persistent and is removed with
  `AURA_REMOVE_BY_DEATH`; `AuraEffect::HandleEffect` calls the after-remove hooks for every remove
  mode (`SAE` 755–804) and the script does not check the mode. The 1 s / 10 s rules apply as usual;
  Inoculated allows a dead caster and target and is death-persistent, so the **dead player still
  gains (and keeps) an Inoculated stack**, and the stack counts for `SetData`. (The cast path
  for a dead caster was read only up to `CheckCast`'s dead-caster check, `SP` 5876–5878.)

## 9. Engage and the initial victim

The first threat reference — the unit that pulled (`who`) — is created by `ThreatManager::AddThreat`
(`TM` 410–524); because there is no current victim yet, `UpdateVictim` selects it immediately
(`TM` 520–521, 650–663), and `ProcessAIUpdates` → `JustStartedThreateningMe` → `EngagementStart`
→ `JustEngagedWith(who)` (`CAI.h` 131, `CAI` 286–295, `CR` 2893–2937). Inside, `DoZoneInCombat`
(`CAI` 117–162) calls `EngageWithTarget` for every valid player of the map within 250 yd (plus pets
and vehicles), which adds a reference with 0 threat, ignoring modifiers (`U` 7336–7344). With a
victim set, these 0-threat entries cannot take over (110 % rule, `TM` 665–713). So the initial
victim is **who** (the puller), then the normal 1 s reselection applies.

## 10. Engine contract changes for Plan 2b (prioritised)

Compared with `packages/engine/src` (catalog.ts, effects.ts, auras.ts, casting.ts, boss.ts,
modifiers.ts, movement.ts, melee.ts, threat.ts).

**P1 — wrong results without them**

1. **Area geometry (rewrite A-003 for areas).** `effects.ts` uses `pointToEdge` (subtracts the target's
   reach). AzerothCore uses centre distance ≤ radius for every area here (3D). Add an area centre
   (`caster` / `target position at launch` for DEST_TARGET areas such as Vile Gas) and
   enemy/ally relation to the caster instead of `players | creatures | all`, players-only, and
   "caster included" for SRC ally areas. Radius 50000 = whole room.
   (resolved by A-003 in Plan 2b-1 Task 2)
2. **AoE damage avoidance as its own modifier kind** (`aoe_damage_taken_pct`, per stack), applied
   only to area-targeted damage effects (direct and periodic). Today `damage_taken_pct` would also
   reduce Gastric Bloat and melee.
3. **School masks.** `School` is a single school; spells here are 40 (nature + shadow) and
   modifiers use masks matched by overlap (Inoculated 32, Inhaled Blight 1, Berserk 127).
4. **Area sub-target hooks and launch/hit split.** `afterHitTarget` runs only for the spell's main
   target; Pungent Blight's Inoculated removal must run for each unit hit by the area. Model
   AzerothCore's order: damage fixed at launch (with all modifiers), then per target and per effect
   hooks (`OnEffectHitTarget` before the default handler), then damage dealt. For Pungent Blight
   the result equals "damage with Inoculated, then remove it".
5. **Max targets at launch** from a named random stream (Gas Spore: random 3 of all players).
6. **Aura replacement scope** for area DoTs from different casters (Blighted Spores): the new
   instance replaces the old with reason `replaced`, firing `afterRemove` with the old instance's
   `appliedMs` / `refreshedMs` (needed for the 1 s rule); same caster still stacks.
7. **Removal by death fires `afterRemove`** (reason `death`, change A-012), and a
   spell/aura flag allowing a dead caster/target and death-persistent auras (Inoculated).
8. **Casting as another unit** from scripts and hooks, triggered: holder casts Blighted Spores,
   spore target casts Inoculated, tank casts Gastric Explosion, Vile Gas victim casts the splash,
   Festergut casts the gas aura when Putricide arrives. With player-caster rules: >10 targets →
   damage × 10 / targets, no creature-AoE avoidance, may crit.
9. **New effect types:** `trigger_spell` (cast spell X triggered, on caster or target, at launch),
   `force_cast` (target casts X on itself), `periodic_trigger` (aura tick casts X as the holder),
   `linked_aura` (apply/remove together), `instakill` (Gastric Explosion kills its caster).

**P2 — needed for the fight's numbers**

10. **Stat auras:** attack-speed modifiers (MOD_ATTACKSPEED, MOD_MELEE_HASTE: attack time divided by
    `1 + pct × stacks / 100`, multiplicative) read by `melee.ts` (today `attackTimeMs` is fixed), and
    scale (MOD_SCALE summed → combat reach = model reach × scale) feeding melee range and target
    selection.
11. **`selectTarget` semantics (A-021, resolved by A-021 in Plan 2b-1 Task 15):** minimum distance must be inclusive (edge ≥ 5; today `> 5`)
    and maximum strict (edge < max; today `≤`); add `playersOnly`, and a count helper
    (`SelectTargetList` up to n) for the Vile Gas "8 far players" test.
12. **Engage with a "who"**: `startEncounter` should take the pulling unit, put it first on the
    threat list as the victim, then zone-in-combat everyone else with 0 threat.
13. **Delayed first gas**: a sourced constant (Putricide distance 101.82 yd / 15 yd/s ≈ 6788 ms) or
    a modelled Putricide unit with an arrival callback; the gas aura is permanent with a 2 s
    periodic trigger.
14. **Difficulty resolution** in content: a `variantFor(baseId, difficulty)` table with the heroic
    fallback, used by catalog building and by scripts (Inoculated, Inhaled Blight).
15. **Data-driven damage values**: build effects from `json` basePoints + dieSides (rule in §0)
    instead of hand-entered ranges.

**P3 — document as limitations**

16. Spell hit/resist for spells without `ALWAYS_HIT` (Gaseous Blight, Vile Gas, Blighted Spores) and
    partial resists; spell crits of player-cast spells (Gastric Explosion).
17. Vile Gas missile delay (20 yd/s), the 1 s root and the slow/confuse aura 69248; LOS is disabled
    for Vile Gas (`db/disables`).
18. Already handled by the engine: a periodic tick that coincides with expiry fires before the
    expiry (`EventClass.PeriodicTick` < `AuraExpiry`), as Gas Spore's single tick needs.

## Open questions

- Exact map-update latency between Putricide's spline end and `MovementInform` (≤ one update),
  and whether players can be engaged before Putricide is visible — not traced.
- The full dead-caster cast path for Inoculated (target validation in `Spell::CheckCast` beyond the
  dead-caster check, aura application to a dead unit) was not read line by line; §8's conclusion
  rests on the attributes and `IsDeathPersistent`.
- Spell miss chance of a level-83 creature against level-80 players and shadow resistance were
  not researched.
- Whether Gastric Bloat's own e0 damage is dealt to a tank already killed by the explosion inside
  the e2 hook (cosmetic).
