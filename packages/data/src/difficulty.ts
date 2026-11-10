import { z } from 'zod';

export const DifficultySchema = z.enum(['10n', '10h', '25n', '25h']);
export type Difficulty = z.infer<typeof DifficultySchema>;
