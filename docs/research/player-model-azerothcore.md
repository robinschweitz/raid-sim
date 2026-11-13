# How AzerothCore models a level-80 player (research for Plan 3)

Status: research note, 2026-11-13. Written before Plan 3; nothing here is implemented yet.

Sources: AzerothCore at the pinned commit `dca1a87699e380f3c19af54f9003d837c696131d` (short names below:
`Player.cpp`, `StatSystem.cpp`, `Unit.cpp`, `Object.cpp`, `Spell.cpp`, `SpellInfo.cpp`, `ThreatManager.cpp`, all under
`src/server/game/…`; SQL under `data/sql/base/db_world/`), and the owner's 3.3.5a client (`E:\WoW_3.3.5a_rising-gods.de`,
deDE), read with a scratch copy of `packages/tools` (MPQ reader) into a scratch folder. Spell.dbc read this way has the
pinned hash `a17bfd2d4b0a`; the further client tables used here are **not pinned yet** (Plan 3a task):

| File | Archive | SHA-256 prefix |
| --- | --- | --- |
| gtCombatRatings.dbc | Data/deDE/patch-deDE.MPQ | `92f4ef0247f6` |
| gtOCTClassCombatRatingScalar.dbc | Data/deDE/patch-deDE-2.MPQ | `7a4f0d2bdf16` |
| gtChanceToMeleeCrit.dbc / …Base.dbc | Data/deDE/patch-deDE.MPQ | `2acb54ef9c47` / `e2a82b78cb1a` |
| gtChanceToSpellCrit.dbc / …Base.dbc | Data/deDE/locale-deDE.MPQ | `8ec9ba057920` / `45963fe68a42` |
| gtRegenMPPerSpt.dbc | Data/deDE/patch-deDE-2.MPQ | `06b8000be88c` |
| gtOCTRegenMP.dbc | Data/deDE/locale-deDE.MPQ | `503758abb3ce` |
| Talent.dbc / TalentTab.dbc | patch-deDE-2.MPQ / patch-deDE.MPQ | `23aefff3add1` / `777ba2cad6a2` |
| SpellItemEnchantment.dbc | Data/deDE/patch-deDE-3.MPQ | `bfbc2c54c2f4` |
| GemProperties.dbc | Data/deDE/patch-deDE.MPQ | `f8ec92e43ad7` |
| ItemSet.dbc | Data/deDE/patch-deDE-2.MPQ | `504c0778cb01` |

Each item ends with **Gate 1: needed / not needed / partly** for the three Gate 1 specs (Protection Paladin, Restoration
Druid, Fire Mage on Festergut 25n).

---

## 1. What exists in the engine today (the gap)

`packages/engine/src` models units with fixed `maxHealth`, `armor`, `avoidance` (miss/dodge/parry), a creature-style
`melee` (min/max/attack time), a `threatMultiplier`, auras with damage/attack-speed/scale modifiers, casts with a static
`castTimeMs`/`gcdMs`/`cooldownMs` from the `SpellDef`, heals and damage with fixed `min..max`, threat on damage and
healing, and a policy controller. There is **no**: resource (mana), stat, rating, spell power, coefficient, crit, hit roll,
haste, spell modifier (talents), proc, player melee swing, block, parry haste, crushing blow, threat modifier per school,
gear, glyph, or talent data. Every item below is new work unless it says otherwise.

## 2. Base stats at level 80 — Gate 1: needed

AzerothCore no longer uses `player_levelstats`; at this commit the tables are `player_class_stats` (class × level: base
health, base mana and the five stats) and `player_race_stats` (race offsets to the five stats), loaded by
`ObjectMgr` (`PlayerInfo`). Values at level 80:

| Class | `player_class_stats.sql` line | BaseHP | BaseMana | Str | Agi | Sta | Int | Spi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paladin (2) | 203 | 6934 | 4394 | 151 | 90 | 143 | 98 | 105 |
| Mage (8) | 629 | 6963 | 3268 | 36 | 43 | 59 | 181 | 174 |
| Druid (11) | 789 | 7417 | 3496 | 89 | 82 | 98 | 143 | 159 |

