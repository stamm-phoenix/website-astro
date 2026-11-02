import { z } from 'zod';
import { labeledText, lenientObject, parseWith } from './zod';
import type { GruppenstundenException } from '../gruppenstunden-exception-model';

const date = z.string({ error: 'Bitte ein gültiges Datum angeben.' }).refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  },
  { error: 'Bitte ein gültiges Datum angeben.' }
);

export const gruppenstundenExceptionSchema: z.ZodType<GruppenstundenException> = z
  .object(
    {
      startDate: date,
      endDate: date,
      message: labeledText('eine Nachricht', 500, true),
      location: labeledText('den anderen Treffpunkt', 120),
      time: labeledText('die andere Uhrzeit', 60),
    },
    { error: 'Bitte eine gültige Änderung angeben.' }
  )
  .refine((value) => value.endDate >= value.startDate, {
    error: 'Das Ende darf nicht vor dem Beginn liegen.',
    path: ['endDate'],
  });

/** Stored JSON from an older deployment may be missing or malformed. */
export function readGruppenstundenException(value: string | null): GruppenstundenException | null {
  if (!value) return null;
  try {
    const result = gruppenstundenExceptionSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Field keys shared by the regular and notice-only forms. */
export function gruppenstundenField([field, child]: readonly PropertyKey[]): string {
  const fields: Record<string, string> = {
    startDate: 'exceptionStartDate',
    endDate: 'exceptionEndDate',
    message: 'exceptionMessage',
    location: 'exceptionLocation',
    time: 'exceptionTime',
  };
  if (field === 'exception' && typeof child === 'string') return fields[child] ?? 'exception';
  return typeof field === 'string' ? field : 'form';
}

export function validateGruppenstundenHinweis(body: unknown): {
  exception: GruppenstundenException | null;
} {
  return parseWith(
    lenientObject({ exception: gruppenstundenExceptionSchema.nullable() }),
    body,
    gruppenstundenField
  );
}
