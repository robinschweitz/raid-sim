# Restoration Druid (3.3.5a) — standard ICC build and how AzerothCore runs it

Status: research note for Plan 3c, 2026-11-13. Nothing here is implemented.

Sources and short names as in `player-model-azerothcore.md` and `spec-fire-mage-azerothcore.md` (client Spell.dbc pinned
`a17bfd2d4b0a`; scripts in `src/server/scripts/Spells/spell_druid.cpp`; SQL under `data/sql/base/db_world/`).

`configured` sources for choices (build and healing policy): the 2010 WoW Insider/Engadget column "Shifting Perspectives:
Restoration 101, part 2" (`https://www.engadget.com/2010-01-26-shifting-perspectives-restoration-101-part-2.html`,
retrieved 2026-11-13: mandatory/optional resto talents for 3.3 raiding; Genesis, Moonglow, Nature's Splendor mandatory,
Nature's Majesty as the step to Splendor, Nature's Grace for tank healers), and the common 14/0/57 tank-healer shape. The
points were validated against Talent.dbc. The healing policy is the owner's requirement ("a resto healing the people
getting lowest") made concrete below; its thresholds are `assumption` values to tune honestly in 3e.

## 1. Character

| Field | Value | Source |
| --- | --- | --- |
| Race | Night Elf (4): −4 Str, +4 Agi; Quickness (2 % dodge), Wisp Spirit — irrelevant here | `player_race_stats.sql` line 44 — **owner: faction (Tauren +5 % health… is Horde)** |
| Class base at 80 | HP 7417, mana 3496, Str 89, Agi 82, Sta 98, Int 143, Spi 159 | `player_class_stats.sql` line 789 |
| Spell crit | 0.018515 base + Int × 0.00006 | gtChanceToSpellCrit(Base) |

## 2. Talents (14/0/57, validated)

Balance (tab 283): Genesis 5/5 (57814: +5 % periodic healing via SPELLMOD_DOT op 22 and +5 % of the HoT/Swiftmend mask
op 0), Moonglow 3/3 (16847: −9 % cost, SPELLMOD_COST op 14 on the healing mask), Nature's Majesty 2/2 (35364, +4 % crit
on Nourish/Healing Touch/Regrowth? — mask 0x25/0x2800000, read in 3c), Nature's Grace 3/3 (61346 → 16886: +20 % spell
haste for 3 s after a spell crit; spell_proc line 204), Nature's Splendor 1/1 (57865: +3 s Rejuvenation? — effects add
duration (op 1 DURATION) 3000/6000/2000 ms to three masks: Moonfire/Rejuvenation 0x12, Regrowth 0x40, Insect
Swarm/Lifebloom 0x200000/0x10).

Restoration (tab 282): Improved Mark of the Wild 2/2 (17051), Nature's Focus 3/3 (17066: −70 % pushback, op 9
NOT_LOSE_CASTING_TIME — needs pushback in 3a), Naturalist 5/5 (17073: −0.5 s Healing Touch; +10 % physical damage),
Natural Shapeshifter 3/3 (16835, required for Master Shapeshifter), Intensity 3/3 (17108: 50 % mana regen while casting,
MOD_MANA_REGEN_INTERRUPT (134)), Omen of Clarity 1/1 (16864 → Clearcasting 16870; spell_proc line 283: 3.5 PPM, hits
from spells too via the `spell_dru_omen_of_clarity` script, spell_druid.cpp 234), Master Shapeshifter 2/2 (48412 →
+4 % healing in Tree of Life), Improved Rejuvenation 3/3 (17113: +15 % Rejuvenation, op 22), Nature's Swiftness 1/1
(17116, 3 min, next nature spell instant), Gift of Nature 5/5 (24946: +10 % healing (op 0 on the heal mask, op 22 on HoTs)),
Nature's Bounty 5/5 (17078: +25 % crit on Regrowth and Nourish, op 7), Living Spirit 3/3 (34153: +15 % spirit, aura 137
MOD_TOTAL_STAT_PERCENTAGE misc 4 = spirit), Swiftmend 1/1, Natural Perfection 2/3 (33882: +2 % crit; when crit, −2 % damage
taken stacking (45282) — the damage-reduction part is a proc on being crit), Empowered Rejuvenation 5/5 (33890: +20 % of
the bonus coefficient (op 24 BONUS_MULTIPLIER) for HoTs), Revitalize 3/3 (48545: Rejuvenation/Wild Growth ticks have 15 %
to give the target mana/rage/energy/runic power — `spell_dru_revitalize`, spell_druid.cpp 1563; **only modelled players
with mana benefit; stand-ins have no resources**), Tree of Life 1/1 (65139 talent; form 33891), Improved Tree of Life 3/3
(48537: +200 %? armor in form (aura 142 bp 199+1 on form flag) and +15 % of spirit as healing (aura 175
MOD_SPELL_HEALING_OF_STAT_PERCENT misc 4)), Gift of the Earthmother 5/5 (51183: +10 % spell haste on the heal mask? (aura
65 MOD_CASTING_SPEED? misc 21 — op 21 GLOBAL_COOLDOWN −151 ms? read in 3c) and −1.5 s?), Wild Growth 1/1.

