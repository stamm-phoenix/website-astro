import type { ChangelogEntry } from './changelog';
import { sortedNewestFirst } from './changelog';

/**
 * Die Neuigkeiten des Leitendenbereichs, die neueste zuerst. Jeder Eintrag ist eine Datei in
 * `changelog/entries/`, der Dateiname ist die ID (siehe AGENTS.md, „Changelog“). Außerhalb von
 * Vite (`bun test`, Playwright) liest `test/changelogFiles.ts` dieselben Dateien.
 */
const modules = import.meta.glob<{ default: ChangelogEntry }>('./changelog/entries/*.ts', {
  eager: true,
});

export const CHANGELOG: ChangelogEntry[] = sortedNewestFirst(
  Object.values(modules).map((module) => module.default)
);
