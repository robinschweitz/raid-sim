# Fire Mage (3.3.5a) — standard ICC build and how AzerothCore runs it

Status: research note for Plan 3b, 2026-11-13. Nothing here is implemented.

Sources and short names as in `player-model-azerothcore.md`. Spell values are from the owner's client Spell.dbc (pinned
`client-12340:Spell.dbc:a17bfd2d4b0a`), read with a scratch tool; columns as in `packages/data/src/dbc/spell.ts`
(cast time via SpellCastTimes, duration via SpellDuration, range via SpellRange, all pinned). `spell_bonus_data` and
`spell_proc` are `data/sql/base/db_world/*.sql` at the pinned commit; scripts are `src/server/scripts/Spells/spell_mage.cpp`.
Item rows are `item_template.sql`, loot rows `reference_loot_template.sql` / `gameobject_loot_template.sql`, vendor rows
`npc_vendor.sql`; enchant and gem values from the client's `SpellItemEnchantment.dbc` and `GemProperties.dbc`
(scratch extraction, not pinned yet).

Guides used as `configured` sources for choices AzerothCore cannot make (build, priority): wowtbc.gg "Fire Mage PvE
Guide — Wrath Classic" (`https://wowtbc.gg/wotlk/class-guides/fire-mage`, retrieved 2026-11-13: glyphs, hit caps,
single-target priority, opener) — Wrath Classic uses the same 3.3.5 spells and talents. Icy Veins' WotLK Classic fire
pages were not reachable (HTTP 403); the talent points below are therefore the commonly published "TTW" 18/53/0 shape,
checked point by point against Talent.dbc (tier requirements, prerequisites, ranks) with the scratch validator. The owner
should confirm the build (open question 1 of the overview).

## 1. Character

| Field | Value | Source |
| --- | --- | --- |
| Race | Gnome (7): +3 Int, −5 Str, +2 Agi; racial Expansive Mind (+5 % Int) | `player_race_stats.sql` (row 7); racial spell from Spell.dbc (3a looks up the id) — **owner: faction/race (open question)** |
| Class base at 80 | HP 6963, mana 3268, Str 36, Agi 43, Sta 59, Int 181, Spi 174 | `player_class_stats.sql` line 629 |
| Spell crit from Int | 0.009075 base + Int × 0.00006 (×100 %) | gtChanceToSpellCrit(Base), §3.6 of the player note |
| Spirit regen | sqrt(Int) × Spi × 0.003345 per s | gtRegenMPPerSpt, §3.10 |

## 2. Talents (18/53/0, all ranks validated against Talent.dbc)

Arcane (tab 81): Arcane Subtlety 2/2 (12592), Arcane Focus 3/3 (12840: +3 % hit for arcane only — no effect on fire;
part of the standard build to reach the tier), Arcane Concentration 5/5 (12577 → Clearcasting 12536), Spell Impact 3/3
(12469, +6 % damage of Fireball/Fire Blast/Scorch… via SPELLMOD), Student of the Mind 1/3 (44397, the free point),
Focus Magic 1/1 (54646, put on a stand-in caster or the healer; the return proc 54648 needs the partner to crit — see §6),
Torment the Weak 3/3 (55340: only against snared targets; **no effect on Festergut**).

