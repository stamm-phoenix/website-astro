/**
 * Checks of the forms for groups and participants. They parse with the schemas of
 * `essen-teilnehmende-schema.ts`; the types they return are declared in
 * `essen-teilnehmende-model.ts`, which the browser imports and which therefore stays free of zod.
 */
import type { Ernaehrung, GruppeInput, TeilnehmendeInput } from './essen-teilnehmende-model';
import { gruppeSchema, teilnehmendeSchema } from './essen-teilnehmende-schema';
import { parseWith } from './validation/zod';

export function validateGruppe(input: unknown): GruppeInput {
  return parseWith(gruppeSchema, input);
}

export function validateTeilnehmende(input: unknown): TeilnehmendeInput {
  const parsed = parseWith(teilnehmendeSchema, input);
  return { ...parsed, ernaehrung: parsed.ernaehrung as Ernaehrung };
}
