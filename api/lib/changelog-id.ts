/**
 * IDs of the entries in the changelog of the Leitendenbereich (`web/src/lib/changelogEntries.ts`),
 * shared by the API and the frontend. Free of imports.
 *
 * An ID is the day of the entry, a two-digit number that counts the entries of that day, and a
 * short name, e.g. `2026-10-20-04-neuigkeiten`. Date and number come first, so IDs compare as
 * plain text: a larger ID is a newer entry, also for several entries of one day.
 */
export const CHANGELOG_ID = /^\d{4}-\d{2}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest ID the database column holds. */
export const CHANGELOG_ID_MAX_LENGTH = 80;

export function isChangelogId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= CHANGELOG_ID_MAX_LENGTH && CHANGELOG_ID.test(value)
  );
}
