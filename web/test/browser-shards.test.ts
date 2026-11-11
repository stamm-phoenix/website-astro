import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  balanceGroups,
  estimateWallSeconds,
  playwrightOrder,
  testSeconds,
  totalSeconds,
} from '../scripts/ci/browser-shards';
import type { TestGroup } from '../scripts/ci/browser-shards';

const group = (project: string, file: string, seconds: number, tests?: number): TestGroup => ({
  project,
  file,
  seconds,
  ...(tests === undefined ? {} : { tests }),
});
const names = (groups: TestGroup[]): string[] => groups.map((g) => `${g.project}/${g.file}`);

describe('order of the tests in a shard', () => {
  test('runs desktop before mobile and the files by name, whatever the list says', () => {
    const groups = [
      group('mobile', 'a.spec.ts', 1),
      group('desktop', 'staff-app.spec.ts', 1),
      group('desktop', 'abrechnung.spec.ts', 1),
      group('desktop', 'abrechnung-usability.spec.ts', 1),
    ];
    assert.deepEqual(names(playwrightOrder(groups)), [
      'desktop/abrechnung-usability.spec.ts',
      'desktop/abrechnung.spec.ts',
      'desktop/staff-app.spec.ts',
      'mobile/a.spec.ts',
    ]);
  });

  test('splits each file evenly into its tests, in that order', () => {
    assert.deepEqual(
      testSeconds([group('desktop', 'b.spec.ts', 9, 3), group('desktop', 'a.spec.ts', 4)]),
      [4, 3, 3, 3]
    );
  });
});

describe('estimated wall time of a shard', () => {
  // Shard 2/12 of run 42947457925: staff-app.spec.ts (one worker, sorting last) ended the shard
  const late = (tests?: number): TestGroup[] => [
    group('desktop', 'a.spec.ts', 50),
    group('desktop', 'b.spec.ts', 50),
    group('desktop', 'c.spec.ts', 50),
    group('desktop', 'd.spec.ts', 50),
    group('desktop', 'z.spec.ts', 200, tests),
  ];

  test('the tests of a long file that sorts last spread over all workers', () => {
    assert.equal(estimateWallSeconds(late(40), 4), 100);
    // A file of one test cannot spread
    assert.equal(estimateWallSeconds(late(), 4), 250);
    assert.equal(estimateWallSeconds(late(40), 5), 80);
    assert.equal(estimateWallSeconds([], 4), 0);
  });

  test('rejects invalid worker counts', () => {
    for (const workers of [0, -1, 1.5, NaN])
      assert.throws(() => estimateWallSeconds(late(), workers));
  });
});

describe('balancing project/files across shards', () => {
  const groups = [
    group('desktop', 'a.spec.ts', 100, 10),
    group('desktop', 'b.spec.ts', 90, 9),
    group('desktop', 'c.spec.ts', 80, 8),
    group('desktop', 'd.spec.ts', 70, 7),
    group('mobile', 'a.spec.ts', 10, 1),
    group('desktop', 'e.spec.ts', 10, 1),
  ];

  test('places the longest files first onto the shard with the least work', () => {
    const shards = balanceGroups(groups, 2, 4);
    assert.deepEqual(shards.map(totalSeconds), [180, 180]);
    assert.deepEqual(names(shards[0]), [
      'desktop/a.spec.ts',
      'desktop/d.spec.ts',
      'desktop/e.spec.ts',
    ]);
  });

  test('keeps every project/file exactly once', () => {
    const shards = balanceGroups(groups, 4, 4);
    assert.deepEqual(names(shards.flat()).sort(), names(groups).sort());
    assert.equal(totalSeconds(shards.flat()), totalSeconds(groups));
  });

  test('rejects invalid shard counts', () => {
    for (const count of [0, -1, 1.5]) assert.throws(() => balanceGroups(groups, count, 4));
  });
});
