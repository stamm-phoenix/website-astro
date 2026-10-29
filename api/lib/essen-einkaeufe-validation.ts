/**
 * Checks of the shopping trips. They parse with the schemas of `essen-einkaeufe-schema.ts`; the
 * types they return are declared in `essen-einkaeufe-model.ts`, which the browser imports and
 * which therefore stays free of zod.
 */
import type {
  EinkaufInput,
  HakenInput,
  RegelInput,
  VerschiebenInput,
} from './essen-einkaeufe-model';
import {
  einkaufSchema,
  hakenSchema,
  regelSchema,
  verschiebenSchema,
} from './essen-einkaeufe-schema';
import { parseWith } from './validation/zod';

export function validateEinkauf(input: unknown): EinkaufInput {
  return parseWith(einkaufSchema, input);
}

export function validateHaken(input: unknown): HakenInput {
  return parseWith(hakenSchema, input);
}

export function validateRegel(input: unknown): RegelInput {
  return parseWith(regelSchema, input);
}

export function validateVerschieben(input: unknown): VerschiebenInput {
  return parseWith(verschiebenSchema, input);
}

/** The version of the thing ticked off before, or null when it is ticked off for the first time. */
export function readHakenEtag(body: Record<string, unknown> | null): string | null {
  const etag = body?.etag;
  return typeof etag === 'string' && /^(?:W\/)?"[^"\r\n]+"$/.test(etag) ? etag : null;
}
