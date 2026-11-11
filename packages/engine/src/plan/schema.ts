import { DifficultySchema } from '@raid/data';
import { z } from 'zod';
import { EVENT_KINDS } from '../trace';

export const IdSchema = z.string().regex(/^[a-z0-9_-]+$/, 'ids use lowercase letters, digits, _ and -');
/** Unit references with a special meaning; roster ids must not use them. */
export const RESERVED_REFS: readonly string[] = ['self', 'current_tank', 'boss'];
const TextKeySchema = z.string().regex(/^[a-z0-9_.]+$/, 'text keys use lowercase letters, digits, _ and .');
const Vec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const ReactionSchema = z.object({ minMs: z.number().int().min(0), maxMs: z.number().int().min(0) }).strict();
export const PlayerRoleSchema = z.enum(['tank', 'healer', 'melee', 'ranged']);

export const ModelledMemberSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    kind: z.literal('modelled'),
    spec: IdSchema,
    profile: IdSchema,
    reaction: ReactionSchema,
  })
  .strict();

export const StandinMemberSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    kind: z.literal('standin'),
    role: PlayerRoleSchema,
    maxHealth: z.number().int().positive(),
    ratePerSecond: z.number().finite().min(0),
    buffs: z.array(IdSchema).default([]),
    armor: z.number().int().min(0).default(0),
    avoidance: z
      .object({ missPct: z.number().finite().min(0).max(100), dodgePct: z.number().finite().min(0).max(100), parryPct: z.number().finite().min(0).max(100) })
      .strict()
      .default({ missPct: 0, dodgePct: 0, parryPct: 0 }),
    threatMultiplier: z.number().finite().min(0).default(1),
    reaction: ReactionSchema,
  })
  .strict();

export const MemberSchema = z.discriminatedUnion('kind', [ModelledMemberSchema, StandinMemberSchema]);

export const TriggerSchema = z.discriminatedUnion('on', [
  z.object({ on: z.literal('aura_applied'), aura: IdSchema, target: IdSchema }).strict(),
  z.object({ on: z.literal('aura_stacks'), aura: IdSchema, target: IdSchema, atLeast: z.number().int().min(1) }).strict(),
  z.object({ on: z.literal('cast_start'), spell: IdSchema, caster: IdSchema }).strict(),
  z.object({ on: z.literal('time'), atMs: z.number().int().min(0) }).strict(),
  z.object({ on: z.literal('health_below'), target: IdSchema, pct: z.number().finite().gt(0).max(100) }).strict(),
]);

export const ActionSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('move_to'), spot: IdSchema }).strict(),
  z.object({ do: z.literal('return_to_assignment') }).strict(),
  z.object({ do: z.literal('stop_casting') }).strict(),
  z.object({ do: z.literal('taunt'), target: IdSchema }).strict(),
  z.object({ do: z.literal('use_cooldown'), spell: IdSchema, target: IdSchema.optional() }).strict(),
]);

export const RuleSchema = z
  .object({
    id: IdSchema,
    who: z.array(IdSchema).min(1),
    when: TriggerSchema,
    do: ActionSchema,
    priority: z.number().int().min(1).max(100).default(50),
    mode: z.literal('edge').default('edge'),
    cooldownMs: z.number().int().min(0).default(0),
    retry: z.object({ times: z.number().int().min(1), everyMs: z.number().int().min(1) }).strict().optional(),
  })
  .strict();

export const PlanSchema = z
  .object({
    id: IdSchema,
    boss: IdSchema,
    roster: z.array(MemberSchema).min(1),
    spots: z.record(IdSchema, Vec2Schema),
    phases: z.array(z.object({ phase: IdSchema, assignments: z.record(IdSchema, IdSchema) }).strict()).min(1),
    rules: z.array(RuleSchema).default([]),
  })
  .strict();

export const MistakeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('disable_rule'), rule: IdSchema }).strict(),
  z.object({ type: z.literal('exclude_from_rule'), rule: IdSchema, player: IdSchema }).strict(),
  z.object({ type: z.literal('set_stack_threshold'), rule: IdSchema, atLeast: z.number().int().min(1) }).strict(),
  z
    .object({ type: z.literal('reaction'), player: IdSchema, minMs: z.number().int().min(0), maxMs: z.number().int().min(0) })
    .strict(),
]);

const WhereSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});

export const ObservationCheckSchema = z.discriminatedUnion('check', [
  z.object({ check: z.literal('outcome_is'), outcome: z.enum(['kill', 'wipe', 'timeout']) }).strict(),
  z.object({ check: z.literal('event_occurs'), kind: z.enum(EVENT_KINDS), where: WhereSchema }).strict(),
  z.object({ check: z.literal('event_absent'), kind: z.enum(EVENT_KINDS), where: WhereSchema }).strict(),
  z
    .object({
      check: z.literal('custom'),
      name: z.string().regex(/^[a-z0-9_.-]+$/),
      params: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
]);

export const AnnotationSchema = z
  .object({
    text: TextKeySchema,
    at: z.union([
      z.object({ ms: z.number().int().min(0) }).strict(),
      z.object({ event: z.enum(EVENT_KINDS), nth: z.number().int().min(1).default(1), where: WhereSchema }).strict(),
    ]),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    id: IdSchema,
    plan: z.string().min(1),
    difficulty: DifficultySchema,
    seed: z.number().int().min(0),
    profile: z.enum(['azerothcore', 'rising-gods']).default('azerothcore'),
    maxDurationMs: z.number().int().positive(),
    mistakes: z.array(MistakeSchema).default([]),
    observation: z.object({ text: TextKeySchema, checks: z.array(ObservationCheckSchema).min(1) }).strict(),
    annotations: z.array(AnnotationSchema).default([]),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type ModelledMember = z.infer<typeof ModelledMemberSchema>;
export type StandinMember = z.infer<typeof StandinMemberSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Mistake = z.infer<typeof MistakeSchema>;
export type ObservationCheck = z.infer<typeof ObservationCheckSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
