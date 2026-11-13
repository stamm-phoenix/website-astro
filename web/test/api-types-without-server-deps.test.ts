import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The web job installs only `web/`. Any file of `web/` that imports from `api/lib`, even with
 * `import type`, makes `svelte-check` and `astro check` load that file and everything it imports.
 * If that graph reaches the database, Azure or image code, the checks fail for packages that only
 * `api/` has. Types the web shares with the API therefore live in modules (`*-model.ts`) whose
 * imports stay inside this allowed set.
 */
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = resolve(WEB, '../api');
const ROOTS = ['src', 'dev', 'test', 'tests'].map((folder) => join(WEB, folder));
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(svelte|ts)$/.test(name) ? [path] : [];
  });
}

/** Every module specifier a file imports or re-exports, type-only ones included. */
function specifiers(path: string): string[] {
  let text = readFileSync(path, 'utf8');
  if (path.endsWith('.svelte')) {
    text = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((hit) => hit[1]).join('\n');
  }
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteral(literal)) found.push(literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier).replace(/\.js$/, '');
  return [`${base}.ts`, base, join(base, 'index.ts'), `${base}.svelte`].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  );
}

/** A package the web job has: installed in `web/node_modules` or part of Node. */
function webHas(specifier: string): boolean {
  if (specifier.startsWith('node:') || isBuiltin(specifier)) return true;
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  return existsSync(join(WEB, 'node_modules', name));
}

/** First chain from an API module to a package the web job lacks, or `undefined`. */
function missingPackage(path: string, seen: Set<string>, chain: string[]): string | undefined {
  if (seen.has(path)) return undefined;
  seen.add(path);
  for (const specifier of specifiers(path)) {
    const target = resolveImport(path, specifier);
    const next = specifier.startsWith('.')
      ? target && missingPackage(target, seen, [...chain, relative(API, target)])
      : webHas(specifier)
        ? undefined
        : [...chain, specifier].join(' → ');
    if (next) return next;
  }
  return undefined;
}

test('a file of web/ imports no API module that reaches a package only api/ installs', () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap(files)) {
    for (const specifier of specifiers(file)) {
      const target = resolveImport(file, specifier);
      if (!target?.startsWith(`${API}/`)) continue;
      const chain = missingPackage(target, new Set(), [relative(API, target)]);
      if (chain) offenders.push(`${relative(WEB, file)} imports api/${chain}`);
    }
  }
  assert.deepEqual(offenders.sort(), []);
});
