import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  MAX_SHARDS,
  browserMatrix,
  fallbackSeconds,
  parseDurations,
  shardCount,
  withDurations,
} from '../scripts/ci/browser-matrix';
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

  test('a large selection gets shards of about the target size, each file once', () => {
    const groups = Array.from({ length: 40 }, (_, i) => group('desktop', `${i}.spec.ts`, 50));
    const { include } = browserMatrix(groups);
    // 2000 summed seconds need six shards of at most 360
    assert.equal(include.length, 6);
    assert.deepEqual(
      include.map((job) => job.name),
      ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']
    );
    assert.equal(new Set(include.map((job) => job.group)).size, 6);
    const listed = include.flatMap((job) => lines(job.tests)).sort();
    assert.deepEqual(listed, groups.map((g) => `[desktop] > ${g.file}`).sort());
    assert.ok(include.every((job) => job.seconds <= 400));
  });

  test('the full suite gets twelve Chromium shards and WebKit', () => {
    const durations = parseDurations(durationsFile);
    const all = [...durations.keys()].map((key) => {
      const [project, file] = key.split('/');
      return { project, file };
    });
    const { include } = browserMatrix(withDurations(all, durations));
    assert.equal(include.filter((job) => job.browser === 'chromium').length, MAX_SHARDS);
    assert.equal(include.filter((job) => job.browser === 'webkit').length, 1);
    assert.equal(include.flatMap((job) => lines(job.tests)).length, all.length);
  });

  test('never starts more shards than files', () => {
    const { include } = browserMatrix([
      group('desktop', 'a.spec.ts', 300),
      group('desktop', 'b.spec.ts', 300),
    ]);
    assert.equal(include.length, 2);
    assert.deepEqual(
      include.map((job) => job.name),
      ['1/2', '2/2']
    );
  });

  test('shard count stays between one and twelve', () => {
    assert.equal(shardCount(0), 1);
    assert.equal(shardCount(360), 1);
    assert.equal(shardCount(361), 2);
    assert.equal(shardCount(100_000), MAX_SHARDS);
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
