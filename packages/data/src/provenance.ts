import { z } from 'zod';
import { DifficultySchema } from './difficulty';

const Commit = z.string().regex(/^[0-9a-f]{40}$/, 'must be a 40-character commit hash');
const NonEmpty = z.string().min(1);
export const DataKeySchema = z.string().regex(/^[a-z0-9_.]+$/, 'keys use lowercase letters, digits, _ and .');

export const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code'), file: NonEmpty, commit: Commit, line: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('db'), table: NonEmpty, key: NonEmpty, commit: Commit }).strict(),
  z
    .object({ kind: z.literal('spelldata'), spellId: z.number().int().positive(), field: NonEmpty, dataVersion: NonEmpty })
    .strict(),
  z
    .object({
      kind: z.literal('log'),
      logFile: NonEmpty,
      encounter: z
        .object({ server: NonEmpty, difficulty: DifficultySchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
        .strict(),
      uncertainty: NonEmpty,
    })
    .strict(),
  z.object({ kind: z.literal('derived'), formula: NonEmpty, inputs: z.array(DataKeySchema).min(1) }).strict(),
  z.object({ kind: z.literal('configured'), file: NonEmpty }).strict(),
  z.object({ kind: z.literal('assumption'), rationale: NonEmpty, confirmBy: NonEmpty }).strict(),
]);
export type Source = z.infer<typeof SourceSchema>;
export type SourceKind = Source['kind'];

export const ValueSchema = z.union([z.number().finite(),z.string(), z.boolean()]);
export type Value = z.infer<typeof ValueSchema>;

export const DataEntrySchema = z.object({ key: DataKeySchema, value: ValueSchema, source: SourceSchema }).strict();
export type DataEntry = z.infer<typeof DataEntrySchema>;

export const OverrideEntrySchema = z
  .object({
    key: DataKeySchema,
    overrides: DataKeySchema,
    value: ValueSchema,
    source: SourceSchema.refine((s) => s.kind === 'log', 'an override must have a log source'),
  })
  .strict();
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;
