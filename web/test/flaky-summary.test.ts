import { describe, expect, test } from 'bun:test';
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

describe('listTests', () => {
  test('separates failed and flaky tests, also in nested suites', () => {
    const lists = listTests(report);
    expect(lists.failed.map((t) => t.title)).toEqual(['broken']);
    expect(lists.flaky.map((t) => [t.line, t.project])).toEqual([[10, 'mobile']]);
  });

  test('an interrupted test is not listed', () => {
    const lists = listTests({ suites: [{ specs: [spec('x', 1, 'p', ['interrupted'])] }] });
    expect(lists.failed).toEqual([]);
  });
});

describe('renderSummary', () => {
  test('is empty without failed or flaky tests', () => {
    expect(renderSummary({ failed: [], flaky: [] })).toBe('');
    expect(renderSummary(listTests({ suites: [] }))).toBe('');
  });

  test('lists file:line, title and project and escapes pipes', () => {
    const text = renderSummary(listTests(report), 'Chromium 1');
    expect(text).toContain('## Chromium 1');
    expect(text).toContain('`tests/a.spec.ts:10` | flaky \\| one | mobile | 2');
    expect(text).toContain('Fehlgeschlagen (1)');
  });
});
