import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { durationLines, runDurations } from '../scripts/ci/browser-durations';
import type { ReportSuite } from '../scripts/ci/browser-durations';
import { parseDurations, parseTestCounts } from '../scripts/ci/browser-matrix';

const result = (status: string, seconds: number) => ({ status, duration: seconds * 1000 });
const spec = (file: string, projectName: string, ...results: ReturnType<typeof result>[]) => ({
  file,
  tests: [{ projectName, results }],
});
const report = (...specs: ReturnType<typeof spec>[]): { suites: ReportSuite[] } => ({
  suites: [{ file: 'x', suites: [{ specs }] }],
});

describe('browser durations from Playwright reports', () => {
  test('sums the last attempt of each test and counts skipped tests without time', () => {
    const run = runDurations([
      report(
        spec('a.spec.ts', 'desktop', result('failed', 30), result('passed', 4)),
        spec('a.spec.ts', 'desktop', result('passed', 2)),
        spec('a.spec.ts', 'desktop', result('skipped', 0))
      ),
      report(spec('a.spec.ts', 'mobile', result('passed', 5))),
    ]);
    assert.deepEqual(Object.fromEntries(run), {
      'desktop\ta.spec.ts': { seconds: 6, tests: 3 },
      'mobile\ta.spec.ts': { seconds: 5, tests: 1 },
    });
  });

  test('averages over the runs that have the file and writes lines the matrix reads', () => {
    const lines = durationLines([
      runDurations([report(spec('b.spec.ts', 'desktop', result('passed', 10)))]),
      runDurations([
        report(
          spec('b.spec.ts', 'desktop', result('passed', 20)),
          spec('a.spec.ts', 'desktop', result('passed', 7))
        ),
      ]),
    ]);
    assert.deepEqual(lines, ['desktop\ta.spec.ts\t7.0\t1', 'desktop\tb.spec.ts\t15.0\t1']);
    const text = lines.join('\n');
    assert.equal(parseDurations(text).get('desktop/b.spec.ts'), 15);
    assert.equal(parseTestCounts(text).get('desktop/a.spec.ts'), 1);
  });
});
