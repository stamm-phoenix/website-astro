import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  MAX_SHARDS,
  TARGET_SECONDS,
  browserMatrix,
  fallbackSeconds,
  parseDurations,
  parseTestCounts,
  withDurations,
} from '../scripts/ci/browser-matrix';
import { estimateWallSeconds } from '../scripts/ci/browser-shards';
import type { TestGroup } from '../scripts/ci/browser-shards';

const durationsFile = readFileSync(
  new URL('../scripts/ci/browser-durations.tsv', import.meta.url),
  'utf8'
);
const group = (project: string, file: string, seconds: number, tests?: number): TestGroup => ({
  project,
  file,
  seconds,
  ...(tests === undefined ? {} : { tests }),
});
const lines = (tests: string): string[] => tests.split('\n');
const groupsOf = (tests: string): TestGroup[] =>
  lines(tests).map((line) => {
    const [, project, file] = /^\[(.+)\] > (.+)$/.exec(line) ?? [];
    return group(project, file, 0);
  });

describe('browser test matrix', () => {
  test('one spec in two projects starts one Chromium job and no WebKit job', () => {
    const { include } = browserMatrix([
      group('desktop', 'belege.spec.ts', 60),
      group('mobile', 'belege.spec.ts', 40),
    ]);
    assert.equal(include.length, 1);
    assert.equal(include[0].browser, 'chromium');
    assert.equal(include[0].name, '1/1');
    assert.deepEqual(lines(include[0].tests), [
      '[desktop] > belege.spec.ts',
      '[mobile] > belege.spec.ts',
    ]);
  });

  test('an empty selection starts no job', () => {
    assert.deepEqual(browserMatrix([]), { include: [] });
  });

  test('WebKit runs only when one of its specs is selected', () => {
    const { include } = browserMatrix([group('webkit-tablet', 'theme.spec.ts', 20)]);
    assert.deepEqual(
      include.map((job) => [job.name, job.browser, job.workers, job.args, job.tests]),
      [
        [
          'WebKit',
          'webkit',
          1,
          '--project=webkit-tablet --test-list=test-results/shard.txt',
          '[webkit-tablet] > theme.spec.ts',
        ],
      ]
    );
  });

  test('a large selection gets as few shards as stay within the target, each file once', () => {
    const groups = Array.from({ length: 40 }, (_, i) => group('desktop', `${i}.spec.ts`, 50, 10));
    const { include } = browserMatrix(groups);
    // Four workers share the tests of six files (300 s) within 85 s, of seven not
    assert.equal(include.length, 7);
    assert.deepEqual(
      include.map((job) => job.name),
      ['1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']
    );
    assert.equal(new Set(include.map((job) => job.group)).size, 7);
    const listed = include.flatMap((job) => lines(job.tests)).sort();
    assert.deepEqual(listed, groups.map((g) => `[desktop] > ${g.file}`).sort());
    assert.ok(include.every((job) => job.wall <= TARGET_SECONDS));
  });

  test('the full suite stays within the target, with fewer than the most shards', () => {
    const durations = parseDurations(durationsFile);
    const counts = parseTestCounts(durationsFile);
    assert.equal(counts.size, durations.size);
    const all = [...durations.keys()].map((key) => {
      const [project, file] = key.split('/');
      return { project, file };
    });
    const { include } = browserMatrix(withDurations(all, durations, counts));
    const chromium = include.filter((job) => job.browser === 'chromium');
    assert.ok(chromium.length > 1 && chromium.length < MAX_SHARDS);
    assert.equal(include.filter((job) => job.browser === 'webkit').length, 1);
    assert.equal(include.flatMap((job) => lines(job.tests)).length, all.length);
    for (const job of chromium) {
      const shard = withDurations(groupsOf(job.tests), durations, counts);
      assert.ok(estimateWallSeconds(shard, 4) <= TARGET_SECONDS, `${job.name} takes ${job.wall} s`);
    }
  });

  test('each file longer than the target gets a shard of its own', () => {
    const { include } = browserMatrix(
      Array.from({ length: 6 }, (_, i) => group('desktop', `${i}.spec.ts`, 200))
    );
    assert.equal(include.length, 6);
    assert.ok(include.every((job) => lines(job.tests).length === 1 && job.wall === 200));
  });

  test('never starts more than the most shards', () => {
    const groups = Array.from({ length: 100 }, (_, i) => group('desktop', `${i}.spec.ts`, 200));
    const { include } = browserMatrix(groups);
    assert.equal(include.length, MAX_SHARDS);
    assert.equal(include.flatMap((job) => lines(job.tests)).length, 100);
  });

  test('a spec without a known duration uses the median', () => {
    const durations = parseDurations(
      'desktop\ta.spec.ts\t10\ndesktop\tb.spec.ts\t30\nmobile\ta.spec.ts\t90\n'
    );
    assert.equal(fallbackSeconds(durations), 30);
    assert.deepEqual(
      withDurations(
        [
          { project: 'desktop', file: 'a.spec.ts' },
          { project: 'desktop', file: 'new.spec.ts' },
        ],
        durations
      ),
      [group('desktop', 'a.spec.ts', 10), group('desktop', 'new.spec.ts', 30)]
    );
    assert.equal(fallbackSeconds(new Map()), 30);
    // Counted tests of the run come before the measured ones
    assert.deepEqual(
      withDurations(
        [
          { project: 'desktop', file: 'a.spec.ts', tests: 4 },
          { project: 'desktop', file: 'b.spec.ts' },
        ],
        durations,
        parseTestCounts('desktop\ta.spec.ts\t10\t2\ndesktop\tb.spec.ts\t30\t3\n')
      ).map((g) => g.tests),
      [4, 3]
    );
  });
});
