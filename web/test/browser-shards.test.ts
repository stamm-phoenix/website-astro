import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  balanceGroups,
  estimateWallSeconds,
  playwrightOrder,
  shardLimit,
} from '../scripts/ci/browser-shards';
import type { TestGroup } from '../scripts/ci/browser-shards';

const group = (project: string, file: string, seconds: number): TestGroup => ({
  project,
  file,
  seconds,
});
const names = (groups: TestGroup[]): string[] => groups.map((g) => `${g.project}/${g.file}`);
const work = (groups: TestGroup[]): number => groups.reduce((n, g) => n + g.seconds, 0);

describe('order of the files in a shard', () => {
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
});

describe('estimated wall time of a shard', () => {
  // Shard 2/12 of run 42947457925: staff-app.spec.ts started after 54 s on a busy worker
  const late = [
    group('desktop', 'a.spec.ts', 50),
    group('desktop', 'b.spec.ts', 50),
    group('desktop', 'c.spec.ts', 50),
    group('desktop', 'd.spec.ts', 50),
    group('desktop', 'z.spec.ts', 200),
  ];

  test('a long file that sorts last starts when a worker is free', () => {
    assert.equal(estimateWallSeconds(late, 4), 250);
    assert.equal(estimateWallSeconds(late, 5), 200);
    assert.equal(estimateWallSeconds([], 4), 0);
  });

  test('rejects invalid worker counts', () => {
    for (const workers of [0, -1, 1.5, NaN])
      assert.throws(() => estimateWallSeconds(late, workers));
  });

  test('a shard may take the target or its longest file', () => {
    assert.equal(shardLimit(late, 150), 200);
    assert.equal(shardLimit([group('desktop', 'a.spec.ts', 20)], 150), 150);
  });
});

describe('balanced browser shards', () => {
  const groups = [
    group('desktop', 'a.spec.ts', 50),
    group('desktop', 'b.spec.ts', 50),
    group('desktop', 'c.spec.ts', 50),
    group('desktop', 'd.spec.ts', 50),
    group('desktop', 'z.spec.ts', 200),
    group('mobile', 'a.spec.ts', 120),
    group('mobile', 'b.spec.ts', 90),
    group('mobile', 'c.spec.ts', 30),
  ];

  test('assigns every project/file once', () => {
    const shards = balanceGroups(groups, 3, 4, 150);
    assert.deepEqual(names(shards.flat()).sort(), names(groups).sort());
  });

  test('keeps a long file from waiting behind others', () => {
    const shards = balanceGroups(groups, 2, 4, 150);
    const walls = shards.map((shard) => estimateWallSeconds(shard, 4));
    assert.equal(Math.max(...walls), 200);
    assert.ok(shards.every((shard) => estimateWallSeconds(shard, 4) <= shardLimit(shard, 150)));
  });

  test('fills the idle workers next to a long file before using another shard', () => {
    const shards = balanceGroups(
      [
        group('desktop', 'a.spec.ts', 50),
        group('desktop', 'b.spec.ts', 50),
        group('desktop', 'c.spec.ts', 50),
        group('desktop', 'long.spec.ts', 200),
      ],
      2,
      4,
      150
    );
    assert.deepEqual(
      shards.map((shard) => shard.length),
      [4, 0]
    );
  });

  test('goes where the wall time stays lowest when nothing fits', () => {
    const big = Array.from({ length: 8 }, (_, i) => group('desktop', `${i}.spec.ts`, 100));
    const shards = balanceGroups(big, 1, 2, 150);
    assert.equal(work(shards[0]), 800);
    assert.equal(estimateWallSeconds(shards[0], 2), 400);
  });

  test('is deterministic even when discovery order changes', () => {
    assert.deepEqual(
      balanceGroups([...groups].reverse(), 3, 4, 150),
      balanceGroups(groups, 3, 4, 150)
    );
  });

  test('rejects invalid counts', () => {
    for (const count of [0, -1, 1.5, NaN]) assert.throws(() => balanceGroups([], count, 4, 150));
  });
});
