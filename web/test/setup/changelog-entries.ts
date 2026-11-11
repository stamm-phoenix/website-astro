/**
 * Preload of `bun test` (bunfig.toml): `src/lib/changelogEntries.ts` collects the entry files with
 * `import.meta.glob`, which only Vite knows. This gives a unit test that imports a store using
 * the changelog the same list, built from the same files (as `test/changelogFiles.ts` does).
 */
import { readdirSync } from 'node:fs';

interface LoadArgs {
  path: string;
}

interface BunRuntime {
  plugin(definition: {
    name: string;
    setup(build: {
      onLoad(
        options: { filter: RegExp },
        load: (args: LoadArgs) => { contents: string; loader: 'js' }
      ): void;
    }): void;
  }): void;
}

const bun = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const LIB = new URL('../../src/lib/', import.meta.url).pathname;
const ENTRIES = `${LIB}changelog/entries/`;

bun.plugin({
  name: 'changelog-entries',
  setup(build) {
    build.onLoad({ filter: /[\\/]lib[\\/]changelogEntries\.ts$/ }, () => {
      const files = readdirSync(ENTRIES).filter((file) => file.endsWith('.ts'));
      const imports = files.map((file, index) => `import e${index} from '${ENTRIES}${file}';`);
      const contents = [
        `import { sortedNewestFirst } from '${LIB}changelog.ts';`,
        ...imports,
        `export const CHANGELOG = sortedNewestFirst([${files.map((_, index) => `e${index}`).join(', ')}]);`,
      ].join('\n');
      return { contents, loader: 'js' };
    });
  },
});
