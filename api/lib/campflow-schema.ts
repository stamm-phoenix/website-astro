/**
 * Building blocks of the schemas that read answers of the Playwright API (`GET /campflow/…`).
 * Those readers are strict about the structure (a missing list or a wrong amount refuses the
 * whole answer, because shown as 0 it would look like a real figure) and lenient about texts.
 */
import { z } from 'zod';
import { PlaywrightApiError } from './playwright-api';

/** Parses `value`, or throws a 502 `PlaywrightApiError` with `message`; the issues stay internal. */
export function readAnswer<S extends z.ZodType>(
  schema: S,
  value: unknown,
  message: string
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new PlaywrightApiError(502, message);
  return result.data;
}

/** Euros from the Playwright API to whole cents; no finite number is refused. */
export const euroCent = z.number().transform((euro) => Math.round(euro * 100));

/** A whole number of at least 0. */
export const wholeNumber = z.number().refine(Number.isInteger).min(0);

/** A text; anything else is read as `''`. */
export const textOrEmpty = z.string().catch('');

/** A day `YYYY-MM-DD`; anything else is read as `null`. */
export const dayOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .catch(null);

/** A timestamp `Date.parse` understands. */
export const parseableTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

/** An ID and a name; the name is `''` if it is missing. */
export const idAndName = z.object({ id: z.string(), name: textOrEmpty });
