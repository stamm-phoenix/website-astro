import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The browser runs the Svelte components and the modules of `src/lib`, which import values from
 * `api/lib` (models, rules). zod must not get into that graph: it would ship to every visitor.
 * Type-only imports are erased and do not count. Build-time modules (`src/lib/content`) are exempt.
 */
const SRC = resolve(import.meta.dir, '../src');
const IMPORT = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(svelte|ts)$/.test(name) ? [path] : [];
  });
}

/** Runtime imports of a file, as module specifiers. */
function imports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(IMPORT)].filter((hit) => !hit[2]).map((hit) => hit[3]);
}

function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.svelte`, join(base, 'index.ts')].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  );
}

test('the code of the browser never imports zod', () => {
  const roots = files(SRC).filter((path) => !path.includes(`${SRC}/lib/content/`));
  const seen = new Set<string>();
  const offenders: string[] = [];
  const visit = (path: string, chain: string[]): void => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const specifier of imports(path)) {
      if (specifier === 'zod' || specifier.startsWith('zod/')) {
        offenders.push([...chain, relative(SRC, path)].join(' → '));
        continue;
      }
      const target = resolveImport(path, specifier);
      if (target) visit(target, [...chain, relative(SRC, path)]);
    }
  };
  for (const root of roots) visit(root, []);
  expect(offenders).toEqual([]);
});
