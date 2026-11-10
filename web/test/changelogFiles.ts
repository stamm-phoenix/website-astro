import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { ChangelogEntry } from '../src/lib/changelog';
import { sortedNewestFirst } from '../src/lib/changelog';

const DIR = new URL('../src/lib/changelog/entries/', import.meta.url);

/** The entry files by name, for tests and scripts outside Vite, where `import.meta.glob` is missing. */
export async function loadChangelogFiles(): Promise<{ file: string; entry: ChangelogEntry }[]> {
  const files = readdirSync(DIR).filter((file) => file.endsWith('.ts'));
  return Promise.all(
    files.map(async (file) => {
      const module = (await import(pathToFileURL(new URL(file, DIR).pathname).href)) as {
        default: ChangelogEntry;
      };
      return { file, entry: module.default };
    })
  );
}

/** The changelog as the website builds it, newest first. */
export async function loadChangelog(): Promise<ChangelogEntry[]> {
  return sortedNewestFirst((await loadChangelogFiles()).map(({ entry }) => entry));
}