Talent string: `05320031-0-230503312031500531250313051`.

## 3. Glyphs

| Glyph | Spell | Client effect | Choice |
| --- | --- | --- | --- |
| Swiftmend (major) | 54824 | DUMMY: Swiftmend does not consume the HoT (SpellEffects.cpp 1633: `if (!caster->HasAura(54824))` removes it) | taken |
| Wild Growth (major) | 62970 | +1 target (script `spell_dru_wild_growth` reads it: 6 instead of 5 targets, spell_druid.cpp 1197–1215) | taken |
| Nourish (major) | 62971 | +6 % Nourish per own HoT on the target (`spell_dru_nourish`, 2035) | taken (owner may prefer Rapid Rejuvenation 71013: aura 316 PERIODIC_HASTE on Rejuvenation) |

## 4. Gear profile (average item level 259.1, 16 slots)

Same rule as the mage (`spec-fire-mage-azerothcore.md` §4). Gems: red Runed Cardinal Ruby 40113, yellow Reckless
Ametrine 40155, blue Purified Dreadstone 40133, meta Ember Skyflare Diamond 41333 (+25 SP, +2 % Int via 55275).

| Slot | Item (id) | ilvl | Where | Enchant |
| --- | --- | --- | --- | --- |
| Head | Lasherweave Helmet (50108) | 251 | T10 resto (set 887), Frost vendor (vendor 35497, ext 2742) | 3819 (+30 SP, +10 MP5) |
| Neck | Bone Sentinel's Amulet (49975) | 264 | Marrowgar 25N (ref 34242, line 11086) | — |
| Shoulders | Lasherweave Pauldrons (50113) | 251 | T10 | 3809 (+24 SP, +8 MP5) |
| Back | Greatcloak of the Turned Champion (50014) | 264 | Saurfang 25N (ref 34252, line 11189) | 3831 (+23 haste) |
| Chest | Lasherweave Robes (50106) | 251 | T10 (npc_vendor line 35494) | 3832 (+10 all stats) |
| Wrists | Wrists of Septic Shock (50985) | 251 | Festergut 10N (ref 34232, creature_loot line 93359) | 2332 (+30 SP) |
| Hands | Lasherweave Gauntlets (50107) | 251 | T10 | 3246 (+28 SP) |
| Waist | Belt of Petrified Ivy (50994) + buckle | 264 | Frost vendor (vendor 37941) | — |
| Legs | Lasherweave Legplates (50109) | 251 | T10 | 3719 (+50 SP, +20 spi) |
| Feet | Boots of Unnatural Growth (50009) | 264 | Gunship 25N (ref 34251, line 11183) | 1147 (+18 spi; no run-speed enchant, it would change the plan's movement) |
| Finger 1 | Ring of Maddening Whispers (49990) | 264 | Deathwhisper 25N (line 11100) | — |
| Finger 2 | Ring of Rapid Ascent (50008) | 264 | Gunship 25N (line 11182) | — |
| Trinket 1 | Althor's Abacus (50359) | 264 | Gunship 25N (line 11187) | — |
| Trinket 2 | Purified Lunar Dust (50358) | 264 | Frost vendor (npc_vendor line 37003) | — |
| Main hand | Nibelung (49992), staff | 264 | Deathwhisper 25N (line 11102) | 3854 (+81 SP) |
| Relic | Idol of the Black Willow (50454) | 264 | Frost vendor (line 37004) | — |

Totals (items, gems, bonuses, flat enchants): **SP 3153, Int 1117, Spi 804, Sta 1109, crit rating 536, haste rating 444,
MP5 18, armor 3871**, plus auras: meta 55275 (+2 % Int), 60694 (+10 all stats), set 887 5/5 (2p 70658, 4p 70664), the
idol 71178, trinkets 71611 / 71585, Nibelung 71845 (out of scope).
Consumables (`configured`): Flask of the Frost Wyrm, Fish Feast (stat food), Runic Mana Potion.
Buffs assumed from stand-ins: as the mage, minus spell-damage-taken debuffs; plus Mana Spring, Blessing of Wisdom,
Replenishment, Innervate from another druid? (no: the druid casts its own).

## 5. Abilities used (rank 80 client values)

| Ability | Spell | Cast / GCD / CD | Cost (% base mana) | Effects | Coefficient | AzerothCore |
| --- | --- | --- | --- | --- | --- | --- |
| Rejuvenation r15 | 48441 | instant / 1500 | 18 % | PERIODIC_HEAL 338 every 3 s for 15 s (+3 s Splendor) | 0.376 dot (`spell_bonus_data.sql` line 968) | default; Swiftmend aura state |
| Regrowth r12 | 48443 | 2000 / 1500 | 29 % | HEAL 2234..2494; HoT 335 every 3 s for 21 s (+6 s Splendor) | 0.3 direct, 0.1878 dot (line 970) | — |
| Lifebloom r3 | 48451 | instant / 1500 | 28 % | HoT 53 every 1 s for 7 s, stacks to 3; on expiry the bloom 33778 heals 776 × stacks | HoT 0.09518 (line 974), bloom 0.655 (line 790) | `spell_dru_lifebloom` (spell_druid.cpp 638): bloom only on expiry or dispel, returns half the base cost × stacks as mana |
| Nourish r1 | 50464 | 1500 / 1500 | 18 % | HEAL 1883..2187 | 0.672 (line 1071) | +20 % with a HoT of the druid on the target (`SpellHealingBonusTaken`? `Unit.cpp` 9513–9530), Glyph of Nourish via `spell_dru_nourish` (2035) |
| Wild Growth r4 | 53251 | instant / 1500 / 6 s (category 1237) | 23 % | HoT 206 every 1 s for 7 s on up to 5 (6 with glyph) raid members within 15 yd of the target, lowest health % first | 0.115 dot (line 1116) | `spell_dru_wild_growth` (1197, target filter), `spell_dru_wild_growth_aura` (2073: first tick +6 %, −2 % per tick; T10 2p changes the decline) |
| Swiftmend | 18562 | instant / 1500 / 15 s | 16 % | heals the sum of 4 Rejuvenation or 6 Regrowth ticks of the shortest own HoT (SpellEffects.cpp 1577–1640) | via the HoT's amount | consumes the HoT unless glyphed |
| Healing Touch r15 | 48378 | 3000 (−0.5 s Naturalist) / 1500 | 33 % | HEAL 3750..4428 | 1.61 (line 965) | used with Nature's Swiftness |
| Nature's Swiftness | 17116 | off GCD / 3 min | — | next nature spell with cast time instant (spell_proc line 285) | — | — |
| Tree of Life | 33891 | form, 13 % base | — | shapeshift; passive 34123 (+6 %? healing received by party members, aura 118 MOD_HEALING_PCT on party in 100 yd area aura) | — | the form changes which spells can be cast (shapeshift masks in Spell.dbc Stances) |
| Innervate | 29166 | instant / 3 min | — | target gains 225 % of base mana over 10 s (aura 24 PERIODIC_ENERGIZE) | — | `spell_dru_innervate` (619) |
| Tranquility r7 | 48447 | channel 8 s / 8 min | 70 % | — | 0.538 (line 972) | **optional** (policy may use it in the last phase) |
| Mark/Gift of the Wild | 48469 / 48470 | buff | — | +750 armor, +37 all stats, +54 resistances | — | applied before the pull |
| Barkskin | 22812 | off GCD / 1 min | — | −20 % damage taken, no pushback | — | self-defence during spores (policy) |

## 6. Procs and effects that matter

Nature's Grace (16880 family, spell_proc line 204: spell crit → 16886), Omen of Clarity (3.5 PPM, line 283), Living Seed
is **not taken** (the build has 0/3), Revitalize (only modelled mana users), Natural Perfection's damage reduction stacks
(when crit by Festergut? he only melees the tank; Gas Spore/Vile Gas/Pungent Blight cannot crit: A-028), T10 2p (70658,
Wild Growth decline −30 % less? — the aura script reads bonus amount 30: `AddPct(_baseReduction, -30)`), T10 4p (70664:
2 % on Rejuvenation tick → jump? `spell_dru_t10_restoration_4p_bonus`, 1153), the idol 71178 (Rejuvenation ticks → 71184
stacking spirit? read in 3c), Althor's Abacus 71611 (30 % on heal → 71610 heal on the lowest nearby ally), Purified Lunar
Dust 71585 (10 % on heal → 71584 mana), meta 55275, Glyph of Nourish, Lifebloom's mana return, Wild Growth's tick curve.

## 7. Healing policy — `assumption` thresholds, owner's requirement

"Heal the people getting lowest", with what a raider can see (spec §8.6: health bars, incoming casts, own HoTs):
1. Emergency: a tank (role `tank`, or the current boss target) below 35 % health → Nature's Swiftness + Healing Touch on it;
   if NS is on cooldown, Swiftmend on it if it has the druid's Rejuvenation or Regrowth.
2. Keep Lifebloom at 3 stacks on the current tank (the boss's victim; switches with the taunt), refreshing when < 1.5 s
   remain (rolling; the bloom happens only when it expires, i.e. after a swap).
3. Keep Rejuvenation on both tanks.
4. Wild Growth on cooldown, on the player whose 15 yd group has the largest total health deficit (the spore stack).
5. Swiftmend on the lowest-health-% player with the druid's HoT if below 60 %.
6. Rejuvenation on the lowest-health-% player without it, if below 90 %.
7. Nourish on the lowest-health-% player (counting heals other units are casting on them, like the generic healer) if
   below 85 %; Regrowth instead when Clearcasting is up.
8. Innervate on self below 30 % mana. Barkskin when a Gas Spore lands on the druid (plan rule).
Ties go to the lowest id; a target out of range or not in line (no LoS in the room) is skipped.

## 8. Engine requirements this spec adds

Heals with spell power and coefficients (`SpellHealingBonusDone/Taken`), heal crits (+50 %), periodic heals with fixed
amounts (A-029 for healing exists: roll × stacks) plus spell mods at application, stacking HoT with an expiry effect that
uses the stacks (Lifebloom), area target selection by lowest health % (Wild Growth: a "smart" area filter), consuming
another aura (Swiftmend reads the HoT's amount and tick count), shapeshift (Tree of Life as a permanent self-aura that
gives the party aura), mana with Innervate and Intensity, haste on cast time and GCD (Nature's Grace), a cooldown
category (Wild Growth), healing threat (exists: half, split), and the policy's view of other healers' casts (exists).

## 9. Out of scope

Living Seed (not in the build), Tranquility's channel (optional; listed), Rebirth (no battle-res in the scenarios), Thorns,
Abolish Poison/Remove Curse (nothing to dispel), Nibelung's Val'kyr, Revitalize's energize on stand-ins (no resources),
movement-speed enchants (deliberately not chosen), the Night Elf Shadowmeld.
