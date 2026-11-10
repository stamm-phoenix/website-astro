import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBudget, isSpecPath, isTestSourcePath } from '../scripts/ci/e2e-budget';

const BASE = { specFiles: 10, tests: 50, loopedTests: 2 };

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
  assert.equal(evaluateBudget(BASE, { specFiles: 9, tests: 40, loopedTests: 1 }, []).ok, true);
});

test('a new test, spec file or looped test fails without e2e-ok', () => {
  assert.equal(evaluateBudget(BASE, { ...BASE, tests: 51 }, []).ok, false);
  assert.equal(evaluateBudget(BASE, { ...BASE, specFiles: 11 }, ['bug']).ok, false);
  assert.equal(evaluateBudget(BASE, { ...BASE, loopedTests: 3 }, []).ok, false);
});

test('the e2e-ok label releases a growing budget', () => {
  const result = evaluateBudget(BASE, { specFiles: 11, tests: 52, loopedTests: 2 }, ['e2e-ok']);
  assert.equal(result.ok, true);
  assert.match(result.messages.join(' '), /e2e-ok/);
});

test('the failure message does not tell the author to set the label', () => {
  const text = evaluateBudget(BASE, { ...BASE, tests: 51 }, []).messages.join(' ');
  assert.match(text, /nur Hugo oder eine maintainende Person/);
});
