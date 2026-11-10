/**
 * Which browser specs a change can affect. Used on pull requests to run only those; everything
 * that cannot be mapped runs the whole suite (see `selectAffected`).
 *
 * The map is static and conservative:
 * - A page is affected when a changed file is in its import closure (page → layouts → components
 *   → stores → shared code in `api/lib`).
 * - A spec is affected when it, or a test helper it imports, changed, or when it names the route of
 *   an affected page (`goto('/leitendenbereich/belege')`, a link written as a string, the start of a
 *   template literal). A spec that names no route at all always runs.
 * - Anything else that is not documentation, a unit test or the API (config, packages, public
 *   files, the mock API, the CI scripts, workflows, files no page imports) runs everything.
 *
 * Not modelled: a spec that reaches a page only through clicks on a link whose address is not
 * written in the spec. The full suite on `main` catches those.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type Selection =
  { mode: 'all'; reason: string } | { mode: 'selected'; specs: string[]; reason: string };

const CODE_EXTENSIONS = ['.ts', '.js', '.mjs', '.svelte', '.astro'];
const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
];

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Resolves a relative import of `from` to a file that exists, or undefined. */
function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ''));
  const candidates = [
    base,
    ...CODE_EXTENSIONS.map((extension) => base + extension),
    ...CODE_EXTENSIONS.map((extension) => join(base, 'index' + extension)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const target = resolveImport(file, match[1]);
      if (target) found.add(target);
    }
  }
  return [...found];
}

/** Every file reachable from `start` through imports, including `start`. */
function closure(start: string, cache: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!CODE_EXTENSIONS.some((extension) => file.endsWith(extension)) || !existsSync(file))
      continue;
    let imports = cache.get(file);
    if (!imports) {
      imports = importsOf(file);
      cache.set(file, imports);
    }
    queue.push(...imports);
  }
  return seen;
}

interface Route {
  pattern: RegExp;
  page: string;
}

/** The routes of `src/pages`, plus the rewrites of `staticwebapp.config.json` to detail pages. */
export function routesOf(webRoot: string): Route[] {
  const pagesRoot = join(webRoot, 'src', 'pages');
  const routes: Route[] = [];
  for (const file of walk(pagesRoot)) {
    if (!file.endsWith('.astro')) continue;
    let route = relative(pagesRoot, file)
      .split(sep)
      .join('/')
      .replace(/\.astro$/, '')
      .replace(/(^|\/)index$/, '');
    route = '/' + route;
    const source = route
      .replace(/[.*+?^${}()|\\]/g, '\\$&')
      .replace(/\[[^\]]+\]/g, '[^/]+')
      .replace(/\/$/, '');
    routes.push({ pattern: new RegExp(`^${source || ''}/?$`), page: file });
  }
  const rewrites: [string, string][] = [
    ['/leitendenbereich/abrechnung', 'abrechnung/detail.astro'],
    ['/leitendenbereich/sammelbestellungen', 'sammelbestellungen/detail.astro'],
  ];
  for (const [prefix, detail] of rewrites) {
    routes.push({
      pattern: new RegExp(`^${prefix}/[^/]+/?$`),
      page: join(pagesRoot, 'leitendenbereich', detail),
    });
  }
  return routes;
}

