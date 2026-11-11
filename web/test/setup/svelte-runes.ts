/**
 * Preload of `bun test` (bunfig.toml): compiles `*.svelte.ts` and `*.svelte.js` modules with the
 * Svelte compiler, so a unit test can import a store or helper that uses runes (`$state`,
 * `$derived`) instead of driving it through a browser. Components (`.svelte`) are not handled.
 */
import { compileModule } from 'svelte/compiler';

interface LoadArgs {
  path: string;
}

interface BunRuntime {
  plugin(definition: {
    name: string;
    setup(build: {
      onLoad(
        options: { filter: RegExp },
        load: (args: LoadArgs) => Promise<{ contents: string; loader: 'js' }>
      ): void;
    }): void;
  }): void;
  file(path: string): { text(): Promise<string> };
  Transpiler: new (options: { loader: 'ts' }) => { transformSync(code: string): string };
}

const bun = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const typescript = new bun.Transpiler({ loader: 'ts' });

bun.plugin({
  name: 'svelte-runes',
  setup(build) {
    build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async ({ path }) => {
      const source = await bun.file(path).text();
      const code = path.endsWith('.ts') ? typescript.transformSync(source) : source;
      const { js } = compileModule(code, { filename: path, generate: 'client' });
      return { contents: js.code, loader: 'js' };
    });
  },
});
