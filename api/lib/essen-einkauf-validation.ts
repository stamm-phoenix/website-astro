/**
 * Checks of the forms for shops, stock and extra needs. They parse with the schemas of
 * `essen-einkauf-schema.ts`; the types they return are declared in `essen-einkauf-model.ts`,
 * which the browser imports and which therefore stays free of zod.
 */
import type { GeschaeftInput, PostenArt, PostenInput } from './essen-einkauf-model';
import { geschaeftSchema, postenSchema, zutatGeschaeftSchema } from './essen-einkauf-schema';
import { parseWith } from './validation/zod';

export function validateGeschaeft(input: unknown): GeschaeftInput {
  return parseWith(geschaeftSchema, input);
}

export function validatePosten(input: unknown, art: PostenArt): PostenInput {
  return parseWith(postenSchema(art), input);
}

/** The shop an ingredient is bought at; null takes it away. */
export function validateZutatGeschaeft(input: unknown): number | null {
  return parseWith(zutatGeschaeftSchema, input).geschaeftId;
}
