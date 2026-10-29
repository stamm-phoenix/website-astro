/**
 * Checks of the forms for shops, stock and extra needs. They parse with the schemas of
 * `essen-einkauf-schema.ts`; the types they return are declared in `essen-einkauf-model.ts`,
 * which the browser imports and which therefore stays free of zod.
 */
import type { GeschaeftInput, PostenArt, PostenInput } from './essen-einkauf-model';
import { geschaeftSchema, postenSchema, zutatGeschaeftSchema } from './essen-einkauf-schema';
import { parseWith } from './validation/zod';
import type { FieldOf } from './validation/zod';

export function validateGeschaeft(input: unknown): GeschaeftInput {
  return parseWith(geschaeftSchema, input);
}

/** A name of its own is typed in the field of the ingredient, so its errors show there. */
const postenFeld: FieldOf = ([first]) =>
  first === 'name' ? 'zutat' : typeof first === 'string' ? first : 'form';

export function validatePosten(input: unknown, art: PostenArt): PostenInput {
  return parseWith(postenSchema(art), input, postenFeld);
}

/** The shop an ingredient is bought at; null takes it away. */
export function validateZutatGeschaeft(input: unknown): number | null {
  return parseWith(zutatGeschaeftSchema, input).geschaeftId;
}
