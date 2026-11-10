import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAffected } from '../scripts/ci/affected-specs';

let root = '';
const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'affected-specs-'));
  write('web/src/layouts/Base.astro', '');
  write('web/src/lib/format.ts', 'export const f = 1;');
  write('web/src/components/Menu.svelte', "<script>import { f } from '../lib/format';</script>");
  write('web/src/components/Table.svelte', '');
  write('web/src/pages/index.astro', "---\nimport Base from '../layouts/Base.astro';\n---");
  write(
    'web/src/pages/belege.astro',
    "---\nimport Base from '../layouts/Base.astro';\nimport Table from '../components/Table.svelte';\n---"
  );
  write(
    'web/src/pages/menue.astro',
    "---\nimport Base from '../layouts/Base.astro';\nimport Menu from '../components/Menu.svelte';\n---"
  );
  write('web/src/orphan.ts', '');
  write('web/src/pages/leer.astro', '');
  write('web/tests/helper.ts', "export const open = (page) => page.goto('/menue');");
  write(
    'web/tests/belege.spec.ts',
    "test('a', async ({ page }) => { await page.goto('/belege'); });"
  );
  write('web/tests/menue.spec.ts', "import { open } from './helper';\ntest('b', () => open());");
  write('web/tests/start.spec.ts', "test('c', async ({ page }) => { await page.goto('/'); });");
  write('web/tests/unbekannt.spec.ts', "test('d', async () => { await somethingDynamic(); });");
  write('api/lib/shared.ts', 'export const s = 1;');
  write('api/lib/only-api.ts', 'export const t = 1;');
  write('api/lib/mocked.ts', 'export const m = 1;');
  write('web/dev/mockApi.ts', "import { m } from '../../api/lib/mocked';");
  write('api/lib/helper-shared.ts', 'export const h = 1;');
  write(
    'web/tests/uses-api-helper.spec.ts',
    "import { h } from '../../api/lib/helper-shared';\ntest('f', async ({ page }) => { await page.goto('/leer'); });"
  );
  write('web/src/lib/uses-api.ts', "import { s } from '../../../api/lib/shared';");
  write('web/src/pages/geteilt.astro', "---\nimport { s } from '../lib/uses-api';\n---");
  write(
    'web/tests/geteilt.spec.ts',
    "test('e', async ({ page }) => { await page.goto('/geteilt'); });"
  );
});
after(() => rmSync(root, { recursive: true, force: true }));

const specsFor = (...changed: string[]): string[] | 'all' => {
  const selection = selectAffected({ root, changed });
  return selection.mode === 'all' ? 'all' : selection.specs;
};

test('a component selects the specs of the pages that import it, and specs naming no page', () => {
  assert.deepEqual(specsFor('web/src/components/Table.svelte'), [
    'belege.spec.ts',
    'unbekannt.spec.ts',
  ]);
});

test('shared code is followed through imports', () => {
  assert.deepEqual(specsFor('web/src/lib/format.ts'), ['menue.spec.ts', 'unbekannt.spec.ts']);
});

test('a layout selects the specs of every page that uses it', () => {
  assert.deepEqual(specsFor('web/src/layouts/Base.astro'), [
    'belege.spec.ts',
    'menue.spec.ts',
    'start.spec.ts',
    'unbekannt.spec.ts',
  ]);
});

test('code in api/ counts where a page imports it, and not otherwise', () => {
  assert.deepEqual(specsFor('api/lib/shared.ts'), ['geteilt.spec.ts', 'unbekannt.spec.ts']);
  assert.deepEqual(specsFor('api/lib/only-api.ts'), ['unbekannt.spec.ts']);
});

test('api code that the mock API serves runs everything; code a spec imports selects that spec', () => {
  assert.equal(specsFor('api/lib/mocked.ts'), 'all');
  assert.ok((specsFor('api/lib/helper-shared.ts') as string[]).includes('uses-api-helper.spec.ts'));
});

test('a changed spec or helper selects the specs that use it', () => {
  assert.deepEqual(specsFor('web/tests/start.spec.ts'), ['start.spec.ts', 'unbekannt.spec.ts']);
  assert.deepEqual(specsFor('web/tests/helper.ts'), ['menue.spec.ts', 'unbekannt.spec.ts']);
});

test('documentation and unit tests select nothing but specs naming no page', () => {
  assert.deepEqual(specsFor('docs/x.md', 'README.md', 'web/test/a.test.ts'), ['unbekannt.spec.ts']);
});

test('anything that cannot be mapped runs everything', () => {
  assert.equal(specsFor('web/package.json'), 'all');
  assert.equal(specsFor('web/playwright.config.ts'), 'all');
  assert.equal(specsFor('web/dev/mockApi.ts'), 'all');
  assert.equal(specsFor('.github/workflows/browser-tests.yml'), 'all');
  assert.equal(specsFor('web/public/staticwebapp.config.json'), 'all');
  assert.equal(specsFor('web/src/orphan.ts'), 'all');
  assert.equal(specsFor('web/src/lib/format.ts', 'web/package.json'), 'all');
});

test('a deleted file selects nothing by itself', () => {
  assert.deepEqual(specsFor('web/src/components/Gone.svelte'), ['unbekannt.spec.ts']);
});

test('in the real repository, every spec is mapped to a page', () => {
  const real = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  // One change that reaches no spec but those without a page names every unmapped spec
  const selection = selectAffected({ root: real, changed: ['docs/x.md'] });
  assert.equal(selection.mode, 'selected');
  if (selection.mode === 'selected') {
    assert.deepEqual(selection.specs, [], 'specs that name no route would always run');
  }
});
