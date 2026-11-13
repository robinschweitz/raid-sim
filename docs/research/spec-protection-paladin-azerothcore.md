# Protection Paladin (3.3.5a) — standard ICC build and how AzerothCore runs it

Status: research note for Plan 3d, 2026-11-13. Nothing here is implemented.

Sources and short names as in `player-model-azerothcore.md` (client Spell.dbc pinned `a17bfd2d4b0a`; scripts in
`src/server/scripts/Spells/spell_paladin.cpp`; SQL under `data/sql/base/db_world/`).

`configured` source for the build, glyphs, gems, enchants and rotation: the MMO-Champion thread "Protection Paladin Guide
and FAQ for 3.3 and on" (`https://www.mmo-champion.com/threads/692475`, retrieved 2026-11-13). Its "suggested full build"
link (old Wowhead hash `sZV0tAbuMusIufdgobhbc`) was decoded with the old Wowhead talent alphabet against Talent.dbc's
row/column order and passes every tier and prerequisite check; it matches the guide's text (Conviction 3/5, no Divinity,
no Reckoning, Divine Sacrifice/Divine Guardian taken). Rotation: the guide's "96969" (Holy Shield up; Shield of
Righteousness, Hammer of the Righteous, Judgement and Consecration on cooldown).

## 1. Character

| Field | Value | Source |
| --- | --- | --- |
| Race | Human (1): no stat offsets; Mace Specialization (+3 expertise with maces), The Human Spirit (+3 % spirit) | `player_race_stats.sql` line 41; racial spells from Spell.dbc (3a) — **owner: faction/race** |
| Class base at 80 | HP 6934, mana 4394, Str 151, Agi 90, Sta 143, Int 98, Spi 105 | `player_class_stats.sql` line 203 |
| Defense skill | 400 + rating / 4.9185 | §3.9 of the player note |
| DR constants (paladin) | k 0.956; caps: miss 16, parry 47.003525, dodge 88.129021; dodge base 0.034943; crit-to-dodge 1/1.15 | `StatSystem.cpp` 711–838, `Player.cpp` 5301–5352 |

## 2. Talents (0/53/18, validated)

Protection (tab 383): Divine Strength 5/5 (20266, +15 % Str), Anticipation 5/5 (20100, +5 % dodge), Divine Sacrifice 1/1
(64205), Improved Righteous Fury 3/3 (20470), Toughness 5/5 (20147, +10 % armor from items), Divine Guardian 2/2 (53530),
Improved Devotion Aura 3/3 (20140), Blessing of Sanctuary 1/1 (20911), Sacred Duty 2/2 (31849: +4 % Sta? (aura 137 bp 3+1
misc 2 = stamina +4 %), −60 s Divine Protection/Shield cooldown), One-Handed Weapon Specialization 3/3 (20198, +10 %
damage), Spiritual Attunement 1/2 (31785: mana from heals received), Holy Shield 1/1, Ardent Defender 3/3 (31852),
Redoubt 3/3 (20135), Combat Expertise 3/3 (31860: +6 expertise, +6 % Sta, +6 % crit), Touched by the Light 3/3 (53592:
spell power = 60 % of Str, crit heals +30 %?), Avenger's Shield 1/1, Guarded by the Light 2/2 (53585), Shield of the
Templar 3/3 (53711: −3 % damage taken), Judgements of the Just 2/2 (53696: Judgement −2 s cooldown? (op 11 −10001? → read)
and the attack-speed debuff on the target via `spell_pal_judgements_of_the_just`, spell_paladin.cpp 1847), Hammer of the
Righteous 1/1.