Race offsets (`player_race_stats.sql` lines 41–50, columns Str/Agi/Sta/Int/Spi): Human (1) 0/0/0/0/0 (41); Dwarf (3)
+5/−4/+1/−1/−1; Night Elf (4) −4/+4/0/0/0 (44); Gnome (7) −5/+2/0/+3/0; Draenei (11) +1/−3/0/0/+2 (50); Tauren (6)
+5/−4/+1/−4/+2; Blood Elf (10) −3/+2/0/+3/−2; Troll (8) +1/+2/0/−4/+1; Undead (5) −1/−2/0/−2/+5. (Line numbers for the
rows other than 41, 44, 50 are the row's position in the same INSERT; Plan 3a records each one.)

Racial passives (Expansive Mind +5 % Int, Human Spirit +3 %, Mace/Sword Specialization expertise, Heroic Presence) are
spells in Spell.dbc, applied as passive auras; they are part of the character profile (§12), not of these tables.

## 3. Stats → derived values

### 3.1 Total stat — needed
`Player::UpdateStats` (`StatSystem.cpp` 97–165): value = ((base × base_pct) + total_value) × total_pct
(`GetTotalStatValue`), truncated to `int32` (103–105). Base = class + race; total_value = gear, enchants, gems, buffs
(MOD_STAT auras); pct = MOD_PERCENT_STAT / MOD_TOTAL_STAT_PERCENTAGE auras (Blessing of Kings +10 %, Divine Strength,
Expansive Mind, Survival of the Fittest…). Dependents are recomputed on every change (stamina → health, intellect → mana,
spell crit, armor via MOD_RESISTANCE_OF_STAT_PERCENT; agility → armor, crit, dodge; strength → AP, block value).

### 3.2 Health and mana — needed
- `GetHealthBonusFromStamina` (`StatSystem.cpp` 293–301): first 20 stamina give 1 health each, the rest 10.
- `UpdateMaxHealth` (313–324): (flat BASE + create health) × BASE_PCT + TOTAL flat + stamina bonus, × TOTAL_PCT.
- `GetManaBonusFromIntellect` (303–311): first 20 intellect 1 mana each, the rest 15.
- `UpdateMaxPower` (326–339): same shape with create mana and the intellect bonus.

### 3.3 Armor — needed (paladin; also every player's armor against Festergut's melee? only the tank is hit)
`Player::UpdateArmor` (`StatSystem.cpp` 269–291): (items BASE × BASE_PCT) + 2 × agility + TOTAL flat (+ % of a stat via
MOD_RESISTANCE_OF_STAT_PERCENT), × TOTAL_PCT (Toughness +10 % armor from items is BASE_PCT; Devotion Aura is flat TOTAL).
Armor reduction itself is already in `melee.ts` (`Unit.cpp` 2233–2300).

### 3.4 Attack power — needed (paladin: Shield of Righteousness, Hammer of the Righteous, Seal of Vengeance, melee; mage/druid no)
`Player::UpdateAttackPowerAndDamage` (`StatSystem.cpp` 347–537): Paladin melee AP = 3 × level + 2 × Str − 20 (395–398);
plus MOD_ATTACK_POWER auras, MOD_ATTACK_POWER_PCT, and AP-of-stat/AP-of-armor auras. Druid caster form AP is not used.
`GetTotalAttackPowerValue` (`Unit.cpp` 11970).

### 3.5 Spell power — needed
Gear spell power is applied as `ApplySpellPowerBonus` (`StatSystem.cpp` 167–175: `m_baseSpellPower` added to damage and
healing). `SpellBaseDamageBonusDone` (`Unit.cpp` 8848) and `SpellBaseHealingBonusDone` (9615) sum it with
MOD_DAMAGE_DONE / MOD_HEALING_DONE auras by school mask and the spell-power-from-stat auras (MOD_SPELL_DAMAGE_OF_STAT_PERCENT,
MOD_SPELL_HEALING_OF_STAT_PERCENT: Nurturing Instinct, Improved Tree of Life (spirit → healing), Lunar Guidance;
MOD_SPELL_DAMAGE_OF_ATTACK_POWER: Touched by the Light for the paladin, Str → SP; Mage Armor/Molten Armor
are crit/regen, not SP). Paladin Sheath of Light / Touched by the Light matter for Judgement, Consecration, Holy Shield,
Avenger's Shield coefficients.

### 3.6 Crit — needed
- Melee crit (`UpdateCritPercentage`, `StatSystem.cpp` 658–696): agility crit (`GetMeleeCritFromAgility`, `Player.cpp`
  5284–5299: `gtChanceToMeleeCritBase[class] + agi × gtChanceToMeleeCrit[class, level]`, × 100) + crit auras + rating +
  0.04 per weapon skill above the level cap.
- Spell crit (`UpdateSpellCritChance`, 840–863): `GetSpellCritFromIntellect` (`Player.cpp` 5354–5369:
  `gtChanceToSpellCritBase[class] + int × gtChanceToSpellCrit[class, level]`, × 100) + MOD_SPELL_CRIT_CHANCE +
  MOD_CRIT_PCT + MOD_SPELL_CRIT_CHANCE_SCHOOL (by school) + crit rating. Per-spell additions (talents with
  SPELLMOD_CRITICAL_CHANCE: Incineration, Critical Mass, Glyph of Fireball…) come from spell mods in
  `SpellDoneCritChance` (`Unit.cpp` 8893–8981) and the target's MOD_ATTACKER_SPELL_CRIT_CHANCE (Improved Scorch / Shadow
  Mastery / Winter's Chill debuff) in `SpellTakenCritChance` (8983–).
- Client values at level 80 (scratch extraction; row = (class−1) × 100 + level − 1):

| Class | Melee crit base | Melee crit per agi | Spell crit base | Spell crit per int |
| --- | --- | --- | --- | --- |
| Paladin | 0.032685 | 0.000192 | 0.033355 | 0.00006 |
| Mage | 0.034540 | 0.000196 | 0.009075 | 0.00006 |
| Druid | 0.074755 | 0.000120 | 0.018515 | 0.00006 |

  (So 166.67 intellect per 1 % spell crit for all three; base spell crit 3.34 / 0.91 / 1.85 %.)
- Crit damage: `SpellCriticalDamageBonus` (`Unit.cpp` 9201–9238): magic spells +50 %, melee/ranged-class spells +100 %;
  MOD_CRIT_DAMAGE_BONUS by school (the meta gem Chaotic Skyflare/Relentless Earthsiege "3 % increased critical damage" is
  an aura of this type) is added as a percentage of the doubled amount, then SPELLMOD_CRIT_DAMAGE_BONUS (Burnout, Spell
  Power talent) adds to the bonus part. Heals: `SpellCriticalHealingBonus` (9240–9277): +50 % for magic, then
  MOD_CRITICAL_HEALING_AMOUNT multiplier (meta gem "Revitalizing Skyflare" is 3 % crit *healing*? — no: Revitalizing is
  +3 % crit effect; checked in Plan 3c).
- Melee crit multiplier for the paladin's swings: 2× (CalculateMeleeDamage, `Unit.cpp` 1684–).
- Ignite, Living Seed and similar "on crit" effects are procs (§9), not crit math.

### 3.7 Hit — needed (mage, paladin); not needed for heals
- Spell hit (`WorldObject::MagicSpellHitResult`, `Object.cpp` 3541–3687): base hit 96 − levelDiff for levelDiff < 3, else
  94 − (levelDiff − 2) × multiplier (3591–3593); the multiplier is the world config `RATE_MISS_CHANCE_MULTIPLIER_TARGET_CREATURE`
  (11 per the source comment at 3572; default to be read from `worldserver.conf.dist` in Plan 3a). Against Festergut
  (level 83, boss) this is 94 − 11 = 83 % → 17 % miss before hit rating; capped at 1 % miss. Rating/aura hit is added
  (`UpdateSpellHitChances`, `StatSystem.cpp` 883–887; MOD_INCREASES_SPELL_PCT_TO_HIT by school, 3596–3597).
- Melee hit / weapon skill: 8 % miss vs a level-83 boss for a player at skill 400 (RollMeleeOutcomeAgainst,
  `Unit.cpp` 3013–; GetUnitMissChance 3594). Special attacks (HotR, SoR) use `MeleeSpellHitResult` (3359–).
- Rating at 80: spell hit 26.232 rating per 1 %, melee hit 32.79 (gtCombatRatings, see §4).

### 3.8 Expertise — needed (paladin)
`UpdateExpertise` (`StatSystem.cpp` 895–926): rating bonus + MOD_EXPERTISE (Combat Expertise, Glyph of Seal of Vengeance,
Human racial for swords/maces via EquippedItemClass filter). Each expertise point removes 0.25 % dodge and parry
(`GetExpertiseDodgeOrParryReduction`, `Player.cpp` 5392–5404). 8.1975 rating per expertise point at 80. Boss dodge 6.5 %
and parry 14 % against level-83 targets come from the creature side (GetUnitDodgeChance / GetUnitParryChance,
`Unit.cpp` 3547, 3564) — to be read in Plan 3a, together with the level-difference adjustment.

### 3.9 Defense, dodge, parry, block, avoidance diminishing returns — needed (paladin)
- Defense skill: base 400 at 80 (`GetMaxSkillValueForLevel`, `Player.cpp` 16674) + rating / 4.9185. Defense above 400 gives
  0.04 % each to miss, dodge, parry, block, and reduces the attacker's crit chance by 0.04 % each (crit-immunity at 540
  against level 83: 5.6 % = 140 × 0.04).
