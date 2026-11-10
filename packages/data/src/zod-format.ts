import type { ZodError } from 'zod';

export interface Issue {
  readonly path: string;
  readonly message: string;
}

export function zodIssues(error: ZodError): Issue[] {
  return error.issues.map((i) => ({ path: i.path.length ? i.path.join('.') : '(root)', message: i.message }));
}

export function formatZod(error: ZodError): string {
  return zodIssues(error)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');
}