Fire (tab 41): Incineration 3/3 (54734), Improved Fireball 5/5 (12341: −0.5 s Fireball, SPELLMOD_CASTING_TIME −500),
Ignite 5/5 (12848), World in Flames 3/3 (12350, +6 % crit chance), Pyroblast 1/1, Improved Scorch 3/3 (12873 → debuff
22959, +5 % spell crit taken, 30 s), Master of Elements 3/3 (29076 → 29077, 30 % of base cost on crit), Playing with Fire
3/3 (31640, +3 % damage done and taken), Critical Mass 3/3 (11368, +6 % fire crit), Blast Wave 1/1 (AoE, unused),
Fire Power 5/5 (12400, +10 % fire damage), Pyromaniac 3/3 (34296: +3 % crit; 50 % casting regen while 3 fire DoTs are
on targets — **Pyromaniac's regen needs three targets with fire DoTs: not reachable on one boss**), Combustion 1/1
(11129 → 28682), Molten Fury 2/2 (31680, +12 % damage vs targets below 35 %), Empowered Fire 3/3 (31658: +15 % of SP to
Fireball/Frostfire/Pyroblast as SPELLMOD_BONUS_MULTIPLIER; Ignite ticks return 2 % base mana via 67545, script
`spell_mage_empowered_fire`, spell_mage.cpp 1658), Hot Streak 3/3 (44448), Burnout 5/5 (44472: +50 % crit damage bonus,
+1 % base mana cost on crit), Living Bomb 1/1.

Talent order string for the validator (row/column order of Talent.dbc per tab): `23000503110003-0355030010303331053120300351-`.

## 3. Glyphs

| Glyph | Spell | Client effect | Source |
| --- | --- | --- | --- |
| Fireball (major) | 56368 | ADD_FLAT_MODIFIER (107), op CASTING_TIME (10), −150 ms, class mask Fireball | Spell.dbc 56368 |
| Living Bomb (major) | 63091 | aura 286 ABILITY_PERIODIC_CRIT: Living Bomb ticks can crit | Spell.dbc 63091 |
| Molten Armor (major) | 56382 | ADD_FLAT_MODIFIER op EFFECT3 (23) +20 on Molten Armor (spirit → crit +20 %) | Spell.dbc 56382 |
| Minor glyphs | — | none matter in the fight (Arcane Intellect cost, Slow Fall) | not modelled |

Guide: wowtbc.gg lists Fireball, Living Bomb, Molten Armor as major glyphs (`configured`).

## 4. Gear profile (average item level 257.1, 15 slots; wand slot empty — see §9)

Rule for the choice (`configured`): T10 at 251 from the Emblem of Frost vendor (5 pieces; vendor rows 35395, 35397 for the
hood and robe at vendor 35496, cost 2742) and the rest from what a raid has seen before Festergut 25N: Lower Spire 25N
(Marrowgar ref 34242, Deathwhisper 34243, Gunship 34251, Saurfang 34252), 10N Lower Spire (34230, 12036), Frost vendor
(vendor 37941), Ashen Verdict friendly ring, crafted 264 boots.

| Slot | Item (id) | ilvl | Where | Gems | Enchant |
| --- | --- | --- | --- | --- | --- |
| Head | Bloodmage Hood (50276) | 251 | T10, vendor | Chaotic Skyflare Diamond 41285, Purified Dreadstone 40133 | 3820 (+30 SP, +20 crit; Arcanum of Burning Mysteries) |
| Neck | Amulet of the Silent Eulogy (50005) | 264 | Gunship 25N (ref 34251, line 11180) | Reckless Ametrine 40155 | — |
| Shoulders | Bloodmage Shoulderpads (50279) | 251 | T10 | Reckless Ametrine | 3810 (+24 SP, +15 crit; Greater Inscription of the Storm) |
| Back | Drape of the Violet Tower (50468) | 264 | Frost vendor (npc_vendor line 37017) | Purified Dreadstone | 3831 (+23 haste) |
| Chest | Bloodmage Robe (50278) | 251 | T10 | Runed Cardinal Ruby 40113, Purified Dreadstone | 3832 (+10 all stats via aura 60694) |
| Wrists | The Lady's Brittle Bracers (49994) | 264 | Deathwhisper 25N (line 11104) | Reckless Ametrine | 2332 (+30 SP) |
| Hands | Bloodmage Gloves (50275) | 251 | T10 | Purified Dreadstone | 3246 (+28 SP) |
| Waist | Crushing Coldwraith Belt (49978) + Eternal Belt Buckle | 264 | Marrowgar 25N (line 11089) | Purified, Runed, Runed (buckle) | — |
| Legs | Bloodmage Leggings (50277) | 251 | T10 | Purified, Reckless | 3719 (+50 SP, +20 spi; Brilliant Spellthread) |
| Feet | Deathfrost Boots (49890) | 264 | crafted (no loot/vendor row) | Runed, Purified | 3826 (+12 hit, +12 crit; Icewalker) |
| Finger 1 | Loop of the Endless Labyrinth (49977) | 264 | Marrowgar 25N (line 11088) | Purified | — |
| Finger 2 | Ashen Band of Destruction (50377) | 251 | Ashen Verdict, friendly (quest reward; row to cite in 3a) | — | — |
| Trinket 1 | Muradin's Spyglass (50340) | 251 | Gunship 10N (ref 12036, line 2043) | — | — |
| Trinket 2 | Sliver of Pure Ice (50339) | 251 | Marrowgar 10N (ref 34230, line 10949) | — | — |
| Main hand | Nibelung (49992), staff | 264 | Deathwhisper 25N (line 11102) | Runed, Purified | 3854 (+81 SP) |

Totals from the items, gems, socket bonuses and flat enchants (scratch calculation; the loader recomputes them):
**SP 2883, Int 1117, Sta 1109, Spi 110, crit rating 939, haste rating 491, hit rating 408, MP5 30, armor 2148**, plus the
auras of the meta gem (44797: +3 % crit damage, MOD_CRIT_DAMAGE_BONUS), the chest enchant (60694: +10 all stats) and
the item spells listed in §6. Hit 408 = 15.55 % (26.232 per %); with a stand-in's Misery/Improved Faerie Fire (+3 %) the
17 % spell-hit requirement against a level-83 boss (§3.7) is met (the guide's 14 % cap with Misery, `configured`).
Set: Bloodmage Regalia (ItemSet 883) 5/5 → 2p 70752 / 4p 70748 (§6).

Consumables (`configured`, standard raid): Flask of the Frost Wyrm (+125 SP), Fish Feast (stat food; its spell is read in 3a-1), Potion of Speed pre-pot and one in combat. Mana Sapphire (the mage's own gem) — on-use mana.

Raid buffs and debuffs assumed from stand-ins (player note §13): Arcane Intellect (self), Mark of the Wild (modelled druid),
Blessing of Kings/Wisdom, Fortitude, Divine Spirit, Totem of Wrath or Demonic Pact (SP), Moonkin Aura/Elemental Oath
(+5 % crit), Wrath of Air (+5 % haste), Swift Retribution (+3 % haste), Ferocious Inspiration / Sanctified Retribution
(+3 % damage), Replenishment, Bloodlust/Heroism once, Curse of the Elements/Earth and Moon (+13 % spell damage taken),
Misery or Improved Faerie Fire (+3 % hit), and the 5 % spell crit debuff from the mage's own Improved Scorch.

## 5. Abilities used (rank 80 client values)

| Ability | Spell | Cast / GCD / CD | Cost | Effects (DBC) | Coefficient | AzerothCore |
| --- | --- | --- | --- | --- | --- | --- |
| Fireball r16 | 42833 | 3500 ms (−500 talent, −150 glyph) / 1500 cat 133 / — | 19 % base mana | e0 SCHOOL_DAMAGE 888..1132 (bp 887 + d245) fire; e1 PERIODIC_DAMAGE 29 every 2 s for 8 s; speed 24 yd/s; range 35 | DBC bonus 1.0 (no spell_bonus_data row); +15 % Empowered Fire | default handlers |
| Pyroblast r12 | 42891 | 5000 ms (instant with Hot Streak) / 1500 / — | 22 % | e0 1190..1510; e1 113 every 3 s for 12 s; speed 24 | 1.15 direct, 0.05 dot (`spell_bonus_data.sql` line 851) | Hot Streak's mod (48108: −100 % cast time on Pyroblast mask) |
| Living Bomb r3 | 55360 | instant / 1500 / — | 22 % | e0 PERIODIC_DAMAGE 345 every 3 s for 12 s; e1 DUMMY 55361 (on expire/dispel: explosion 55362, 690 fire in 10 yd, max targets unlimited) | 0.2 dot (line 1181), explosion 0.4 (line 1183) | `spell_mage_living_bomb` (spell_mage.cpp 766) casts the explosion on removal |
| Scorch r11 | 42859 | 1500 / 1500 / — | 8 % | 376..444 fire | 0.4286 (line 847) | applies Improved Scorch 22959 through the talent's proc (12873, procFlags 0x10000) |
| Fire Blast r11 | 42873 | instant / 1500 / 8 s (cat 19) | 21 % | 925..1095 | 0.4286 (line 849) | moving filler |
| Combustion | 11129 | instant, off GCD / 2 min | — | stacking +10 % fire crit per non-crit (28682, 10 stacks), 3 charges consumed by fire crits | — | `spell_mage_combustion` (spell_mage.cpp 1051); spell_proc line 257 |
| Molten Armor r3 | 43046 | instant / 1500 | 28 % | PROC_TRIGGER 43044 (fire damage to melee attackers), aura 197 (−5 % chance to be crit), aura 220 MOD_RATING_FROM_STAT: 35 % of spirit (+20 % glyph) as crit ratings | — | `spell_mage_molten_armor` (160) |
| Evocation | 12051 | channel 8 s / 4 min | — | +15 % max mana every 2 s (4 ticks) | — | needed if the fight runs past mana |
| Mirror Image | 55342 | instant / 3 min | 10 % | summons 3 images | — | **out of scope** (pets) |
| Arcane Intellect / Brilliance | 42995 / 43002 | buff | — | +60 Int | — | applied before the pull as a permanent aura |
| Mana Sapphire | item spell | on-use | — | mana | — | 3b decides (consumable) |

Off-GCD use: Combustion with Bloodlust (guide), potion of Speed, trinket on-use (Sliver of Pure Ice).

## 6. Procs and talent effects that matter

- **Hot Streak** (44448, spell_proc line 144, `spell_mage_hot_streak`, spell_mage.cpp 1264): two consecutive crits of
  Fireball/Scorch/Fire Blast/Living Bomb explosion/Frostfire (mask) → 48108 (10 s): next Pyroblast instant. Rank 3 is
  100 % (bp 99+1 on effect 0). The "two in a row" counter is script state.
- **Ignite** (12848, spell_proc line 232; `spell_mage_ignite`, spell_mage.cpp 710): fire crit → 40 % of the crit damage spread over 4 s
  in 2 ticks (12654), rolling the remaining amount into the new Ignite. Ignite does not crit and has no coefficient; it
  is applied with `CastDelayedSpellWithPeriodicAmount` ("implement ignite bug", spell_mage.cpp 710–752): amount =
  8 % × rank of the crit damage / max ticks; 3b reads how the existing Ignite is rolled into the new one and which
  done/taken steps apply to the ticks.
- **Master of Elements** (29076, line 184, `spell_mage_master_of_elements`, 822): 30 % of the spell's base mana cost
  on a fire/frost crit.
- **Burnout** (44472, spell_proc line 143, `spell_mage_burnout`, 209): +50 % crit damage bonus
  (SPELLMOD_CRIT_DAMAGE_BONUS on mask), and effect 1 (bp 4+1 = 5) makes each crit cost an extra 5 % of base mana — the
  amount's meaning is confirmed from the script in 3b.
- **Empowered Fire** (31658, spell_proc line 166): Ignite ticks restore 2 % base mana (67545, `spell_mage_empowered_fire`, 1087).
- **Clearcasting** from Arcane Concentration (12577, 10 % on hit; 12536 −100 % cost, 1 charge; spell_proc line 262).
- **Improved Scorch**: 22959 debuff (+5 % crit taken, MOD_ATTACKER_SPELL_CRIT_CHANCE (179), 30 s); spell group with
  Shadow Mastery / Winter's Chill (`spell_group.sql`) — if a stand-in warlock provides Shadow Mastery the mage skips
  Scorch (policy rule).
- **Combustion**: stacks of 28682 (+10 % fire crit each) until three fire crits.
- **Molten Fury**: target below 35 % health (MOD_DAMAGE_PERCENT_DONE through aura 112 OVERRIDE_CLASS_SCRIPTS misc 4920 —
  a class-script override in `SpellPctDamageModsDone`; 3b cites the line).
- **Focus Magic** (54646): the partner gets +3 % crit; when the partner crits, the mage gets 54648 (+3 % crit 10 s). A
  stand-in partner has no crits → the return proc never fires (honest stand-in limitation, listed).
- **T10 2p** (70752, dummy on Hot Streak / Missile Barrage / Brain Freeze mask) → Push the Button 70753: +12 % haste for
  5 s when the proc is consumed (script; 3b finds where 70752 is read). **T10 4p** (70748 → Quad Core 70747: +18 %
  damage for 30 s after Mirror Image) — needs Mirror Image, out of scope → listed as an omission.
- Trinkets: Muradin's Spyglass 71571 (spell damage → stacking SP, 10 stacks); Sliver of Pure Ice (on-use mana);
  Ashen Band 71581 (proc; the 251 ring has no Frostforged proc — check effect 2); Nibelung 71845 (2 % on hit: Val'kyr
  guardian, **out of scope**, pet).
- Meta gem: +3 % critical damage (44797, aura 163 MOD_CRIT_DAMAGE_BONUS; its school mask is the misc value).

## 7. Decision policy (priority list) — `configured` (wowtbc.gg, retrieved 2026-11-13)

Opener and single target: keep Molten Armor; pre-pot Potion of Speed; Scorch to apply Improved Scorch if no one else
provides the 5 % crit debuff; Living Bomb when not on the target (let it expire before refreshing: the explosion only
happens at expiry); Pyroblast when Hot Streak is up; Fireball otherwise; Fire Blast while moving (Living Bomb also while
moving); Combustion with Bloodlust (or on cooldown if the fight is long); Evocation when below a mana threshold
(assumption: 20 %). Festergut specifics come from the plan (spore runs, Vile Gas): moving interrupts Fireball (casting
while moving is refused, A-ish rule in casting.ts), so the policy uses instants while a rule move runs.

## 8. Engine requirements this spec adds (to 3a)

Mana and costs (percentage of base mana), spell power with DBC coefficient and spell_bonus_data, spell crit with the
crit stream and +50 % / meta / Burnout bonus, spell hit against level 83 with the hit stream, haste on cast time and
GCD, spell mods (cast time, crit chance, crit damage, bonus multiplier, cost, damage %), procs on crit/hit with
charges and script state (Hot Streak counter), travel time (exists), DoT ticks with fixed amounts (A-029 exists) and
periodic crit (Living Bomb glyph), an aura's expiry effect (exists: Living Bomb explosion), self-buff auras, cooldowns
(exists), and the stand-in crit debuff spell group.

## 9. Out of scope (with reason)

Mirror Image and T10 4p Quad Core (pets, not in Gate 1), Nibelung's Val'kyr (pet), the wand slot (left empty: no
available 25N/10N lower-spire wand; a wand would add 60 SP; owner may choose), Blast Wave/Dragon's Breath/Flamestrike
(AoE, no adds), Pyromaniac's regen (needs three targets), Torment the Weak (no snare on Festergut), Ice Block/Invisibility
(utility), spell pushback is **in** scope (Vile Gas hits the mage) once 3a researches it, partial resists (3a decides),
Focus Magic's return proc from a stand-in partner (stand-ins do not crit).