- Miss (`GetMissPercentageFromDefence`, `StatSystem.cpp` 726–751): 5 % base (in `GetUnitMissChance`) + non-diminishing
  (base defense) + diminishing (rating defense) with cap 16 and k = 0.956 (paladin, `m_diminishing_k`, 711–724).
- Parry (`UpdateParryPercentage`, 753–797): 5 % + defense + MOD_PARRY_PERCENT (Deflection) non-diminishing; parry rating
  (45.25 per %) + rating defense diminishing with cap 47.003525 for paladins; the roll uses `m_realParry`.
- Dodge (`UpdateDodgePercentage`, 799–838; `GetDodgeFromAgility`, `Player.cpp` 5301–5352): base 0.034943 (paladin) + base
  agility × crit-per-agi × 1/1.15 non-diminishing; bonus agility and dodge rating (45.25 per %) diminishing with cap
  88.129021.
- Block (`UpdateBlockPercentage`, 633–656): 5 % + defense × 0.04 + MOD_BLOCK_PERCENT (Holy Shield +30 %, Redoubt) + rating
  (16.395 per %), no diminishing return. Block value (`GetShieldBlockValue`, `Player.cpp` 5275–5282): (flat block value from
  the shield and auras + Str × 0.5 − 10) × pct mods (Redoubt? no: Shield Specialization-like talents, Glyph of Holy Shield…).
- **Creature attacks against the player**: Festergut's swings roll miss/dodge/parry/block/crit/crushing on the attack
  table (`RollMeleeOutcomeAgainst`, `Unit.cpp` 3013–3190): crushing blows from level-83 creatures (skill difference 15 →
  15 % crushing, 150 % damage) unless the table is full, crits 5.6 % minus defense; blocks reduce by block value. The
  engine's boss melee (A-022) has neither crit, crushing nor block — **this is the biggest correctness gap for the tank**
  (a real paladin must be "uncrushable": 102.4 % miss+dodge+parry+block with Holy Shield).

