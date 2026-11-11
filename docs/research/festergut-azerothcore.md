# Festergut in AzerothCore — research notes

Collected 2026-11-11 from `azerothcore/azerothcore-wotlk` at the pinned commit
`dca1a87699e380f3c19af54f9003d837c696131d`. Numbers here are facts read from the source; data
files cite the exact file and line (or table and key) when they use them.

## Script: `src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp`

Spells: Inhale Blight 69165, Pungent Blight 69195, Gastric Bloat 72219 (the script uses this id
instead of the proc version 72214), Gastric Explosion 72227, Gas Spore 69278, Vile Gas 69240,
Inoculated 69291, Malleable Goo (heroic, cast by Putricide) 72296. Ambient Gaseous Blight
variants 69157 → 69162 → 69164 (visuals 69126, 69152, 69154 on a gas dummy NPC). Difficulty
variants of each id come from the client's SpellDifficulty.dbc (`GetSpellIdForDifficulty`);
the world database table `spelldifficulty_dbc` has no rows for these spells.

Engage schedule (`JustEngagedWith`): berserk 5 min; Inhale Blight 25–30 s; Gas Spore 20–25 s;
Vile Gas 30–40 s in group 1; Gastric Bloat 12.5–15 s; heroic Goo 15–20 s.

Event handling (`UpdateAI`): no victim → return; `events.Update(diff)`; return while casting;
one `ExecuteEvent`; then `DoMeleeAttackIfReady`.
- Inhale Blight: remove all ambient blight; if the counter is 3 → cast Pungent Blight
  (not triggered), counter := 0, reschedule Gas Spore 20–25 s; else cast Inhale Blight
  (not triggered), counter += 1, and if the counter < 3 apply the next ambient blight
  (triggered). Always reschedule Inhale Blight 34 s.
- Gas Spore: cast with `SPELLVALUE_MAX_TARGETS` = 2/3/2/3 (10n/25n/10h/25h); reschedule
  40–45 s; `DelayEventsToMax(20 s, group 1)` delays Vile Gas.
- Vile Gas: `minTargets` = 3/8/3/8; select a random target from the threat list, preferring
  targets farther than 5 yd when at least `minTargets` such targets exist; reschedule 28–35 s
  in group 1.
- Gastric Bloat: cast on the current victim; reschedule 15–17.5 s.
- Berserk: cast Berserk on self.

Spell scripts:
- Pungent Blight: on each hit target, after the damage effect, remove Inoculated; its script
  effect removes Inhaled Blight from Festergut.
- Blighted Spores aura (applied by Gas Spore): when its periodic-damage effect is removed, give
  the target one Inoculated stack unless the spore aura was refreshed within the last 1 s; at
  most one Inoculated stack per 10 s; record the highest Inoculated stack on Festergut
  (`SetData`).
- Gastric Bloat: on hit, if the target has 10 stacks → remove the aura and cast Gastric
  Explosion on itself (triggered).
- Gaseous Blight: quest-residue side effect only (not modelled).

## World database (`data/sql/base/db_world`)

`creature_template` (columns: DamageModifier col 22, BaseAttackTime 23, BaseVariance 25,
unit_class 27, speed_run 16, exp 12, HealthModifier 44, ArmorModifier 46):

| Entry | Difficulty | speed_run | DamageModifier | HealthModifier |
| --- | --- | --- | --- | --- |
| 36626 | 10n | 1.5873 | 75 | 675 |
| 37504 | 25n | 1.5873 | 122.6 | 2900 |
| 37505 | 10h | 1.5873 | 116 | 980 |
| 37506 | 25h | 1.5873 | 174.5 | 3750 |

All: level 83, exp 2, unit_class 1, BaseAttackTime 2000, BaseVariance 1, ArmorModifier 1.
Professor Putricide: 36678 (heroic Goo caster).

`creature_classlevelstats` (83, class 1): basehp2 13945, basearmor 10643, attackpower 805,
damage_exp2 177.074.

Check: health = ceil(basehp2 × HealthModifier) → 10n 9,412,875, which equals `curhealth` of the
spawn row; 25n 40,440,500; 10h 13,666,100; 25h 52,293,750.

`creature_template_model`: 36626 → display 31006. `creature_model_info` 31006: BoundingRadius
0.31, CombatReach 8.

`creature` spawn of 36626: map 631, position (4267.92, 3137.26, 360.593), orientation 4.67748.

## Core formulas

- Health: `CreatureBaseStats::GenerateHealth` = ceil(BaseHealth[exp] × ModHealth)
  (`CreatureData.h` ~line 313).
