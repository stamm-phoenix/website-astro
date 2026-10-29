/**
 * Shared building blocks of the zod validators: the bridge to the `ValidationError` field errors
 * and the schemas every module needs (labeled text, choices, an input that may be no object).
 */
import { z } from 'zod';
import { ValidationError } from './errors';
import type { FieldErrors } from './errors';

/** Names the form field an issue belongs to; the default is the first path segment. */
export type FieldOf = (path: readonly PropertyKey[]) => string;

const firstSegment: FieldOf = ([first]) => (typeof first === 'string' ? first : 'form');

/**
 * Parses `value` with `schema`, or throws a `ValidationError` with the first message per field.
 * The schemas carry the German messages, so nothing of zod's own wording reaches the forms.
 */
export function parseWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
  fieldOf: FieldOf = firstSegment
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: FieldErrors = {};
  for (const issue of result.error.issues) fields[fieldOf(issue.path)] ??= issue.message;
  throw new ValidationError(fields);
}

/** Whether the value is a plain JSON object (no array, no null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An object schema that reads anything but an object as `{}`, so the missing fields report. */
export function lenientObject<S extends z.ZodRawShape>(shape: S) {
  return z.preprocess((value) => (isRecord(value) ? value : {}), z.object(shape));
}

/**
 * Text of a form field: trimmed, runs of whitespace collapsed, and a missing value is `''`.
 * `label` is the accusative phrase of the messages („den Namen“ → „Bitte den Namen angeben.“).
 */
export function labeledText(label: string, max: number, required = false) {
  return z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value.trim().replace(/\s+/g, ' ')
        : value === undefined || value === null
          ? ''
          : value,
    z
      .string({ error: `${label} ist ungültig.` })
      .min(required ? 1 : 0, { error: `Bitte ${label} angeben.` })
      .max(max, { error: `${label} darf höchstens ${max} Zeichen lang sein.` })
  );
}

/** One of the allowed strings. */
export function choice<const T extends readonly [string, ...string[]]>(label: string, allowed: T) {
  return z.enum(allowed, { error: `Bitte eine gültige Auswahl für ${label} treffen.` });
}

/** A list of allowed strings; duplicates are dropped. */
export function choices(label: string, allowed: readonly string[]) {
  const message = `${label} enthält ungültige Werte.`;
  return z
    .array(
      z.string({ error: message }).refine((value) => allowed.includes(value), { error: message }),
      { error: message }
    )
    .transform((values) => [...new Set(values)]);
}
