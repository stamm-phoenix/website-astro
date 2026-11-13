import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Answers `changelog/entries/<id>.ts?id` with the ID alone, which is the name of the file (checked
 * by `test/changelog.test.ts`). `src/lib/changelogIds.ts` collects them with `import.meta.glob`, so
 * the menu can count unread entries without loading the texts of all entries.
 */
export default function changelogIds(): Plugin {
  return {
    name: 'changelog-ids',
    enforce: 'pre',
    load(id) {
      const [file, query] = id.split('?');
      if (query !== 'id' || !/[\\/]changelog[\\/]entries[\\/][^\\/]+\.ts$/.test(file)) return null;
      return `export default ${JSON.stringify(path.basename(file, '.ts'))};`;
    },
  };
}