### 3.10 Mana regeneration and the five-second rule — needed
- `Player::UpdateManaRegen` (`StatSystem.cpp` 939–971): spirit regen = `sqrt(Int) × OCTRegenMPPerSpirit()` per second,
  where `OCTRegenMPPerSpirit` = Spirit × gtRegenMPPerSpt[class, level] (`Player.cpp` 5429–5446; 0.003345 at 80 for all
  three classes), × MOD_POWER_REGEN_PERCENT; MP5 = (MOD_POWER_REGEN + item MP5 `m_baseManaRegen`) / 5 per second plus
  MOD_MANA_REGEN_FROM_STAT (percent of a stat per 5 s: Molten Armor? no — Mage Armor; Replenishment is a periodic energize,
  below). While casting ("interrupted") only MP5 + MOD_MANA_REGEN_INTERRUPT % of spirit regen (cap 100 %: Meditation-like
  talents, Intensity for druids, Mage Armor 50 %, Arcane Meditation) — 960.
- `Player::Regenerate(POWER_MANA)` (`Player.cpp` 1886–2026) runs from `RegenerateAll` (1803–1883) on every player
  update with the elapsed time: mana += rate × 0.001 × elapsed, with a carried fraction (`m_powerFraction`); the
  interrupted rate applies when `IsUnderLastManaUseEffect()` (`Unit.cpp` 13331–13334: less than 5000 ms since the last mana
  spend, set in `Spell::TakePower`, `Spell.cpp` 5505–5569). The player update interval is the map update (A-002's 10 ms);
  the engine can integrate regeneration exactly per event instead (proposed adaptation in Plan 3a).
- Replenishment (Revitalize? no: Judgements of the Wise, Vampiric Touch, Hunting Party, Improved Soul Leech, Enduring
  Winter) restores 0.2 % of max mana per second as a periodic energize on up to 10 party/raid members. The Restoration
  Druid's Revitalize procs a mana return, not Replenishment. For Gate 1 Replenishment comes from a stand-in (configured
  buff, §13).

