import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTests, renderSummary, type Report } from '../scripts/ci/flaky-summary';

const spec = (title: string, line: number, project: string, statuses: string[]) => ({
  title,
  file: 'tests/a.spec.ts',
  line,
  tests: [{ projectName: project, results: statuses.map((status) => ({ status })) }],
});

const report: Report = {
  suites: [
    {
      specs: [spec('ok', 1, 'desktop', ['passed'])],
      suites: [
        {
          specs: [
            spec('flaky | one', 10, 'mobile', ['failed', 'passed']),
            spec('broken', 20, 'desktop', ['failed', 'timedOut']),
            spec('skipped', 30, 'desktop', ['skipped']),
          ],
        },
      ],
    },
  ],
};

test('listTests separates failed and flaky tests, also in nested suites', () => {
  const lists = listTests(report);
  assert.deepEqual(
    lists.failed.map((t) => t.title),
    ['broken']
  );
  assert.deepEqual(
    lists.flaky.map((t) => [t.line, t.project]),
    [[10, 'mobile']]
  );
});

test('listTests ignores an interrupted test', () => {
  const lists = listTests({ suites: [{ specs: [spec('x', 1, 'p', ['interrupted'])] }] });
  assert.deepEqual(lists.failed, []);
});

test('renderSummary is empty without failed or flaky tests', () => {
  assert.equal(renderSummary({ failed: [], flaky: [] }), '');
  assert.equal(renderSummary(listTests({ suites: [] })), '');
});

test('renderSummary lists file:line, title and project and escapes pipes', () => {
  const text = renderSummary(listTests(report), 'Chromium 1');
  assert.ok(text.includes('## Chromium 1'));
  assert.ok(text.includes('`tests/a.spec.ts:10` | flaky \\| one | mobile | 2'));
  assert.ok(text.includes('Fehlgeschlagen (1)'));
});

test('renderSummary escapes a backslash before a pipe', () => {
  const text = renderSummary(
    listTests({ suites: [{ specs: [spec('a\\|b', 5, 'p', ['failed', 'failed'])] }] })
  );
  assert.ok(text.includes('| a\\\\\\|b | p |'));
});
