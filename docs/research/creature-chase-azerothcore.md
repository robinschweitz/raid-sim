# How AzerothCore creatures chase their victim — research notes

Collected 2026-11-13 from `azerothcore/azerothcore-wotlk` at the pinned commit
`dca1a87699e380f3c19af54f9003d837c696131d`. Line numbers are at that commit. The engine's model of
this is adaptation A-040 (`packages/engine/src/chase.ts`).

At this commit `ChaseMovementGenerator` has no file of its own: it lives in
`src/server/game/Movement/MovementGenerators/TargetedMovementGenerator.cpp` / `.h` (below: TMG.cpp,
TMG.h).

## 1. Who starts the chase

- `UnitAI::AttackStart(victim)` (`src/server/game/AI/CoreAI/UnitAI.cpp` 29–33):
  `if (victim && me->Attack(victim, true)) me->GetMotionMaster()->MoveChase(victim);` — no range,
  no angle.
- `ScriptedAI::AttackStart` (`src/server/game/AI/ScriptedAI/ScriptedCreature.cpp` 228–234) calls it
  when `me->IsCombatMovementAllowed()`, else `AttackStartNoMove` (219–226: attack without a chase).
  `BossAI` derives from `ScriptedAI`; `boss_festergut.cpp` does not override `AttackStart`.
- `IsCombatMovementAllowed()` (`Creature.h` 456) returns `_isCombatMovementAllowed`, initialised to
  `true` (`Creature.cpp` 272) and changed only by `SetCombatMovement` (`Creature.cpp` 3972–3975).
  `boss_festergut.cpp` never calls it, and Festergut's `flags_extra` 2148007937 has no
  no-movement flag, so he chases.
- On a victim change: `CreatureAI::UpdateVictim` (`CreatureAI.cpp` 350–370) calls
  `AttackStart(victim)` when `SelectVictim()` returns a unit other than the current victim.
  `MotionMaster::MoveChase` (`MotionMaster.cpp` 316–340) keeps the running chase generator and calls
  `SetOffsetAndAngle` and `SetNewTarget` (TMG.cpp 65–80), which forget the last target position, so
  the next update re-paths to the new victim. Until then `HasLostTarget` (TMG.h 58:
  `GetVictim() != GetTarget()`) pauses the chase (TMG.cpp 230–240).
- `MoveChase` does nothing with `UNIT_FLAG_DISABLE_MOVE` (`MotionMaster.cpp` 319–320).

## 2. One chase update (`ChaseMovementGenerator<T>::DoUpdate`, TMG.cpp 210–409)

Order of the checks:

1. 219–224: `UNIT_STATE_NO_COMBAT_MOVEMENT` → `StopMoving`, forget the target position.
2. 226–240: `UNIT_STATE_NOT_MOVE`, `HasLostTarget`, or `IsMovementPreventedByCasting()` →
   `StopMoving`, forget the target position, return. Movement resumes on a later update.
3. Distances (no `_range`, no angle for a plain `MoveChase(victim)`):
   - `chaseRange = GetChaseRange(owner, target)` (35–44) = both combat reaches (no hover delta);
   - `meleeRange = owner->GetMeleeRange(target)` (253);
   - `maxRange = meleeRange` (255);
   - `maxTarget = CONTACT_DISTANCE + chaseRange` (256); `CONTACT_DISTANCE` is 0.5 (`ObjectDefines.h` 23).
4. 275–298: every 400 ms (`i_recheckDistance.Reset(400); // Sniffed value`, 279) the generator stops
   (`StopMoving`, 291) when `PositionOkay(maxTarget)` (47–63: exact distance ≤ maxTarget and line
   of sight) holds while it is moving and the target stands still (285).
5. 300–312: a finished spline clears `UNIT_STATE_CHASE_MOVE`.
6. 323–405: when the target's position changed since the last path (or it was forgotten), and the
   owner is chase-moving or not in position (`!PositionOkay(maxTarget)`, 330):
   - `moveToward = !(IsInDist(target, maxRange) && LOS)` (344–346);
   - moving toward with no angle: path to the target's centre and cut it to `maxTarget` from the
     target (`shortenPath`, 376–380; `ShortenPathUntilDist(targetPos, maxTarget)`, 189–190);
   - otherwise (already within melee range but farther than maxTarget) a near point
     (`GetNearPoint`, 384; `Object.cpp` 2759–2761 and 2722–2747: the target's combat reach from
     its centre), stopped by the 400 ms recheck once within maxTarget;
   - a moving target is predicted half a second ahead only in the near-point branch
     (`additionalRange`, 355–371);
   - run, not walk, unless the creature's movement template says otherwise (388–402);
     `DispatchSplineToPosition` (101–208) uses the path generator; a failed path stops the owner and
     sets "cannot reach" (172–185).