### 3.11 Haste — needed
- Spell haste: `UNIT_MOD_CAST_SPEED` starts at 1 and is changed by `ApplyCastTimePercentMod` (`Unit.cpp` 13154–13164;
  each effect multiplies by 1/(1+x/100)); haste rating calls it via `Player::ApplyRatingMod` (`Player.cpp` 5448–5480,
  32.79 rating per 1 % at 80), MOD_CASTING_SPEED_NOT_STACK / MOD_MELEE_RANGED_HASTE auras (Bloodlust/Heroism 30 %, Wrath of
  Air 5 %, Moonkin aura/Swift Retribution 3 %, Nature's Grace 20 %, Celestial Focus 3 %) multiply it.
- Cast time: `WorldObject::ModSpellCastTime` (`Object.cpp` 3502–3539): SPELLMOD_CASTING_TIME (Improved Fireball −0.5 s,
  Hot Streak's instant Pyroblast via −100 %) first, then × MOD_CAST_SPEED for DmgClass MAGIC (and for NONE only with
  SPELL_ATTR5_SPELL_HASTE_AFFECTS_PERIODIC). Cast time via `SpellInfo::CalcCastTime` (`SpellInfo.cpp` 2792–).
- GCD: `Spell::TriggerGlobalCooldown` (`Spell.cpp` 9266–9310): StartRecoveryTime (1500), SPELLMOD_GLOBAL_COOLDOWN, then ×
  cast speed only for StartRecoveryCategory 133 and non-melee/ranged non-ability spells, clamped to 1000..1500 ms (MIN_GCD,
  MAX_GCD). So the paladin's melee abilities keep a 1.5 s GCD; spells get hasted GCDs.
- Periodic haste: an aura's tick period and duration are hasted when the caster has SPELL_AURA_PERIODIC_HASTE affecting the
  spell (Glyph of Rapid Rejuvenation) or the spell has SPELL_ATTR5_SPELL_HASTE_AFFECTS_PERIODIC (`Spell.cpp` 3306–3312,
  4258; `SpellAuras.cpp` 944, 988; `SpellAuraEffects.cpp` 650). In 3.3.5 Living Bomb, Lifebloom, Rejuvenation etc. are not
  hasted unless one of these applies — Plan 3c checks the attribute per spell.
- Melee haste: swing interval × attack-speed factor; the engine already rescales a running swing (A-031).

### 3.12 Combat rating conversion at 80 — needed
`Player::GetRatingMultiplier` (`Player.cpp` 5371–5385) = gtOCTClassCombatRatingScalar[(class−1) × 32 + cr + 1] /
gtCombatRatings[cr × 100 + level − 1]; `GetRatingBonusValue` (5387–5390) = rating × multiplier. The scalar file's rows
carry ids starting at 1 (row 0 has id 1), so id `(class−1)·32 + cr + 1` is row `(class−1)·32 + cr`. Values at 80, the
same for paladin, mage and druid:

| Rating | Rating per 1 % (or per point) |
| --- | --- |
| Defense skill | 4.9185 per skill point |
| Dodge / parry | 45.2502 |
| Block | 16.3950 |
| Melee hit / haste | 32.7900 |
| Spell hit | 26.2320 |
| Melee / spell crit | 45.9060 |
| Spell haste | 32.7900 |
| Expertise | 8.1975 per expertise point (4 points = 1 %) |
| Armor penetration | 13.996 (gt 15.3953 / class scalar 1.1) |

The diminishing returns in §3.9 use these percentages before the DR formula.

## 4. Spell damage and healing — needed

### 4.1 Amount pipeline
- Base points: `SpellInfo::CalcValue` (the engine has `basePoints + 1..dieSides`, SpellInfo.cpp 409–447) plus
  `RealPointsPerLevel × (level − baseLevel)` capped at maxLevel for spells that scale (most player spells have 0; the
  extraction must add `baseLevel`/`spellLevel`/`maxLevel`, missing today). Talent spell mods SPELLMOD_DAMAGE /
  SPELLMOD_EFFECT1..3 / SPELLMOD_ALL_EFFECTS change the value before the bonus (`Player::ApplySpellMod`, `Player.cpp`
  10035–10115).
- `Unit::SpellDamageBonusDone` (`Unit.cpp` 8537–8709): skipped for DIRECT_DAMAGE (weapon) and SPELL_ATTR3_IGNORE_CASTER_MODIFIERS;
  DoneTotalMod = `SpellPctDamageModsDone` (8209–: MOD_DAMAGE_PERCENT_DONE by school — Fire Power, Molten Fury vs <35 %,
  Arcane Power, Avenging Wrath, Righteous Fury? no — plus class scripts); DoneAdvertisedBenefit = SpellBaseDamageBonusDone
  (spell power for the school) + class-script flat bonuses; the coefficient is the DBC `EffectBonusMultiplier[effIndex]`
  (8668), **overridden by `spell_bonus_data`** (`direct_bonus` / `dot_bonus`, plus `ap_bonus` / `ap_dot_bonus` × AP, 8669–
  8695); with no row and DmgClass NONE no spell power is added (8697–8702); coefficient × level penalty
  (`CalculateLevelPenalty`, 3248: spells below level 20) × stacks, SPELLMOD_BONUS_MULTIPLIER (Empowered Fire, Empowered
  Rejuvenation, Empowered Touch raise the coefficient) (8706–8714); result = (base + DoneTotal) × DoneTotalMod, then
  SPELLMOD_DAMAGE / SPELLMOD_DOT (talents in %, e.g. Fire Power? no — Improved Moonfire, Glyph of Living Bomb crits) on the
  result (8716–8720).
- `SpellDamageBonusTaken` (8711–8846): the target's MOD_DAMAGE_PERCENT_TAKEN (already in the engine as `damage_taken_pct`),
  MOD_SCHOOL_DAMAGE_TAKEN (Curse of the Elements / Earth and Moon / Ebon Plaguebringer 13 % spell damage taken, a raid
  debuff provided by a stand-in) and flat taken bonuses.
- Healing: `SpellHealingBonusDone` (9365–9483) the same with `SpellPctHealingModsDone` (9279–: MOD_HEALING_DONE_PERCENT —
  Tree of Life aura? no, Master Shapeshifter, Gift of Nature applies via spell mods; Nurturing Instinct no) and
  `SpellBaseHealingBonusDone`; `SpellHealingBonusTaken` (9485–9613) applies the target's MOD_HEALING_PCT /
  MOD_HEALING_RECEIVED (Tree of Life aura +6 %? → check: in 3.3 the Tree of Life passive increases healing received;
  Divine Hymn, Guardian Spirit, the paladin's Divine Guardian? no). **Festergut players have no healing-taken modifiers from
  the boss** in 25n (no Mortal Wound-like debuff).
- Order of the final modifiers matches the engine's per-step truncation (A-017, A-026): done (with coefficient), crit,
  taken, area, absorb (absorbs: Sacred Shield, Divine Aegis from stand-ins — not modelled in Gate 1).

### 4.2 `spell_bonus_data` and DBC coefficients
`spell_bonus_data.sql` rows by spell id (first rank; ranks share the first rank's row through `spell_ranks`). Plan 3b–3d
list the rows they use with line numbers. Where no row exists the DBC `EffectBonusMultiplier` applies (most 3.3 spells
have their coefficient there, e.g. Fireball 1.0 × talents).

### 4.3 Crit roll for spells
`Spell::DoAllEffectOnTarget`/`HandleLaunchPhase` roll crit per target (`Unit::SpellTakenCritChance` for the victim side),
with the player's random generator; our streams: `player:<id>.crit` (spec §8.7). Periodic ticks only crit when an aura
enables it (Glyph of Living Bomb? no — 3.3 Living Bomb ticks can crit via its own aura? to verify in 3b; Ignite never
crits).

### 4.4 Spell hit roll
`MagicSpellHitResult` (§3.7) for damaging spells against Festergut; heals and self-buffs never miss. Partial resists:
`CalcAbsorbResist` (`Unit.cpp` 2344–) — bosses at level 83 have an average 6 % level-based resist for spells that are
not binary? In 3.3 every non-binary spell against a +3 level target suffers a level-based partial resist
(~ 2 % per level difference × ...); **to research in 3a** (not cited yet; mark `partial` if left out).

## 5. Mana costs — needed
`SpellInfo::CalcPowerCost` (`SpellInfo.cpp` 2843–): ManaCost + ManaCostPercentage × **create (base) mana** (2870–2873;
paladin 4394, mage 3268, druid 3496 at 80, §2) + school cost modifiers, then SPELLMOD_COST (Pyromaniac? no: Frost Channeling,
Moonglow −9 %, Tree of Life −20 % HoTs, Benediction, Glyph of Divine Plea…) (2905–2907). Spent in `Spell::TakePower`
(`Spell.cpp` 5505–), which also sets the five-second rule. The client column `ManaCostPercentage` (204) and `PowerType`
(41) are **not extracted today** (Plan 3a extends the extraction).

Mana returns: Master of Elements (30 % of base cost on crit), Illumination (paladin, not taken), Seals of the Pure? no;
Judgements of the Wise (paladin, 25 % of base mana over 10 s? — actually Judgements of the Wise gives Replenishment and
25 % of base mana), Divine Plea (25 % max mana over 15 s, −50 % healing done), Empowered Fire (Ignite ticks restore 2 % base
mana), Burnout (+1 % base mana cost on crit), Revitalize (druid, 1 % mana on Rejuv/WG ticks, 15 % chance? — read in 3c),
Omen of Clarity (free cast), Innervate (stand-in?). Each is a proc (§9) or an effect.

## 6. Cooldowns and categories — needed
Spell `RecoveryTime`, `CategoryRecoveryTime` with `Category` (shared cooldowns: Shield of Righteousness / Hammer of the
Righteous are separate; Judgements share category), SPELLMOD_COOLDOWN (Improved Judgements −1 s each, Glyph of Swiftmend no).
Already: per-spell cooldown map; new: categories and spell mods.

## 7. Spell modifiers (talents and glyphs) — needed, central
Most talents and glyphs are auras `SPELL_AURA_ADD_FLAT_MODIFIER` (107) / `ADD_PCT_MODIFIER` (108) whose MiscValue is a
`SpellModOp` and whose `EffectSpellClassMask` selects the affected spells by `SpellFamilyName` + `SpellFamilyFlags`
(`Player::IsAffectedBySpellmod`, `Player.cpp` 10018–10033; `ApplySpellMod` 10035–10115: flat mods add, pct mods multiply
(they are summed per op then applied once), charges consumed for mods with charges, e.g. Hot Streak's Pyroblast cast
time). The spell data needed for this (`effectSpellClassMask`, `spellFamilyName`, `spellFamilyFlags`) is already in the
extraction. This one mechanism covers: Improved Fireball (cast time), Incineration and Critical Mass? (crit chance), Burnout
(crit damage), Empowered Fire (bonus multiplier), Glyph of Fireball (crit), Moonglow (cost), Gift of Nature (healing %),
Empowered Rejuvenation (bonus multiplier and periodic %), Improved Rejuvenation (%), Glyph of Wild Growth (targets),
Combat Expertise? (no: MOD_EXPERTISE), Improved Judgements (cooldown), Glyph of Seal of Vengeance (expertise, MOD_EXPERTISE),
Benediction (cost), Touched by the Light? (no: MOD_SPELL_DAMAGE_OF_STAT_PERCENT).
**Engine contract:** `SpellDef` gains `family` and `familyFlags`; auras gain `spellMods: { op, kind: flat|pct, value,
classMask, charges? }`; casting, launch, crit, cost, cooldown, GCD and periodic code ask `spellModValue(caster, spell, op,
base)`.

## 8. Auras that change stats — needed
New aura modifier kinds, each a 3.3.5a aura type from `SpellAuraDefines.h`: MOD_STAT, MOD_PERCENT_STAT, MOD_TOTAL_STAT_PERCENTAGE,
MOD_RESISTANCE (armor), MOD_BASE_RESISTANCE_PCT, MOD_RESISTANCE_PCT, MOD_ATTACK_POWER(_PCT), MOD_DAMAGE_DONE (spell power),
MOD_HEALING_DONE, MOD_SPELL_DAMAGE_OF_STAT_PERCENT, MOD_SPELL_HEALING_OF_STAT_PERCENT, MOD_SPELL_CRIT_CHANCE(_SCHOOL),
MOD_CRIT_PCT, MOD_ATTACKER_SPELL_CRIT_CHANCE, MOD_RATING, MOD_INCREASE_HEALTH(_PERCENT), MOD_POWER_REGEN(_PERCENT),
MOD_MANA_REGEN_INTERRUPT, MOD_MANA_REGEN_FROM_STAT, MOD_CASTING_SPEED_NOT_STACK, MOD_MELEE_HASTE (exists),
MOD_PARRY/DODGE/BLOCK_PERCENT, MOD_SHIELD_BLOCKVALUE(_PCT), MOD_EXPERTISE, MOD_THREAT, MOD_DAMAGE_PERCENT_DONE
(exists as `damage_done_pct`), MOD_HEALING_DONE_PERCENT, MOD_HEALING_PCT, MOD_CRIT_DAMAGE_BONUS, MOD_SCHOOL_DAMAGE_TAKEN?
(as `damage_taken_pct` by school: exists). Stacking rules between raid buffs (`spell_group` / `spell_group_stack_rules`)
matter only when two sources give the same buff; Gate 1 lets each raid buff come from one source (§13), so spell groups
are **not needed** in Gate 1 except for the 5 % spell crit debuff (Improved Scorch vs Shadow Mastery, `spell_group`).

## 9. Procs — needed
AzerothCore at this commit uses the TrinityCore-style proc system: `Unit::ProcSkillsAndAuras` (`Unit.cpp` 6590–) builds a
`ProcEventInfo` (actor, target, type mask = PROC_FLAG_*, spell type mask DAMAGE/HEAL/NO_DMG_HEAL, spell phase
CAST/HIT/FINISH, hit mask NORMAL/CRITICAL/MISS/DODGE/PARRY/BLOCK…) and calls `TriggerAurasProcOnEvent` (12569–12700); each
aura that can proc is checked against its `spell_proc` row (`spell_proc.sql`: SpellId (negative = all ranks), SchoolMask,
SpellFamilyName, SpellFamilyMask0–2, ProcFlags, SpellTypeMask, SpellPhaseMask, HitMask, AttributesMask,
DisableEffectsMask, ProcsPerMinute, Chance, Cooldown, Charges; columns at lines 24–39) or, without a row, the Spell.dbc
`procFlags`/`procChance`/`procCharges` (columns 34–36; `procCharges` is not extracted yet). Chance = row Chance or DBC
procChance; PPM via `GetPPMProcChance` (`Unit.cpp` 10289) with the weapon speed. The proc then runs the aura's handler
(PROC_TRIGGER_SPELL with the trigger spell, or an AuraScript `OnProc`/`HandleProc` in `spell_mage.cpp`, `spell_druid.cpp`,
`spell_paladin.cpp`, `spell_item.cpp`).
Procs Gate 1 needs (details in the spec notes): Hot Streak (two crits in a row → 48108), Ignite (fire crit → DoT of 40 % ×
crit damage over 4 s, rolling), Master of Elements, Burnout's mana cost, Empowered Fire's mana return; Nature's Grace (spell
crit → 20 % haste 3 s), Omen of Clarity (heal/hit → Clearcasting), Living Seed (crit heal → seed), Revitalize; Seal of
Vengeance (melee hit → Holy Vengeance stack + seal damage), Judgement of Light/Wisdom debuff, Redoubt (crit taken → block),
Holy Shield (block → holy damage), Ardent Defender (cheat death, passive below 35 %), Righteous Vengeance? (not taken),
Divine Plea's healing reduction, Sacred Duty (no), trinket procs (listed in each gear profile; at most two per spec).
**Engine contract:** an event bus already exists (`sim.subscribe`); Plan 3a adds a `ProcDef` on auras with the
`spell_proc` fields and a dispatcher that runs after each hit (phase HIT), cast finish (FINISH) and on taken damage.

## 10. Player melee swings for the tank — needed
`Unit::AttackerStateUpdate` (`Unit.cpp` 2767–) → `CalculateMeleeDamage` (1684–): weapon damage = `Player::CalculateMinMaxDamage`
(`StatSystem.cpp` 544–624: (weapon min/max + AP / 14 × weapon speed) × BASE_PCT + flat) × TOTAL_PCT (One-Handed Weapon
Specialization +10 %); `RollMeleeOutcomeAgainst` (3013–3190): miss (8 % vs 83 minus hit), dodge (boss 6.5 % minus
expertise), parry (14 % minus expertise; from the front), glancing (only auto-attacks, 24 % vs +3 levels at 25 % reduction?
→ read in 3a), crit, hit; armor of the boss (Festergut 10643 base armor × modifier 1 → creature armor already in data) with
Sunder/Expose Armor/Faerie Fire from stand-ins; procs (Seal of Vengeance). **Parry haste**: when the *boss* parries the
tank's swing, the boss's own swing timer is cut (`Unit.cpp` 2044–2074: remaining time above 60 % → −40 %, between 20 % and
60 % → set to 20 %), unless the creature has CREATURE_FLAG_EXTRA_NO_PARRY_HASTEN (Festergut's `flags_extra` must be checked
in 3a; creature_template line 28891). Threat of a swing = damage × threat multipliers.

## 11. Threat modifiers — needed
`ThreatManager::CalculateModifiedThreat` (`ThreatManager.cpp` 741–795): `spell_threat` pctMod (and flat/AP bonus in
`Spell::HandleThreatSpells`) per spell (`data/sql/base/db_world/spell_threat.sql`, not fetched yet: Plan 3a), then
SPELLMOD_THREAT (talents), then the per-school multiplier `GetTotalAuraMultiplierByMiscMask(SPELL_AURA_MOD_THREAT, mask)`
of the source (`UpdateMySpellSchoolModifiers` 861–866). Righteous Fury (25780): +80 % holy threat? — in 3.3, Righteous Fury
gives 80 % more threat from holy spells, and Improved Righteous Fury / the passive "Touched by the Light"? no; the 3.3
paladin tank threat bonus is Righteous Fury (holy ×1.8) **plus** the 3.0 change that makes Righteous Fury apply to all
damage for Protection (spell 25780 effect 1? — verified from the DBC in `spec-protection-paladin-azerothcore.md`). Mage:
Burning Soul (−10 % fire threat), Arcane Subtlety? (Arcane Subtlety reduces threat of arcane spells: not relevant to fire;
the fire threat talent is Burning Soul; 3.3 "Frost Channeling" frost only). Druid: Subtlety (−10 % threat of healing
spells? — Druid Subtlety reduces threat of healing spells by 10/20/30 % in 3.3? to verify) and the healing threat rule
(half the healing, split, A-019). Vigilance / Misdirection / Tricks of the Trade are not in Gate 1. Salvation (−2 % ×
?) is a hand spell in 3.3, not a blessing: not needed.

The engine's stand-in `threatMultiplier` stays for stand-ins; modelled units compute threat per hit from these auras.

## 12. Character profile as data (design input for Plan 3a)
AzerothCore builds a player from: class, race, level (tables §2), talents (`character_talent`: spell ids of learned ranks),
glyphs (`character_glyphs`: glyph spell ids per slot), equipment (`character_inventory` + `item_instance` with
enchantments per slot: permanent, temporary, three sockets, socket bonus, prismatic), and item templates
(`item_template.sql`: stats, armor, weapon damage/speed, block, sockets, socket bonus, item set, on-equip/on-use/proc
spells with `spelltrigger`, `spellppmRate`). Enchant and gem effects are `SpellItemEnchantment.dbc` rows (types: stat, spell
(on equip), damage, resistance, prismatic socket); gem items point to `GemProperties.dbc` → enchant id. Set bonuses are
`ItemSet.dbc` (spells at piece thresholds). Rising-Gods characters could later be loaded in the same shape (armory
export or the signup site), so the profile format should mirror these keys: `class, race, level, talents[{talentId, rank}]
| talentString, glyphs[spellId], items[{slot, itemId, enchantId?, gems[itemId], suffix?}], consumables[spellId],
raidBuffs[ref]`. The loader turns it into base stats + auras (talent passives, glyph auras, item stat totals as flat
auras, item spells, set bonus auras, enchant auras) — **all as data, nothing hard-coded per character**.
Gate 1: needed (the three standard profiles go through this loader).

## 13. Raid buffs and debuffs from stand-ins — needed
Spec §6.3: stand-ins provide their class's buffs. Today the `buffs` field is parsed but unused (contract list, Plan 3 item 6).
Gate 1 needs the buffs that change the three specs' numbers: Blessing of Kings, Blessing of Might/Wisdom (Sanctuary from the
modelled paladin), Mark of the Wild (from the modelled druid), Arcane Intellect (from the modelled mage), Power Word: Fortitude,
Divine Spirit, Battle Shout / Horn of Winter, Trueshot / Unleashed Rage / Abomination's Might (10 % AP), Totem of Wrath /
Demonic Pact / Flametongue (spell power), Moonkin Aura / Elemental Oath (5 % spell crit), Wrath of Air / Swift
Retribution (haste), Bloodlust/Heroism (one cast at a plan time), Ferocious Inspiration / Sanctified Retribution (3 %
damage), Mana Spring, Replenishment, Leader of the Pack, Improved Devotion? (from the paladin), and the debuffs on the boss:
Sunder Armor / Expose Armor (−20 % armor), Faerie Fire (−5 %), Curse of the Elements / Ebon Plaguebringer (+13 % spell damage
taken), Improved Scorch / Shadow Mastery / Winter's Chill (+5 % spell crit), Misery / Improved Faerie Fire (+3 % spell hit),
Heart of the Crusader / Totem of Wrath (+3 % crit), Blood Frenzy / Savage Combat (+4 % physical), and the boss damage
debuffs Demoralizing Shout/Roar, Thunder Clap / Frost Fever (attack speed −20 %). Each is a real spell with its client data,
applied as a permanent aura by the stand-in that provides it (a death removes it, which is honest). Gate 1: needed.

## 14. Not needed for Gate 1
Pets and guardians (Mirror Image, Water Elemental — Mirror Image is listed as out of scope for the mage), resilience, PvP,
shapeshift forms other than Tree of Life, energy/rage/runic power, ranged weapons and ammo, durability, spell reflection,
dispels (Festergut has no dispellable effects that the three specs remove), absorbs (no modelled absorb; Sacred Shield is a
choice for 3d), diminishing returns on crowd control, line of sight, partial resists of binary spells, spell pushback
(Festergut's melee hits only the tank; Gas Spore/Vile Gas damage on the mage and druid **does** push back casts — pushback
is needed: `Spell::Delayed`, Spell.cpp; to research in 3a; Concentration-like talents (Nature's Focus for the druid, Burning
Soul for the mage) reduce it).