Retribution (tab 381): Deflection 5/5 (20064, +5 % parry), Benediction 2/5 (20102, −4 % cost of instants), Improved
Judgements 1/2 (25956, −1 s Judgement cooldown), Improved Blessing of Might 2/2, Conviction 3/5 (20119, +3 % crit), Pursuit
of Justice 2/2 (26023: **+15 % run speed (aura 31 MOD_INCREASE_SPEED)** — changes the tank's movement speed in the plan),
Crusade 3/3 (31868, +3 % damage, +9 % vs undead? (aura 168 misc 108 creature-type mask: undead/demon/elemental/humanoid —
Festergut is undead)).

## 3. Glyphs

| Glyph | Spell | Client effect |
| --- | --- | --- |
| Divine Plea (major) | 63223 | Divine Plea's healing penalty −5 % less? (op 23 EFFECT3 −5 on the Plea mask) |
| Seal of Vengeance (major) | 56416 | +10 expertise while the seal is active (op 12 on the seal mask → the seal's MOD_EXPERTISE effect) |
| Hammer of the Righteous (major) | 63219 | +1 target (op 17 JUMP_TARGETS) |
| Minor | Lay on Hands, Sense Undead (guide) | not modelled |

## 4. Gear profile (average item level 257.9, 17 slots)

Gems (guide): meta Austere Earthsiege Diamond 41380 (+32 Sta, +2 % armor from items via 55344), red Regal Dreadstone 40138
(+10 dodge, +15 Sta), yellow Enduring Eye of Zul 40167 (+10 defense, +15 Sta), blue Solid Majestic Zircon 40119 (+30 Sta),
always matching the socket colour (`configured` simplification of the guide's "only if the bonus is worth it").

| Slot | Item (id) | ilvl | Where | Enchant |
| --- | --- | --- | --- | --- |
| Head | Lightsworn Faceguard (50862) | 251 | T10 prot (set 901), Frost vendor (vendor 35498, npc_vendor line 35611) | 3818 (+37 Sta, +20 def) |
| Neck | Marrowgar's Scratching Choker (50763) | 251 | Marrowgar 10N (ref 34230, line 10954) | — |
| Shoulders | Lightsworn Shoulderguards (50860) | 251 | T10 | 3811 (+20 dodge, +15 def) |
| Back | Sentinel's Winter Cloak (50466) | 264 | Frost vendor (line 37015) | 1951 (+16 def; guide's alternative to +225 armor) |
| Chest | Cataclysmic Chestguard (50968) | 264 | Frost vendor (line 37022) | 3297 (+275 health) |
| Wrists | Bracers of Dark Reckoning (49960) | 264 | Marrowgar 25N (ref 34242, line 11082) | 3850 (+40 Sta) |
| Hands | Lightsworn Handguards (50863) | 251 | T10 | 3253 (+2 % threat (25063), +10 parry) |
| Waist | Verdigris Chain Belt (50991) + buckle | 264 | Frost vendor (line 37041) | — |
| Legs | Lightsworn Legguards (50861) | 251 | T10 | 3822 (+55 Sta, +22 Agi) |
| Feet | Boots of Kingly Upheaval (49907) | 264 | crafted | 1075 (+22 Sta; Tuskarr's run speed deliberately not chosen) |
| Finger 1 | Juggernaut Band (49985) | 264 | Deathwhisper 25N (line 11095) | — |
| Finger 2 | Ashen Band of Courage (50375) | 251 | Ashen Verdict, friendly | — |
| Trinket 1 | Corpse Tongue Coin (50352) | 264 | Gunship 25N (ref 34251, line 11186) | — |
| Trinket 2 | Corroded Skeleton Key (50356) | 264 | Frost vendor (line 37001) | — |
| Main hand | Bonebreaker Scepter (50760), mace 1.7 s, 244–454 | 251 | Marrowgar 10N (line 10951) | 3870 (Blood Draining, aura 64571 proc) |
| Shield | Neverending Winter (50794), 8487 armor, 237 block | 251 | Gunship 10N (ref 12036, line 2051) | 1952 (+20 def) |
| Relic | Libram of the Eternal Tower (50461) | 264 | Frost vendor (line 37011) | — |

Totals (items, gems, socket bonuses, flat enchants): **Str 1304, Sta 2845, defense rating 900 (→ +183 defense, 583
skill: crit-immune against level 83 needs 540), dodge rating 763, parry rating 444, block rating 37, block value 237
(shield), expertise rating 155, hit rating 193, Agi 22, armor 26771, +275 health**, plus auras: 55344 (+2 % item armor),
60694? (no: the chest has +275 health here), 25063 (+2 % threat), 64571 (Blood Draining), set 901 4/5 (2p 70758,
4p 70761 → 70760), libram 71194 (Shield of Righteousness → 71197?), trinkets 71634 (Corpse Tongue Coin: below 35 %
health, armor proc) and 71586 (on-use absorb 6400, 10 s), ring 71653 (path selection only).
Consumables (`configured`): Flask of Stoneblood (+1300 health), Dragonfin Filet / Fish Feast (stat food), Indestructible
Potion.
Buffs from stand-ins: Kings, Fortitude, Mark of the Wild (modelled druid), Commanding Shout/Blood Pact, Devotion Aura
(self), Retribution Aura? (no: Devotion), Horn of Winter / Strength of Earth, Trueshot/Unleashed Rage, Battle Shout/Might,
the boss debuffs Demoralizing Shout/Roar (−AP), Thunder Clap/Frost Fever (−attack speed; the paladin's own Judgements of
the Just covers it), Sunder/Expose Armor, Faerie Fire, Blood Frenzy. Blessing of Sanctuary is the paladin's own.

## 5. Abilities used (rank 80 client values)

| Ability | Spell | GCD / CD | Cost (% base mana) | Effects | Coefficient | AzerothCore |
| --- | --- | --- | --- | --- | --- | --- |
| Shield of Righteousness r2 | 61411 | 1500 / 6 s (category 1209) | 6 % | 520 holy + block value × effect-1 % (capped: `GetShieldBlockValue(29.5 × level, 34.5 × level)`) | no row; melee class (DmgClass 2) | SpellEffects.cpp 663–671 |
| Hammer of the Righteous | 53595 | 1500 / 6 s | 6 % | holy, main-hand DPS × effect-2 value, 3 targets (4 with glyph); travel 35 yd/s | — | SpellEffects.cpp 641–661 |
| Judgement (of Light / Wisdom) | 20271 / 53408 | 1500 / 10 s (−1 Improved Judgements) | 5 % | applies the judgement debuff (20185 / 20186) and the seal's judgement damage (SoV: 31804, 0.22 SP + 0.14 AP, +10 % per Holy Vengeance stack, `Unit.cpp` 8465–8480; `spell_bonus_data.sql` line 772) | — | `spell_pal_judgement` (spell_paladin.cpp 955), JotJ (1847), Judgements of the Wise (1245: Replenishment + 25 % base mana — **not taken** in this build? (Judgements of the Wise is Ret tier 6; not in the build)) |
| Holy Shield r6 | 48952 | 1500 / 8 s (cat 931) | 10 % | +30 % block (aura 51) for 10 s; 274 holy to an attacker on each block (8 charges) | 0.09 SP + 0.056 AP (line 1012) | spell_proc line 187 (`-20925`, HitMask 64 = block) |
| Consecration r8 | 48819 | 1500 / 8 s | 22 % | ground AoE (radius 8), 113 holy per second, 8 s | 0.04 SP + 0.04 AP per tick (line 1004) | a dynamic object (persistent area aura) — **needs a ground effect**, see §8 |
| Avenger's Shield r5 | 48827 | 1500 / 30 s | 26 % | 1100..1344 holy, chains to 3, daze | 0.07 / 0.07 (line 1010) | pull and filler |
| Holy Wrath r5 | 48817 | 1500 / 30 s | 20 % | 1050..1234 holy to undead/demons within 10 yd + stun | 0.07 / 0.07 (line 1002) | `spell_pal_exorcism_and_holy_wrath_damage`; Festergut is undead: usable (stun ignored: boss immune) |
| Exorcism r9 | 48801 | 1.5 s cast / 15 s | 8 % | 1028..1146 holy; always crit vs undead/demons | 0.15 / 0.15 (line 998) | filler, rarely in 96969 |
| Seal of Vengeance | 31801 | 1500 | 14 % | on melee hit: Holy Vengeance 31803 (stack 5, 15 s, 3 s ticks, 0.013 SP + 0.025 AP per stack, line 771); at 5 stacks also 42463 (33 % weapon damage holy) | — | `spell_pal_seal_of_vengeance_aura` (1911); spell_proc line 391 |
| Righteous Fury | 25780 | 1500 | — | MOD_THREAT +80 % holy (aura 10, misc 2) and Improved RF damage reduction | — | permanent self-aura |
| Hand of Reckoning | 62124 | off GCD / 8 s | 3 % | taunt (ATTACK_ME), 3 s, 30 yd; deals damage if the boss was not targeting the paladin | — | replaces the generic plan taunt for this spec (A-023) |
| Divine Plea | 54428 | 1500 / 1 min | — | 25 % max mana over 15 s (5 ticks), −50 % healing done | — | used on cooldown (mana) |
| Divine Protection | 498 | off GCD / 3 min (−60 s Sacred Duty) | 3 % | −50 % damage taken, 12 s | — | plan cooldown (`use_cooldown`) |
| Lay on Hands | 48788 | 20 min | — | heals max health | — | emergency, plan rule |
| Blessing of Sanctuary / Greater | 20911 / 25899 | buff | — | −3 % damage taken, +10 % Str/Sta, mana on block/dodge/parry (`spell_pal_blessing_of_sanctuary`, 563) | — | self-buff |
| Devotion Aura r10 | 48942 | aura | — | +1205 armor (party, 40 yd), Improved: +50 % armor and healing taken | — | self/party aura |
| Melee swing | — | weapon 1.7 s | — | weapon damage + AP/14 × 1.7, OHWS +10 % | — | `Unit::AttackerStateUpdate` (Unit.cpp 2767) |

## 6. Defensive mechanics that matter

Avoidance from defense/dodge/parry with diminishing returns (§3.9 of the player note), block chance 5 % + defense +
Holy Shield 30 % + Redoubt (30 % for 10 s or 5 blocks after being crit? — Redoubt procs on being hit (procFlags 0x2a8, 10 %)),
block value reduces each blocked hit, **crushing blows and crits from Festergut** (the engine's boss melee has neither:
A-022) — a tank above the 102.4 % combined miss/dodge/parry/block (+ defense crit immunity) cannot be crushed;
Ardent Defender (−20 % damage below 35 %, cheat-death once per 2 min: `spell_pal_ardent_defender`, 322), Shield of the
Templar −3 %, Blessing of Sanctuary −3 %, Improved RF −6 %, Divine Protection −50 %, Judgements of the Just −20 % boss
attack speed (script 1847), Spiritual Attunement mana from healing received (1403), Blessing of Sanctuary mana.
**Parry haste:** the boss parrying the paladin shortens the boss's next swing (Unit.cpp 2044–2074) unless Festergut has
CREATURE_FLAG_EXTRA_NO_PARRY_HASTEN (check `flags_extra`, creature_template line 28891, in 3d).

## 7. Decision policy — `configured` (MMO-Champion 3.3 guide, "96969")

On the boss with aggro: keep Righteous Fury, Seal of Vengeance, Blessing of Sanctuary up (pre-pull). Then on each GCD:
1. Shield of Righteousness or Hammer of the Righteous when ready (the "6"s), alternating with
2. Holy Shield (when < 2 s left or charges gone), Judgement, Consecration (the "9"s) — the guide's pattern 9-6-9-6-9
   keeps every 6-s and 9-s ability on cooldown.
3. Fillers when everything is on cooldown: Avenger's Shield, Holy Wrath (undead), Exorcism (when not moving).
4. Divine Plea on cooldown below 80 % mana. Divine Protection, Lay on Hands, Corroded Skeleton Key: plan rules (health
   thresholds), not the rotation.
Off-tank (not the victim): keep Holy Shield? no — off-tank behaviour follows the plan (taunt rule with Hand of Reckoning
when the other tank has 9 Gastric Bloat stacks; keep Seal and auras; deal damage with the same priority from melee range
behind the boss). A modelled tank that out-threats the stand-in tank after a swap is a **known risk** (2b-2 "found while
writing"): the swap rule then needs a threat-aware trigger.

## 8. Engine requirements this spec adds

Player melee auto-attacks (weapon damage, swing timer, hit/expertise against boss dodge/parry, glancing does not apply to
specials, crits ×2), procs on melee hit (Seal of Vengeance, Blood Draining, Libram), stacking DoT with AP/SP coefficients,
weapon-based spell damage (HotR) and block-value damage (SoR), a chain target spell (HotR, Avenger's Shield), a ground
area effect that ticks (Consecration: a persistent area at the cast position, which the engine does not have — the
contract list's point-targeted areas item 12), block (chance + value) and crushing/crit rolls when the boss hits the
paladin, defense/dodge/parry with diminishing returns, Holy Shield's on-block proc with charges, threat multipliers per
school (Righteous Fury) and from the glove enchant, a taunt spell with its own range/cooldown (A-023 replaced), boss
attack-speed debuff from the paladin (exists as `attack_speed_pct`), cooldown categories, mana regen including Divine Plea,
Spiritual Attunement and Sanctuary mana returns.

## 9. Out of scope

Divine Sacrifice / Divine Guardian (raid cooldown; the scenarios do not need them — listed), Sacred Shield (absorb: not
modelled), Hand of Salvation/Protection/Freedom, Righteous Defense (Hand of Reckoning is used), Exorcism outside fillers,
Blood Draining's heal (out of scope until absorbs/heals from procs are needed? it is a heal proc below 35 %: **include if
cheap**, decide in 3d), Corpse Tongue Coin's armor proc (below 35 % health; same decision), Pursuit of Justice's speed is
**in** scope (it changes plan movement: 7 → 8.05 yd/s), the Ashen ring's reputation-path spell (no effect at friendly).