So the creature re-paths on every update in which its victim moved, and it stops at
`CONTACT_DISTANCE` + both combat reaches from the victim's centre. With Festergut (combat reach 8,
display scale 1) and a player (1.5) that is 10 yd centre to centre; his melee range is
`max(8 + 1.5 + 4/3, 5)` = 10.83 yd.

## 3. Update frequency and order

- `Unit::Update` (`Unit.cpp` 510–646) runs `UpdateSplineMovement` and then
  `GetMotionMaster()->UpdateMotion(p_time)` (642–643) on every unit update.
- `Creature::Update` (`Creature.cpp` 710–905) calls `Unit::Update(diff)` (775) before
  `i_AI->UpdateAI(diff)` (899). The chase therefore moves the creature before the AI of the same
  update decides; a cast started by the AI stops the movement on the next update.
- The update spacing is the map update interval (10 ms by default, `core.ai_update_interval_ms`).

## 4. Speed

- `Unit::GetSpeed(MOVE_RUN)` = `m_speed_rate[MOVE_RUN] × baseMoveSpeed[MOVE_RUN]` (`Unit.cpp`
  11109–11112); `baseMoveSpeed[MOVE_RUN]` = 7.0 (`Unit.cpp` 82–84).
- `Creature::InitEntry` sets `SetSpeed(MOVE_RUN, cinfo->speed_run)` (`Creature.cpp` 563).
- Festergut: speed_run 1.5873 → 11.111 yd/s (`festergut.speed_yd_s`, derived in
  `packages/content/src/festergut/data.ts`).

## 5. Casting stops a creature's chase

- `Creature::IsMovementPreventedByCasting` (`Creature.cpp` 3710–3730): false during a channel that
  allows actions; true with a spell focus; true with `UNIT_STATE_CASTING`.
- `UNIT_STATE_CASTING` is set by `Unit::SetCurrentCastedSpell` for a generic spell with a cast time
  (`Unit.cpp` 3946–3947) and for every channel (3965); instant spells do not set it. It is cleared
  when the cast finishes (`Spell.cpp` 4160–4161, 4656–4657).
- `Spell::prepare` refuses a cast-time spell for a moving caster only when the caster is a player
  (`Spell.cpp` 3691: `unitCaster->IsPlayer() && unitCaster->isMoving()`). A moving creature starts
  the cast; its chase update then stops it (TMG.cpp 227–233).

## 6. Melee while moving

- `UnitAI::DoMeleeAttackIfReady` (`UnitAI.cpp` 41–67) checks only `IsActionPreventedByCasting`,
  the victim and `IsWithinMeleeRange`; nothing about movement. A chasing creature swings as soon as
  its victim is in melee range, also before the chase stops.
- `Unit::IsWithinMeleeRange` (`Unit.cpp` 790–805): 3D squared distance `<` (dist +
  `GetMeleeRange` + leeway)²; `GetMeleeRange` (807–811) = `max(both combat reaches + 4/3,
  NOMINAL_MELEE_RANGE 5)`.
- Leeway (`Object.cpp` 1765–1787, `LEEWAY_BONUS_RANGE` 2.66 in `ObjectDefines.h` 51): 2.66 yd when
  a player is involved and both units move forward, strafe or fall without walking. The engine does
  not model leeway (A-022).

## 7. Facing

`SetFacing(GetTarget())` on the spline (TMG.cpp 202–203), `SetInFront` on stop (292, 306) and spell
focus (`Creature::FocusTarget`, `Creature.cpp` 3624–3642) turn the creature. The engine has no
orientation, so facing is ignored.

## What the engine models (A-040)

- Combat movement is a boss-script setting (`BossScript.combatMovement`, default true like
  `Creature.cpp` 272); the training dummy turns it off; a unit with speed 0 never chases.
- On every AI update, before the script: no victim or a cast in progress → stop; within maxTarget
  (both reaches + 0.5 yd) → stop; else walk in a straight line, at the unit's run speed, to the point
  maxTarget short of the victim's current centre. A new victim re-paths at once; a moving victim at
  most every 400 ms.
- Simplified: 2D, straight lines, no path generator, line of sight or obstacles; no prediction of a
  moving victim; the stop is checked on every update and does not wait for a still victim or the
  400 ms recheck; a victim inside melee range but beyond maxTarget is approached on the straight
  line, not at the near point; the 400 ms re-path spacing replaces "every update the victim moved".
