import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  budgetOfSources,
  evaluateBudget,
  isSpecPath,
  isTestSourcePath,
} from '../scripts/ci/e2e-budget';

const BASE = { specFiles: 10, tests: 50, loopedTests: 2, uncertain: 0 };

test('isSpecPath matches Playwright spec files below web/tests, isTestSourcePath any source there', () => {
  assert.equal(isSpecPath('web/tests/a.spec.ts'), true);
  assert.equal(isSpecPath('web/tests/a.test.js'), true);
  assert.equal(isSpecPath('web/tests/helpers.ts'), false);
  assert.equal(isSpecPath('web/test/a.spec.ts'), false);
  assert.equal(isTestSourcePath('web/tests/helpers.ts'), true);
  assert.equal(isTestSourcePath('web/tests/data.json'), false);
});

test('unchanged or smaller budgets pass without label', () => {
  assert.equal(evaluateBudget(BASE, BASE, []).ok, true);
  assert.equal(
    evaluateBudget(BASE, { specFiles: 9, tests: 40, loopedTests: 1, uncertain: 0 }, []).ok,
    true
  );
});

test('a new test, spec file or looped test fails without e2e-ok', () => {
  assert.equal(evaluateBudget(BASE, { ...BASE, tests: 51 }, []).ok, false);
  assert.equal(evaluateBudget(BASE, { ...BASE, specFiles: 11 }, ['bug']).ok, false);
  assert.equal(evaluateBudget(BASE, { ...BASE, loopedTests: 3 }, []).ok, false);
  assert.equal(evaluateBudget(BASE, { ...BASE, uncertain: 1 }, []).ok, false);
});

test('the e2e-ok label releases a growing budget', () => {
  const result = evaluateBudget(BASE, { specFiles: 11, tests: 52, loopedTests: 2, uncertain: 0 }, [
    'e2e-ok',
  ]);
  assert.equal(result.ok, true);
  assert.match(result.messages.join(' '), /e2e-ok/);
});

test('the failure message does not tell the author to set the label', () => {
  const text = evaluateBudget(BASE, { ...BASE, tests: 51 }, []).messages.join(' ');
  assert.match(text, /nur Hugo oder eine maintainende Person/);
});

test('imports of test are followed by provenance, other imports are not', () => {
  const fixtures = [
    "import { test as base } from '@playwright/test';",
    'export default base.extend({});',
    'export const named = base.extend({});',
    'export { base as renamed };',
  ].join('\n');
  const specs = (use: string): Map<string, string> =>
    new Map([
      ['web/tests/fixtures.ts', fixtures],
      ['web/tests/a.spec.ts', use],
    ]);
  const tests = (use: string): number => budgetOfSources(specs(use)).tests;
  assert.equal(tests("import t from './fixtures';\nt('a', async () => {});"), 1);
  assert.equal(tests("import { named as t } from './fixtures';\nt('a', async () => {});"), 1);
  assert.equal(tests("import { renamed as t } from './fixtures.js';\nt('a', async () => {});"), 1);
  assert.equal(tests("import dayjs from 'dayjs';\ndayjs('a', async () => {});"), 0);
  assert.equal(tests("import other from './elsewhere';\nother('a', async () => {});"), 0);
});

test('helpers in one file are counted per reference in another', () => {
  const sources = (calls: string): Map<string, string> =>
    new Map([
      [
        'web/tests/helper.ts',
        "import { test } from './fixtures';\nexport function reg(n: string) { test(n, async () => {}); }",
      ],
      ['web/tests/a.spec.ts', `import { reg } from './helper';\n${calls}`],
    ]);
  assert.equal(budgetOfSources(sources("reg('a'); reg('b');")).tests, 2);
  assert.equal(budgetOfSources(sources("reg('a'); reg('b'); reg('c');")).tests, 3);
});
