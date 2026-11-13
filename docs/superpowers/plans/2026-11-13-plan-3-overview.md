# Plan 3 — Three modelled specs on Festergut 25N (overview)

Date: 2026-11-13. Status: overview for owner review; the detailed task plans (with code) follow per sub-plan.

**Goal (spec §4 Gate 1):** replace three of the 25 stand-ins of `scenarios/festergut/plan-25n.yaml` with modelled specs
that use their real abilities — Protection Paladin (replaces `t1`), Restoration Druid (replaces one healer), Fire Mage
(replaces one ranged) — each on a documented standard 3.3.5a ICC build loaded from a character profile file, each with a
`classes/<spec>/SUPPORT.md` (spec §6.2); re-run the three Gate 1 scenarios with honestly retuned stand-ins.

**Research (read first):** `docs/research/player-model-azerothcore.md` (how AzerothCore computes player stats, spells,
procs, melee, threat), `docs/research/spec-fire-mage-azerothcore.md`, `spec-restoration-druid-azerothcore.md`,
`spec-protection-paladin-azerothcore.md` (builds, gear, abilities, procs, policies, omissions).

**Owner decisions (binding):** standard ICC builds first (usual talents and glyphs, gear around iLvl 251–264, gems,
enchants, consumables and set bonuses as a sourced profile); build and gear are data, so real raid members' characters
can be loaded later; the other 22 raid members stay stand-ins.

## Chosen standard builds (sources in the research notes)

| Spec | Race (to confirm) | Talents | Glyphs | Gear | Sets |
| --- | --- | --- | --- | --- | --- |
| Fire Mage | Gnome | 18/53/0 "TTW" (`23000503110003-0355030010303331053120300351-`) | Fireball, Living Bomb, Molten Armor | avg iLvl 257.1; SP 2883, hit 408, crit 939, haste 491 (gear only) | Bloodmage 5/5 (T10 251) |
| Restoration Druid | Night Elf | 14/0/57 (`05320031-0-230503312031500531250313051`) | Swiftmend, Wild Growth, Nourish | avg iLvl 259.1; SP 3153, spirit 804, haste 444, crit 536 | Lasherweave Regalia 5/5 |
| Protection Paladin | Human | 0/53/18 (MMO-Champion 3.3 guide hash `sZV0tAbuMusIufdgobhbc`) | Divine Plea, Seal of Vengeance, Hammer of the Righteous | avg iLvl 257.9; Sta 2845, defense rating 900 (583 skill), dodge 763, parry 444, armor 26771 | Lightsworn Battlegear 4/5 |

