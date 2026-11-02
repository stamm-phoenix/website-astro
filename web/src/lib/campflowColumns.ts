import type { PersonColumn } from './campflowFields';

/** Columns added to the table after it first remembered a choice, shown once to everyone. */
export const NEW_COLUMN_KEYS = ['beitrag', 'verwendungszweck'];

/** Keys of the compact first view; custom fields remain available in the picker and details. */
export function defaultColumnKeys(available: PersonColumn[]): string[] {
  return available
    .filter((c) => ['name', 'status', 'age', 'beitrag', 'verwendungszweck'].includes(c.key))
    .map((c) => c.key);
}
