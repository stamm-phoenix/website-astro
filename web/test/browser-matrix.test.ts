import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  MAX_SHARDS,
  TARGET_SECONDS,
  browserMatrix,
  fallbackSeconds,
  parseDurations,
  withDurations,
} from '../scripts/ci/browser-matrix';
import { estimateWallSeconds } from '../scripts/ci/browser-shards';
import type { TestGroup } from '../scripts/ci/browser-shards';

const durationsFile = readFileSync(
  new URL('../scripts/ci/browser-durations.tsv', import.meta.url),
  'utf8'
);
const group = (project: string, file: string, seconds: number): TestGroup => ({
  project,
  file,
  seconds,
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
    const groups = Array.from({ length: 40 }, (_, i) => group('desktop', `${i}.spec.ts`, 50));
    const { include } = browserMatrix(groups);
    // Four workers run three files of 50 s one after the other within 150 s: 12 files a shard
    assert.equal(include.length, 4);
    assert.deepEqual(
      include.map((job) => job.name),
      ['1/4', '2/4', '3/4', '4/4']
    );
    assert.equal(new Set(include.map((job) => job.group)).size, 4);
    const listed = include.flatMap((job) => lines(job.tests)).sort();
    assert.deepEqual(listed, groups.map((g) => `[desktop] > ${g.file}`).sort());
    assert.ok(include.every((job) => job.wall <= TARGET_SECONDS));
  });

  test('the full suite stays within the target or its longest file, with at most twelve shards', () => {
    const durations = parseDurations(durationsFile);
    const all = [...durations.keys()].map((key) => {
      const [project, file] = key.split('/');
      return { project, file };
    });
    const { include } = browserMatrix(withDurations(all, durations));
    const chromium = include.filter((job) => job.browser === 'chromium');
    assert.ok(chromium.length > 1 && chromium.length <= MAX_SHARDS);
    assert.equal(include.filter((job) => job.browser === 'webkit').length, 1);
    assert.equal(include.flatMap((job) => lines(job.tests)).length, all.length);
    const longestFile = Math.max(...durations.values());
    for (const job of chromium) {
      const shard = withDurations(groupsOf(job.tests), durations);
      const limit = Math.max(TARGET_SECONDS, ...shard.map((g) => g.seconds));
      assert.ok(estimateWallSeconds(shard, 4) <= limit, `${job.name} takes ${job.wall} s`);
    }
    assert.equal(Math.max(...chromium.map((job) => job.wall)), Math.round(longestFile));
  });

  test('long files run side by side on the workers of one shard', () => {
    const { include } = browserMatrix(
      Array.from({ length: 6 }, (_, i) => group('desktop', `${i}.spec.ts`, 200))
    );
    assert.deepEqual(
      include.map((job) => [job.name, lines(job.tests).length, job.wall]),
      [
        ['1/2', 4, 200],
        ['2/2', 2, 200],
      ]
    );
  });

  test('never starts more than twelve shards', () => {
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
  });
});
