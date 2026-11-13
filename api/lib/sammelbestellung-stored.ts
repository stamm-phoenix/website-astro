import { HELP_CONTACTS } from './help-contacts';

/** Identifies corrupt persisted data without substituting an apparently empty order. */
export class InvalidSammelDataError extends Error {
  constructor(rowId: string, field: string) {
    super(
      `Eintrag ${rowId}: Das Feld ${field} enthält ungültige Daten. Bitte wende dich an ${HELP_CONTACTS.technik}.`
    );
    this.name = 'InvalidSammelDataError';
  }
}

/** Runs the stored value through the same validation as an input, so corrupt rows fail visibly. */
export function validStored<T>(rowId: number | string, field: string, read: () => T): T {
  try {
    return read();
  } catch {
    throw new InvalidSammelDataError(String(rowId), field);
  }
}

export function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Groups rows by a numeric column; each group keeps the order of the rows. */
export function groupBy<T extends Record<K, number>, K extends string>(
  rows: T[],
  key: K
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const group = groups.get(row[key]);
    if (group) group.push(row);
    else groups.set(row[key], [row]);
  }
  return groups;
}
