/** Bridge from zod to the field errors the Leitendenbereich forms show next to their inputs. */
import type { z } from 'zod';
import { ValidationError } from './pflege-validation';
import type { FieldErrors } from './pflege-validation';

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
