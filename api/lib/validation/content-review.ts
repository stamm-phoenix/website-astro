import { z } from 'zod';
import { parseWith } from './zod';

const schema = z.object({
  etag: z
    .string({ error: 'Lade den Eintrag vor dem Prüfen neu.' })
    .regex(/^"[0-9a-f]{16}"$/, { error: 'Lade den Eintrag vor dem Prüfen neu.' }),
});

export function validateContentReview(value: unknown): { etag: string } {
  return parseWith(schema, value);
}
