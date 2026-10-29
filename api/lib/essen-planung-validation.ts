/**
 * Checks of the forms of a Planung of the Essensplanung. They parse with the schemas of
 * `essen-planung-schema.ts`; the types they return are declared in `essen-planung-model.ts`,
 * which the browser imports and which therefore stays free of zod.
 */
import {
  anlegenSchema,
  beitrittSchema,
  einladungSchema,
  einplanungSchema,
  emailSchema,
  mahlzeitSchema,
  mitgliedNameSchema,
  planungEinstellungenSchema,
  positionSchema,
  tagSchema,
} from './essen-planung-schema';
import type {
  AnlegenInput,
  BeitrittInput,
  EinladungInput,
  EinplanungInput,
  MahlzeitInput,
  PlanungEinstellungenInput,
} from './essen-planung-model';
import { parseWith } from './validation/zod';

export function validateAnlegen(input: unknown): AnlegenInput {
  return parseWith(anlegenSchema, input);
}

export function validateMitgliedName(input: unknown): string {
  return parseWith(mitgliedNameSchema, input).name;
}

export function validateBeitritt(input: unknown): BeitrittInput {
  return parseWith(beitrittSchema, input);
}

export function validateEinladung(input: unknown): EinladungInput {
  return parseWith(einladungSchema, input);
}

export function validateEmail(input: unknown): string {
  return parseWith(emailSchema, input).email;
}

export function validatePlanungEinstellungen(input: unknown): PlanungEinstellungenInput {
  return parseWith(planungEinstellungenSchema, input);
}

export function validateTag(input: unknown): string {
  return parseWith(tagSchema, input).datum;
}

export function validateMahlzeit(input: unknown): MahlzeitInput {
  return parseWith(mahlzeitSchema, input);
}

/** A position (1-based) for moving a meal within its day, or undefined. */
export function readPosition(value: unknown): number | undefined {
  const position = positionSchema.safeParse(value);
  return position.success ? position.data : undefined;
}

export function validateEinplanung(input: unknown): EinplanungInput {
  return parseWith(einplanungSchema, input);
}
