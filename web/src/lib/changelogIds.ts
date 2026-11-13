import { sortedNewestFirst } from './changelog';

/**
 * Die IDs der Neuigkeiten, die neueste zuerst: der Name jeder Datei in `changelog/entries/` ist
 * ihre ID. Die Navigation zählt damit die ungelesenen Einträge, ohne die Texte aller Einträge
 * zu laden (`changelogEntries.ts`, nur für die Seite „Neuigkeiten“). Außerhalb von Vite liest
 * `test/setup/changelog-entries.ts` dieselben Dateinamen.
 */
const modules = import.meta.glob<string>('./changelog/entries/*.ts', {
  query: '?id',
  import: 'default',
  eager: true,
});

export const CHANGELOG_IDS: readonly string[] = sortedNewestFirst(
  Object.values(modules).map((id) => ({ id }))
).map(({ id }) => id);
