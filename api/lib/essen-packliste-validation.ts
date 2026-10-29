/**
 * Checks of the requests of the packing list. They parse with the schemas of
 * `essen-packliste-schema.ts`; the types they return are declared in `essen-packliste-model.ts`,
 * which the browser imports and which therefore stays free of zod.
 */
import type { PackAenderung, PackEintragInput, WerkzeugAenderung } from './essen-packliste-model';
import { packAenderungSchema, packEintragSchema, werkzeugSchema } from './essen-packliste-schema';
import { ValidationError } from './validation/errors';
import { parseWith } from './validation/zod';

export function validatePackEintrag(input: unknown): PackEintragInput {
  const value = parseWith(packEintragSchema, input);
  return { ...value, zustaendigText: value.zustaendigId === null ? value.zustaendigText : '' };
}

export function validatePackAenderung(input: unknown): PackAenderung {
  return parseWith(packAenderungSchema, input);
}

/** The state of a tool: its name and the changed fields; every field reports at once. */
export function validateWerkzeugAenderung(input: unknown): WerkzeugAenderung {
  let werkzeug: string | undefined;
  let aenderung: PackAenderung | undefined;
  let fields: Record<string, string> = {};
  try {
    werkzeug = parseWith(werkzeugSchema, input).werkzeug;
  } catch (error: unknown) {
    if (!(error instanceof ValidationError)) throw error;
    fields = { ...fields, ...error.fields };
  }
  try {
    aenderung = validatePackAenderung(input);
  } catch (error: unknown) {
    if (!(error instanceof ValidationError)) throw error;
    fields = { ...fields, ...error.fields };
  }
  if (!werkzeug || !aenderung) throw new ValidationError(fields);
  return { werkzeug, ...aenderung };
}
