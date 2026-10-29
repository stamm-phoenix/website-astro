/**
 * Check of ticking off a planned dish. It parses with the schema of `essen-kochen-schema.ts`; the
 * type it returns is declared in `essen-kochen-model.ts`, which the browser imports.
 */
import type { AbhakenInput } from './essen-kochen-model';
import { abhakenSchema } from './essen-kochen-schema';
import { parseWith } from './validation/zod';

export function validateAbhaken(input: unknown): AbhakenInput {
  return parseWith(abhakenSchema, input);
}