/** Route-like strings in a file: `'/path'`, `"/path"` and the part of a template before `${`. */
function routeLiterals(file: string): { exact: string[]; prefixes: string[] } {
  const source = readFileSync(file, 'utf8');
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const match of source.matchAll(/(['"`])(\/[A-Za-z0-9_\-./]*)([?#][^'"`$]*)?\1/g)) {
    exact.add(match[2].replace(/\/$/, '') || '/');
  }
  for (const match of source.matchAll(/`(\/[A-Za-z0-9_\-./]*)\$\{/g)) {
    prefixes.add(match[1]);
  }
  return { exact: [...exact], prefixes: [...prefixes] };
}

/** Addresses of real pages that a spec writes out, without query (for example /leitendenbereich/belege). */
export function urlsNamedBySpec(spec: string, webRoot: string): string[] {
  const routes = routesOf(webRoot);
  const cache = new Map<string, string[]>();
  const urls = new Set<string>();
  for (const file of closure(spec, cache)) {
    if (!file.endsWith('.ts')) continue;
    for (const literal of routeLiterals(file).exact) {
      if (routes.some((route) => route.pattern.test(literal))) urls.add(literal);
    }
  }
  return [...urls].sort();
}

/** Pages a spec names, through itself and the test helpers it imports. */
export function pagesOfSpec(
  spec: string,
  routes: Route[],
  cache: Map<string, string[]>
): Set<string> {
  const pages = new Set<string>();
  for (const file of closure(spec, cache)) {
    if (!file.endsWith('.ts')) continue;
    const { exact, prefixes } = routeLiterals(file);
    for (const literal of exact) {
      for (const route of routes) if (route.pattern.test(literal)) pages.add(route.page);
    }
    for (const prefix of prefixes) {
      const start = prefix.replace(/\/$/, '');
      for (const route of routes) {
        // `${id}` follows: the page of that segment or anything below the prefix
        if (
          route.pattern.test(start) ||
          route.pattern.source.startsWith('^' + start.replace(/[.*+?^${}()|\\]/g, '\\$&'))
        )
          pages.add(route.page);
      }
    }
  }
  return pages;
}

/** No effect on the browser specs. `api/` is not here: a page may import shared code from it. */
const IGNORED = [
  /^docs\//,
  /\.md$/,
  /^web\/test\//,
  /^infrastructure\//,
  /^flake\.(nix|lock)$/,
  /^justfile$/,
];

export interface SelectOptions {
  /** Repository root */
  root: string;
  /** Changed files relative to the repository root, forward slashes */
  changed: string[];
}

export function selectAffected({ root, changed }: SelectOptions): Selection {
  const webRoot = join(root, 'web');
  const testsRoot = join(webRoot, 'tests');
  const srcRoot = join(webRoot, 'src');
  const specs = walk(testsRoot).filter((file) => file.endsWith('.spec.ts'));
  const cache = new Map<string, string[]>();
  const routes = routesOf(webRoot);

  const affectedPages = new Set<string>();
  const changedTests = new Set<string>();
  // Files the mock API (served to every spec) and each spec import: a change there is felt without
  // any page importing it
  const mockFiles = closure(join(webRoot, 'dev', 'mockApi.ts'), cache);
  const specFiles = new Map(specs.map((spec) => [spec, closure(spec, cache)]));
  const pageClosures = new Map<string, Set<string>>();
  const pagesRoot = join(srcRoot, 'pages');
  const pageFiles = walk(pagesRoot).filter((file) => file.endsWith('.astro'));
  for (const page of pageFiles) pageClosures.set(page, closure(page, cache));

  for (const path of changed) {
    if (IGNORED.some((pattern) => pattern.test(path))) continue;
    const file = join(root, path);
    const isTest = path.startsWith('web/tests/');
    const isCode = path.startsWith('web/src/') || path.startsWith('api/');
    if (!isTest && !isCode) {
      return { mode: 'all', reason: `${path} can affect every spec` };
    }
    // Deleted: the files that imported it changed too
    if (!existsSync(file)) continue;
    if (isTest) {
      changedTests.add(file);
      continue;
    }
    let reached = false;
    for (const [page, files] of pageClosures) {
      if (files.has(file)) {
        affectedPages.add(page);
        reached = true;
      }
    }
    if (!reached && path.startsWith('web/src/')) {
      return { mode: 'all', reason: `${path} is imported by no page` };
    }
    if (!reached && mockFiles.has(file)) {
      return { mode: 'all', reason: `${path} is part of the mock API` };
    }
    // Code in a spec's own import closure (a helper, a shared module) selects that spec
    for (const [spec, files] of specFiles) if (files.has(file)) changedTests.add(spec);
  }

  const selected: string[] = [];
  for (const spec of specs) {
    const files = specFiles.get(spec)!;
    const touchesTest = [...changedTests].some((test) => files.has(test));
    const pages = pagesOfSpec(spec, routes, cache);
    const touchesPage = [...pages].some((page) => affectedPages.has(page));
    const namesNoPage = pages.size === 0;
    if (touchesTest || touchesPage || namesNoPage) {
      selected.push(relative(testsRoot, spec).split(sep).join('/'));
    }
  }
  return {
    mode: 'selected',
    specs: selected.sort(),
    reason: `${changed.length} changed files, ${affectedPages.size} pages affected`,
  };
}
