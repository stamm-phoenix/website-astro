import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countTests, evaluateBudget, isSpecPath } from '../scripts/ci/e2e-budget';

test('countTests counts tests but not describe blocks, steps or hooks', () => {
  const source = [
    "test.describe('x', () => {",
    "  test('a', async () => {",
    "    await test.step('s', async () => {});",
    '  });',
    "  test.skip('b', async () => {});",
    "  test.only('c', async () => {});",
    '  test.beforeEach(async () => {});',
    '  test.use({ viewport: null });',
    '});',
    "// test('commented') is not at the line start",
  ].join('\n');
  assert.equal(countTests(source), 3);
});

test('countTests ignores in-test modifiers but counts titled skips', () => {
  const source = [
    "test('a', async ({ page }, testInfo) => {",
    '  test.slow();',
    "  test.skip(testInfo.project.name !== 'desktop', 'only desktop');",
    '});',
    "test.fixme('b', async () => {});",
  ].join('\n');
  assert.equal(countTests(source), 2);
});

test('isSpecPath only matches spec files below web/tests', () => {
  assert.equal(isSpecPath('web/tests/a.spec.ts'), true);
  assert.equal(isSpecPath('web/tests/helpers.ts'), false);
  assert.equal(isSpecPath('web/test/a.spec.ts'), false);
});

test('unchanged or smaller budgets pass without label', () => {
  const base = { specFiles: 10, tests: 50 };
  assert.equal(evaluateBudget(base, base, []).ok, true);
  assert.equal(evaluateBudget(base, { specFiles: 9, tests: 40 }, []).ok, true);
});

test('a new test or spec file fails without e2e-ok', () => {
  const base = { specFiles: 10, tests: 50 };
  assert.equal(evaluateBudget(base, { specFiles: 10, tests: 51 }, []).ok, false);
  assert.equal(evaluateBudget(base, { specFiles: 11, tests: 50 }, ['bug']).ok, false);
});

test('the e2e-ok label releases a growing budget', () => {
  const result = evaluateBudget({ specFiles: 10, tests: 50 }, { specFiles: 11, tests: 52 }, [
    'e2e-ok',
  ]);
  assert.equal(result.ok, true);
  assert.match(result.messages.join(' '), /e2e-ok/);
});
