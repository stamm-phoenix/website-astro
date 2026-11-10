import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Runs the real script the way the workflow does: from a `web/` directory, `HEAD^1 HEAD`, label from
// PR_LABELS. Each case commits a base and a head version of an existing spec in a throwaway repository.
const SCRIPT = resolve(import.meta.dirname, '../scripts/ci/e2e-budget.ts');
const SPEC = 'web/tests/existing.spec.ts';
const BASE = "test.describe('x', () => {\n  test('a', async () => {});\n});\n";

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args],
    {
      cwd,
      stdio: 'pipe',
    }
  );
}

function run(
  head: string,
  labels: string[],
  base: Record<string, string> = {},
  spec = SPEC
): { status: number | null; output: string } {
  const repo = mkdtempSync(join(tmpdir(), 'e2e-budget-'));
  try {
    mkdirSync(join(repo, 'web/tests'), { recursive: true });
    git(repo, 'init', '-q');
    for (const [path, content] of Object.entries(base)) writeFileSync(join(repo, path), content);
    if (!(spec in base)) writeFileSync(join(repo, spec), BASE);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    writeFileSync(join(repo, spec), head);
    git(repo, 'commit', '-q', '-a', '--allow-empty', '-m', 'head');
    const result = spawnSync(process.execPath, [SCRIPT, 'HEAD^1', 'HEAD'], {
      cwd: join(repo, 'web'),
      env: { ...process.env, PR_LABELS: JSON.stringify(labels) },
      encoding: 'utf8',
    });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const ONE_MORE_SAME_LINE =
  "test.describe('x', () => {\n  test('a', async () => {}); test('b', async () => {});\n});\n";
const ALIASED = `${BASE}import { test as t } from '@playwright/test';\nt('b', async () => {});\n`;
const LOOP = `${BASE}for (const n of [1, 2]) { test(\`n \${n}\`, async () => {}); }\n`;

test('adding a test to an existing spec fails without the label, also on one line or via an alias', () => {
  for (const head of [ONE_MORE_SAME_LINE, ALIASED, LOOP]) {
    const result = run(head, ['enhancement']);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /nur Hugo oder eine maintainende Person/);
    assert.doesNotMatch(result.output, /setze das Label/i);
  }
});

test('the e2e-ok label releases the added test', () => {
  const result = run(ONE_MORE_SAME_LINE, ['e2e-ok']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Freigegeben/);
});

test('changes that add no test pass without the label', () => {
  const unchanged = `${BASE}// test('commented', async () => {});\nconst s = "test('string', async () => {})";\n`;
  const modifiers =
    "test.describe('x', () => {\n  test('a', async ({ page }) => { test.slow(); test.skip(true, 'reason'); });\n  test.beforeEach(async () => {});\n});\n";
  for (const head of [BASE, unchanged, modifiers]) {
    const result = run(head, []);
    assert.equal(result.status, 0, result.output);
  }
});

// Provenance and helpers: the same bypass attempts as above, but through other files.
const FIXTURES =
  "import { test as base } from '@playwright/test';\nexport default base.extend({});\n";
const HELPER =
  "import { test } from './fixtures';\nexport function reg(n: string) { test(n, async () => {}); }\n";

test('a default-imported fixture alias and a helper call count like test', () => {
  const files = { 'web/tests/fixtures.ts': FIXTURES, 'web/tests/helper.ts': HELPER };
  const base = `import it from './fixtures';\nimport { reg } from './helper';\nit('a', async () => {});\nreg('b');\n`;
  const baseFiles = { ...files, [SPEC]: base };
  for (const head of [
    `${base}it('c', async () => {});\n`, // default-import alias
    `${base}reg('c');\n`, // one more helper call, no new declaration
  ]) {
    const result = run(head, [], baseFiles);
    assert.equal(result.status, 1, result.output);
    assert.equal(run(head, ['e2e-ok'], baseFiles).status, 0);
  }
  assert.equal(run(base, [], baseFiles).status, 0);
});

test('passing test to a function needs review, an unrelated default import does not', () => {
  const base = { 'web/tests/fixtures.ts': FIXTURES };
  const uncertain = run(`${BASE}defineSuites(test);\n`, [], base);
  assert.equal(uncertain.status, 1, uncertain.output);
  assert.match(uncertain.output, /nicht sicher bestimmen/);
  assert.equal(
    run(`${BASE}import dayjs from 'dayjs';\ndayjs('a', async () => {});\n`, [], base).status,
    0
  );
});