Gear rule: T10 251 from the Emblem of Frost vendor; other slots from what a raid has killed before Festergut 25N (Lower
Spire 25N and 10N, Frost vendor, Ashen Verdict friendly, crafted 264 boots); every item has its `item_template` row and
its loot or vendor row in the research notes. No run-speed enchants (they would change the plan's movement).

## Character profile format (data, not code)

A profile is a YAML file under `classes/<spec>/profiles/` (standard) or, later, `characters/<name>.yaml` (real raid
members). It mirrors what AzerothCore stores for a character, so an armory or signup-site export can be converted:

```yaml
id: std-fire-mage-icc25-p1
source: { kind: configured, file: classes/fire-mage/profiles/standard.yaml, note: "standard 3.3.5a ICC build, research note spec-fire-mage-azerothcore.md" }
class: mage           # player_class_stats Class 8
race: gnome           # player_race_stats Race 7
level: 80
spec: fire_mage       # the policy factory that drives it
talents: "23000503110003-0355030010303331053120300351-"   # Talent.dbc row/column order per tab; validated on load
glyphs: [56368, 63091, 56382]                              # glyph spell ids (major), minors optional
equipment:
  - { slot: head, item: 50276, enchant: 3820, gems: [41285, 40133] }
  - { slot: waist, item: 49978, gems: [40133, 40113, 40113], extraSocket: true }   # Eternal Belt Buckle
  # … one entry per slot; item = item_template entry, enchant = SpellItemEnchantment id, gems = gem item ids
consumables: [flask_of_the_frost_wyrm, fish_feast, potion_of_speed]   # ids of consumable definitions (spell ids inside)
```

The loader (3a-1) validates it (zod), reads class/race base stats, talents (Talent.dbc → spell ids of the learned ranks →
their passive auras), glyph auras, items (stats, armor, weapon, block, sockets, socket bonus, item set, item spells with
their trigger), gems and enchants (SpellItemEnchantment: flat stats, "apply spell" entries become auras), set bonuses
(ItemSet thresholds), racial passives, and produces a unit with base stats and a list of permanent auras. Raid buffs are
*not* in the profile: they come from the plan (stand-in `buffs`, modelled players' own buffs). The values used for one
profile are extracted into a content data file (`packages/content/data/characters/<id>.json`) with provenance (`db` for
`item_template` rows, `spelldata` for DBC rows), so no game file is shipped (D9) and every number keeps its source (§7).

## Sub-plans

Sizes are comparable to Plans 2b-1 / 2b-2 (12–16 tasks each). Each sub-plan ends with `corepack pnpm test && corepack pnpm
typecheck && corepack pnpm golden` green; traces of earlier scenarios change only where a sub-plan says so.

### 3a-1 — Character data and stats

**Goal:** a player unit built from a profile: base stats, all derived stats, mana pool, and stat-changing auras, with the
trace showing resources.

**Engine contract additions:** `Unit.stats` (str/agi/sta/int/spi, AP, SP, healing power, crit %, hit %, haste %,
expertise, defense, dodge/parry/block/miss %, block value, armor, max health, max mana) recomputed by `refreshStats` from
base values + aura stat modifiers (new `StatModifier` kinds from player note §8); `Unit.power` (mana) with
`maxPower`; a `power` event kind (spend, regen tick, energize) and `UnitSnapshot.power` (trace `schemaVersion` bump);
`UnitView.power`/`maxPower` for policies; `PolicyFactory.create` receives a restricted API (contract item 5) and the
loaded character; ratings converted with the level-80 gt tables (data, not code).

**Tasks:**
1. Sources: pin the new client tables (gt*, Talent, TalentTab, SpellItemEnchantment, GemProperties, ItemSet) in
   `PINS`/`sources.md`; record `player_class_stats`, `player_race_stats`, `item_template` usage.
2. Extend the spell extraction: PowerType, ManaCost, ManaCostPercentage, procCharges, baseLevel/spellLevel/maxLevel,
   Category, Stances, EquippedItemClass, SpellIconID, attributes already there; regenerate the Festergut file unchanged.
3. Extraction of item rows (`item_template` → JSON with `db` provenance: table, entry, SQL line) and of the gt/Talent/
   enchant/gem/item-set rows a profile needs (`extract-character` command).
4. Character profile schema (zod) and validation (talent string against Talent.dbc tiers and prerequisites, slots,
   socket counts, unknown ids → `invalid`).
5. Base stats from class + race tables; racial passives as auras.
6. Item totals: stats, armor, sockets with gems, socket bonus rule (colour match), enchants, meta gem condition (as data:
   SpellItemEnchantmentCondition — or an `assumption` that the profile satisfies it, decided here).
7. Stat aura kinds (MOD_STAT, %STAT, TOTAL_STAT_PERCENTAGE, RESISTANCE(+%), AP(+%), SPELL_DAMAGE/HEALING_OF_STAT_PERCENT,
   RATING, RATING_FROM_STAT, INCREASE_HEALTH(%), MOD_CRIT/SPELL_CRIT(_SCHOOL), DODGE/PARRY/BLOCK_PERCENT, SHIELD_BLOCKVALUE(%),
   EXPERTISE, POWER_REGEN(%), MANA_REGEN_INTERRUPT, MANA_REGEN_FROM_STAT, HEALING_PCT, HEALING_DONE_PERCENT).
8. Derived values: health, mana, armor, AP, SP, spell crit, melee crit, hit, haste, expertise (player note §3), worked
   examples by hand for the three profiles.
9. Defense, dodge, parry, miss, block with diminishing returns (StatSystem.cpp 711–838), worked example for the paladin.
10. Talent passives and glyphs as auras on the unit (spell mods are stored but applied in 3a-2).
11. Mana: pool, spend, regeneration with the five-second rule integrated exactly between events (proposed adaptation:
    AzerothCore ticks per map update), `power` events.
12. Raid buffs from stand-ins: `buffs` lists spell ids of real buff spells; applied as permanent auras at engage and removed
    on the stand-in's death (contract item 6).
13. Trace schema bump, snapshot `power`, summary per-player resource line; golden traces re-recorded deliberately (only the
    schema fields change).

**Acceptance:** the three standard profiles load; their unbuffed and buffed character-sheet values match hand
calculations (worked examples in the tests); an invalid profile yields `invalid` with file/path/problem; Festergut
scenarios unchanged except the schema bump.
**Risks:** item and enchant data volume (keep extraction per profile); meta gem conditions; float32 vs double in DR.
**Owner input:** faction/race per spec; whether Rising-Gods character imports will come as armory exports (format of
`characters/*.yaml` later).

### 3a-2 — Spell math, spell modifiers and procs

**Goal:** player spells deal and heal what AzerothCore computes: coefficients, crits, hit, haste, costs, talents, procs.

**Engine contract additions:** `SpellDef` gains `family`, `familyFlags`, `dmgClass`, `powerCost` (flat + % of base
mana), `category`/`categoryCooldownMs`, `startRecoveryCategory`, per-effect `bonusCoefficient` (DBC, overridden by a
`spell_bonus_data` entry: direct/dot/AP/AP-dot), `canCrit`, `periodicCanCrit`; aura `spellMods` (op, flat/pct, class mask,
charges); `ProcDef` on auras (spell_proc fields: type/phase/hit masks, chance/PPM, cooldown, charges) with a dispatcher
and hook API for proc scripts; random streams `unit:<id>.crit`, `.hit`, `.proc` (contract item 3); heals in their real
school (contract item 3).

**Tasks:**
1. `SpellDamageBonusDone/Taken` and `SpellHealingBonusDone/Taken` with coefficients, level penalty and stacks
   (Unit.cpp 8537–8846, 9365–9613); worked example: a Fireball's range from coefficient and spell power (spec §11).
2. Spell modifier engine (ADD_FLAT/PCT_MODIFIER by class mask; ops: damage, duration, crit chance, crit damage bonus,
   cast time, GCD, cost, cooldown, bonus multiplier, DoT, effect 1–3, jump targets, not-lose-casting-time).
3. Mana costs and Spell::TakePower; cast fails with `no_power`; five-second rule hook.
4. Spell hit roll vs level 83 (MagicSpellHitResult), `spell_missed` event; decide partial resists (research + adaptation).
5. Spell crit roll and bonus (+50 %, melee-class +100 %, MOD_CRIT_DAMAGE_BONUS, SPELLMOD_CRIT_DAMAGE_BONUS); heal crits.
6. Haste: cast-speed factor, hasted cast time and GCD (clamped 1.0–1.5 s, category 133), periodic haste where flagged.
7. Cooldown categories and charges on auras (Clearcasting, Hot Streak's mod with charges).
8. Proc dispatcher (ProcSkillsAndAuras order: after hit, on crit, on periodic tick, on cast, on being hit/blocked/dodged)
   with `spell_proc` rows; PPM; per-proc cooldown.
9. Aura scripts with state for procs (the hook API used by 3b–3d).
10. Spell pushback when a caster takes damage, and pushback reduction (Nature's Focus) — research first (Spell::Delayed).
11. Threat modifiers: per-school MOD_THREAT multipliers, SPELLMOD_THREAT, `spell_threat` rows (fetch the SQL), threat of
    healing and energize; stand-ins keep `threatMultiplier`.
12. Trace: `damage`/`heal` events gain `crit`, `blocked`/`missed` kinds; formatter texts.

**Acceptance:** worked examples for one Fireball, one Pyroblast DoT, one Rejuvenation tick, one Holy Shield block hit;
crit/hit streams leave mechanic selections unchanged (randomness guarantee §8.7, test); every DBC/SQL value used has a
source.
**Risks:** the spell-mod mask matching is the largest correctness surface; proc order in one millisecond needs an
adaptation entry; partial resists may change damage by ~5 % against a +3 boss.
**Owner input:** none expected.

### 3a-3 — Melee, tanking and ground effects

**Goal:** a modelled tank: player auto-attacks, the boss's attack table against a player (with crits, crushing blows and
blocks), parry haste, chain targets and a ground area effect.

**Engine contract additions:** player `MeleeStats` from the weapon (min/max, speed, AP/14 normalisation), player swing
loop independent of the cast bar (players swing while casting instants; a cast-time spell does not stop auto-attack —
check SPELL_ATTR*), `RollMeleeOutcomeAgainst` for player victims (miss/dodge/parry/glancing/block/crit/crushing/hit) and
for boss victims (expertise, weapon skill), block value reduction, parry haste on the boss (flags_extra check), area
effect `chain` (jump targets), ground area at a position with periodic ticks (contract item 12, Consecration), taunt as a
spec spell (A-023 retired for modelled tanks), a plan trigger `threat_target` (the 2b-2 finding) and an action
`cast_spell` for spec cooldowns (Divine Protection) if `use_cooldown` does not cover it.

**Tasks:**
1. Research note: creature attack table vs players at the pinned commit (crit, crushing, glancing, block) and parry haste,
   with Festergut's `flags_extra`.
2. Player weapon damage and swing timer; melee haste and attack speed (A-031 reused).
3. Player attack table against the boss (miss 8 %, dodge 6.5 %, parry 14 % at +3 levels, glancing for auto-attacks only),
   expertise; worked example.
4. Boss attack table against a player: miss/dodge/parry from the player's stats, block chance and value, crit 5.6 % −
   defense, crushing 15 % at level difference 3 (A-022 revised); worked example "uncrushable".
5. Parry haste.
6. Weapon-damage and block-value spell effects (HotR, SoR, Seal of Vengeance's weapon %), AP coefficients.
7. Chain targets (HotR 3–4, Avenger's Shield 3).
8. Ground area with periodic ticks at a fixed position (Consecration), traced as an area object.
9. Taunt spell (Hand of Reckoning) and the plan's `taunt` action using the spec's taunt when the actor has one.
10. Rule trigger `threat_target` (the boss's victim changes to/away from a unit) and its validation.
11. Cooldown actions for spec spells from plan rules (Divine Protection at a health threshold; Barkskin on Gas Spore).

**Acceptance:** worked examples for a paladin swing, a blocked boss swing, a crushing blow on an unbuffed tank and none on
the standard profile; the late-tank-swap scenario's cause chain still links to the rule threshold.
**Risks:** this is the biggest gap: the current boss melee (A-022) has no crit/crushing/block, so every Festergut number
for the tank changes; Consecration needs a new kind of area; threat after a swap can flip back.
**Owner input:** none.

### 3b — Fire Mage

**Goal:** `classes/fire-mage/` with the standard profile, abilities, procs, priority policy and SUPPORT.md.
**Engine contract additions:** none beyond 3a (script hooks for Hot Streak, Ignite, Living Bomb, Burnout, Master of
Elements, Empowered Fire, Combustion).
**Tasks:**
1. Spell data extraction for the mage spells and auras (ids in the research note), pinned.
2. Profile `classes/fire-mage/profiles/standard.yaml` and its character data file.
3. Spells and auras from data: Fireball, Pyroblast, Living Bomb (+ explosion), Scorch, Fire Blast, Molten Armor, Arcane
   Intellect, Evocation, Combustion.
4. Talent and glyph auras checked against expected modifiers (unit tests per talent).
5. Proc scripts: Hot Streak (two-crit counter), Ignite (rolling), Master of Elements, Burnout, Empowered Fire,
   Clearcasting, Improved Scorch debuff, Combustion stacks, T10 2p Push the Button.
6. Trinket and gem effects in scope (Muradin's Spyglass stacks, Sliver of Pure Ice on-use, meta crit damage).
7. Priority policy (research §7) with movement handling and the Scorch rule (skip when a stand-in provides the debuff).
8. Worked examples: a Fireball crit with Ignite; Hot Streak → instant Pyroblast.
9. Dummy scenario: the mage alone on the training dummy for 3 minutes (DPS sanity band, documented).
10. SUPPORT.md (build, abilities with mechanics status, modelled effects, known omissions, policy, validation status).
**Acceptance:** dummy DPS within a documented band from period sources (`configured`); every ability's mechanics status
listed; no `assumption` in the spec's numbers except policy thresholds.
**Risks:** Ignite's "bug" implementation in AzerothCore (CastDelayedSpellWithPeriodicAmount) must be read exactly.
**Owner input:** race; whether Mirror Image (pets) can stay out.

### 3c — Restoration Druid

**Goal:** `classes/restoration-druid/` with profile, HoTs, smart heals, healer targeting and SUPPORT.md.
**Engine contract additions:** smart area target selection (lowest health % in radius, max N), an aura that reads and
consumes another aura (Swiftmend), stacking HoT with expiry heal (Lifebloom), party aura from a form (Tree of Life).
**Tasks:**
1. Spell data extraction for the druid spells, pinned.
2. Profile and character data.
3. Rejuvenation, Regrowth, Lifebloom (+ bloom and mana return), Nourish (+ HoT bonus, glyph), Wild Growth (target filter,
   tick curve), Swiftmend (consumption, glyph), Healing Touch, Nature's Swiftness, Innervate, Barkskin, Mark of the Wild.
4. Tree of Life form and its party aura; Master Shapeshifter, Improved Tree of Life.
5. Procs: Nature's Grace, Omen of Clarity (3.5 PPM), Revitalize (modelled mana users only), T10 2p/4p, idol, trinkets.
6. Healing policy (research §7) with thresholds as `assumption` entries, using only visible information.
7. Worked examples: one Rejuvenation tick with coefficient and talents; a Wild Growth target set.
8. Dummy scenario: the druid healing a stand-in tank on the training dummy (HPS and mana over 3 minutes).
9. SUPPORT.md.
**Acceptance:** HoT amounts and mana match worked examples; targeting picks the lowest-health-% player with the tank rule;
mana lasts a 5-minute fight with the assumed regen buffs (documented).
**Risks:** WG target filter is a script; healers decide whether players survive (limitation report §6.4).
**Owner input:** glyph choice (Nourish vs Rapid Rejuvenation); race/faction.

### 3d — Protection Paladin

**Goal:** `classes/protection-paladin/` with profile, 96969 rotation, defensive mechanics, taunt and SUPPORT.md.
**Engine contract additions:** none beyond 3a-3.
**Tasks:**
1. Spell data extraction for the paladin spells, pinned.
2. Profile and character data (uncrushable check as a test).
3. Shield of Righteousness, Hammer of the Righteous, Judgement (+ Judgement of Light/Wisdom, Judgements of the Just),
   Seal of Vengeance (+ Holy Vengeance, seal damage), Holy Shield, Consecration, Avenger's Shield, Holy Wrath, Exorcism.
4. Righteous Fury, Devotion Aura, Blessing of Sanctuary (+ mana returns), Divine Plea, Spiritual Attunement.
5. Defensive talents: Ardent Defender (script), Redoubt, Shield of the Templar, Improved RF, Divine Protection, Lay on Hands.
6. Hand of Reckoning as the plan taunt; off-tank behaviour.
7. Procs: set 2p/4p, libram, Blood Draining, trinkets (decide in scope/omitted per research §9).
8. Rotation policy (96969) and plan-rule cooldowns.
9. Worked examples: Shield of Righteousness hit; a boss swing on the standard profile.
10. Dummy scenario: the paladin tanking the training dummy (threat per second, damage taken).
11. SUPPORT.md.
**Acceptance:** no crushing blows on the standard profile, threat per second within a period band (`configured`),
every ability's status listed.
**Risks:** Consecration ground effect; threat lead after a taunt swap with a stand-in co-tank.
**Owner input:** race; whether Divine Sacrifice/Guardian should be used by the plan.

### 3e — Festergut with the three specs

**Goal:** the Gate 1 scenarios with the three modelled specs, honest stand-ins, SUPPORT.md files linked from the
limitation report, new golden runs.
**Tasks:**
1. Roster changes: `t1` → protection paladin, one healer (`h1`) → restoration druid, one ranged (`r01`) → fire mage.
2. Stand-in buffs: the plan lists the raid buffs per stand-in (real spells); the limitation report lists them.
3. Re-tune the stand-ins honestly: the stand-in tank `t2`'s profile from a real tank's numbers (the paladin profile's
   avoidance and armor as reference), the generic healer and caster rates re-derived (`assumption` entries with
   rationale), documented in an adaptation (A-039 revised).
4. Tank-swap rules with Hand of Reckoning and, if needed, the `threat_target` trigger; Divine Protection rule for the
   three-stack phase.
5. Healer and mage behaviour during Gas Spore runs (the existing rules move them; policies keep casting instants).
6. Scenario observations re-checked (clean kill, missed spore group with the mage as the missing player, late tank swap
   with the paladin as the tank that explodes or swaps late).
7. Spec support statuses in the summary (contract item 7: decision-policy status, per-spec statuses).
8. Determinism and randomness-guarantee tests with the new crit/hit/proc streams.
9. Golden runs re-recorded deliberately; CLI outputs in the plan.
10. Gate 1 checklist against spec §4/§11; open questions for Gate 2.
**Acceptance:** spec §4 Gate 1: all §11 tests pass; each scenario's intended observation holds with modelled specs; the
limitation report lists every stand-in (22) and every assumption, and links the three SUPPORT.md files.
**Risks:** the fight may become harder or easier with real tank mechanics (crushing/crit) and real healers; tuning stand-ins
"honestly" means deriving their rates from sources, not from wanting a kill — if the clean kill fails, the plan changes,
not the numbers.
**Owner input:** which raid members (names) the three modelled players represent; acceptable kill-time band for the clean
kill.

## Engine gaps bigger than expected

1. **Boss melee against a player** has no crit, crushing blow or block (A-022). A modelled tank needs the full attack table;
   this changes every tank number in the Festergut scenarios (3a-3).
2. **Spell modifiers** (talent/glyph class-mask modifiers) are the backbone of every talent; they touch cast time, GCD,
   cost, crit, damage, duration, cooldown and coefficients — a cross-cutting change in `casting.ts`, `launch.ts`,
   `effects.ts`, `auras.ts` (3a-2).
3. **Procs** need a dispatcher with AzerothCore's event/phase/hit masks and per-proc state; today only aura hooks on
   apply/stack/remove exist (3a-2).
4. **Ground effects** (Consecration) and **chain targets** (HotR, Avenger's Shield) do not exist (3a-3).
5. **Resources in the trace** bump the schema and re-record every golden run (3a-1).
6. **Item and enchant data** is large; the extraction must stay per profile to keep the repo free of bulk game data.
7. **Spell pushback** affects the mage and the druid during Vile Gas and spores; not researched yet (3a-2 task 10).

## Open questions for the owner

1. Faction and races: Alliance (Human paladin, Night Elf druid, Gnome mage) assumed; Horde would change racials and the
   Seal (Corruption).
2. Builds: confirm the three talent strings and glyph choices (Nourish vs Rapid Rejuvenation for the druid).
3. Gear: the item lists in the research notes — acceptable as "typical at Festergut progression", or should they follow a
   real raid member's gear?
4. Which roster slots the modelled players take (`t1`, `h1`, `r01` proposed) and which raid members they represent.
5. Out-of-scope items: pets (Mirror Image, Nibelung's Val'kyr), absorbs (Sacred Shield), raid cooldowns (Divine Sacrifice).
6. Real characters later: what export format the signup site or the Rising-Gods armory provides.