- Armor: ceil(BaseArmor × ModArmor) (`CreatureData.h` ~line 327).
- Melee base damage: weapon min = BaseDamage[exp], max = 1.5 × that (`Creature.cpp` ~1554).
  `Creature::CalculateMinMaxDamage` (`StatSystem.cpp` ~1117):
  min = ((weaponMin + AP/14 × variance) × DamageModifier × basePct + totalValue) × totalPct,
  basePct includes `GetAPMultiplier` = attack time / 1000 for creatures (`Unit.cpp` 13306).
  So 10n: (177.074 + 805/14) × 75 × 2.0 ≈ 35,186 to (265.611 + 57.5) × 75 × 2.0 ≈ 48,467
  before armor. Plan 2 must confirm totalValue/totalPct defaults with a worked example.
- Armor mitigation (`Unit::CalcArmorReducedDamage`, `Unit.cpp` 2233): level L' = L + 4.5 (L − 59)
  for L > 59; r = 0.1 × armor / (8.5 L' + 40); reduction = r / (1 + r), capped at 0.75.
  Equivalent to armor / (armor + 85 L' + 400); for L = 83, 85 L' + 400 = 16,635.
- Melee range (`Unit::GetMeleeRange`, `Unit.cpp` 807): max(reachA + reachB + 4/3, 5) centre to
  centre, plus a leeway bonus while both move. Festergut (8) vs player (1.5): 10.83 yd.

## Threat (`src/server/game/Combat/ThreatManager.cpp`)

- Victim selection (`ReselectVictim`, ~665): a fixated target always wins; the old victim stays
  unless the highest beats it by more than 10 %; above 30 % the highest wins regardless of range;
  between 10 % and 30 % only a target within melee range takes over (walking the sorted list).
- Comparison precedence (`CompareReferencesLT`): online state, then taunt state
  (taunting > none > detaunted), then threat × weight.
- Taunt (`MatchUnitThreatToHighestThreat`, ~536, and `TauntUpdate`, ~559): the taunter's threat
  is raised to the highest threat; while the taunt aura lasts its reference has taunt precedence;
  the victim is reselected immediately.
- Healing threat (`Unit.cpp` 8204 → `ThreatManager::ForwardThreatForAssistingMe`, ~797): half the
  healing, split evenly over every creature that has the healed unit on its threat list, with
  threat modifiers ignored. Damage threat is the damage dealt (class modifiers in Plan 3).

## Spell.dbc columns (3.3.5a)

Derived by aligning `SpellEntryfmt` (DBCfmt.h line 112, 234 columns, 187 not skipped) with the
fields of `struct SpellEntry` in order (187 scalars). Zero-based column indexes:

Id 0, Attributes 4, AttributesEx 5, CastingTimeIndex 28, RecoveryTime 29, CategoryRecoveryTime 30,
InterruptFlags 31, AuraInterruptFlags 32, ProcFlags 34, ProcChance 35, DurationIndex 40,
RangeIndex 46, Speed 47 (float), StackAmount 49, Effect[0..2] 71–73, EffectDieSides 74–76,
EffectBasePoints 80–82, EffectImplicitTargetA 86–88, EffectImplicitTargetB 89–91,
EffectRadiusIndex 92–94, EffectApplyAuraName 95–97, EffectAmplitude 98–100,
EffectChainTarget 104–106, EffectMiscValue 110–112, EffectTriggerSpell 116–118,
SpellName[0] 136 (string), StartRecoveryCategory 205, StartRecoveryTime 206,
MaxAffectedTargets 212, DmgClass 213, SchoolMask 225.

Other formats: SpellCastTimes `nixx`, SpellDifficulty `niiii` (10n, 25n, 10h, 25h spell ids),
SpellDuration `niii` (base, per level, max), SpellRadius `nfff` (radius, per level, max),
SpellRange `nffff i …` (min hostile, min friendly, max hostile, max friendly, flags).

## Melee worked example (Festergut 10n)

AP/14 × variance = 805/14 × 1 = 57.5; attack-time multiplier 2000/1000 = 2.0.
min = (177.074 + 57.5) × 75 × 2.0 = 35,186.1 → 35,186; max = (1.5 × 177.074 + 57.5) × 75 × 2.0 =
48,466.65 → 48,466 (truncated to whole numbers before the roll).

## Threat update

`THREAT_UPDATE_INTERVAL` is 1000 ms (ThreatManager.h line 94): the victim is reselected once per
second, immediately after a taunt (ThreatManager.cpp ~583), and immediately when the current
victim becomes unavailable (`GetCurrentVictim`, ~266).
