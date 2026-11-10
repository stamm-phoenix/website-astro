import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countRegistrations } from '../scripts/ci/e2e-test-count';

const count = (source: string): number => countRegistrations(source).declared;

test('counts tests on one line, inside describe and nested blocks', () => {
  assert.equal(
    count("test.describe('x', () => { test('a', async () => {}); test('b', async () => {}); });"),
    2
  );
  assert.equal(count("if (true) { test('a', async () => {}); }"), 1);
  assert.equal(count("test('a', handler);"), 1);
  assert.equal(count("test.only('a', async () => {});"), 1);
});

test('counts aliases of test', () => {
  assert.equal(count("import { test as t } from '@playwright/test';\nt('a', async () => {});"), 1);
  assert.equal(
    count(
      "import { test as base } from '@playwright/test';\nconst it = base.extend({});\nit('a', async () => {});"
    ),
    1
  );
  assert.equal(
    count("import { test } from './fixtures';\nconst check = test;\ncheck('a', async () => {});"),
    1
  );
  assert.equal(count("import * as pw from '@playwright/test';\npw.test('a', async () => {});"), 1);
});

test('counts titled skip, fixme and fail, but not modifiers or hooks', () => {
  assert.equal(
    count(
      "test.skip('a', async () => {}); test.fixme('b', async () => {}); test.fail('c', async () => {});"
    ),
    3
  );
  assert.equal(
    count(
      "test.skip(isMobile, 'reason'); test.fixme(true, 'x'); test.slow(); test.skip(({ browserName }) => browserName === 'webkit', 'x');"
    ),
    0
  );
  assert.equal(
    count(
      "test.beforeEach(async () => {}); test.use({}); test.setTimeout(1); test.info(); await test.step('s', async () => {});"
    ),
    0
  );
  assert.equal(
    count("test.describe.only('x', () => {}); test.describe.configure({ mode: 'serial' });"),
    0
  );
});

test('ignores comments, strings and templates', () => {
  const source = [
    "// test('commented', async () => {});",
    "/* test('block', async () => {}); */",
    'const text = "test(\'in string\', async () => {})";',
    'const tpl = `test("in template", async () => {})`;',
  ].join('\n');
  assert.equal(count(source), 0);
});

test('reports declarations in loops separately', () => {
  const source = [
    'for (const n of [1, 2]) { test(`a ${n}`, async () => {}); }',
    "['a', 'b'].forEach((n) => test(`b ${n}`, async () => {}));",
    "test('plain', async () => {});",
  ].join('\n');
  assert.deepEqual(countRegistrations(source), { declared: 3, looped: 2, uncertain: 0 });
});

test('counts parenthesised, non-null and element-access callees', () => {
  assert.equal(
    count(
      "(test)('a', async () => {}); test!('b', async () => {}); test['only']('c', async () => {});"
    ),
    3
  );
});

test('counts chained extend, mergeTests and renamed destructuring', () => {
  assert.equal(
    count(
      "import { test as base } from '@playwright/test';\nconst t = base.extend({}).extend({});\nt('a', async () => {});"
    ),
    1
  );
  assert.equal(
    count(
      "import { test as base, mergeTests } from '@playwright/test';\nconst t = mergeTests(base, other);\nt('a', async () => {});"
    ),
    1
  );
  assert.equal(
    count("const { test: t } = require('@playwright/test');\nt('a', async () => {});"),
    1
  );
});

test('a helper that declares tests counts once per reference, not once in the helper', () => {
  const helper = 'function reg(n: string) { test(n, async () => {}); }\n';
  assert.equal(count(helper), 0);
  assert.equal(count(`${helper}reg('a'); reg('b');`), 2);
  assert.equal(count(`${helper}reg('a'); reg('b'); reg('c');`), 3);
  // by reference: `describe('x', suite)` and `.forEach(reg)`
  assert.equal(
    count("const suite = () => { test('a', async () => {}); };\ntest.describe('x', suite);"),
    1
  );
  assert.deepEqual(countRegistrations(`${helper}['a', 'b'].forEach(reg);`), {
    declared: 1,
    looped: 1,
    uncertain: 0,
  });
});

test('test passed to a function or used dynamically is uncertain', () => {
  assert.equal(countRegistrations('defineSuites(test);').uncertain, 1);
  assert.equal(
    countRegistrations("import { test as t } from '@playwright/test';\nregister(t, 'a');")
      .uncertain,
    1
  );
  assert.equal(
    countRegistrations("const kind = 'only';\ntest[kind]('a', async () => {});").uncertain,
    1
  );
  assert.equal(countRegistrations('expect(page).toBeVisible(); test.use({});').uncertain, 0);
});
