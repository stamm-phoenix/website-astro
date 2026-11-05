import { describe, expect, test } from 'bun:test';
import { balanceGroups } from '../scripts/ci/browser-shards';

describe('duration-balanced browser shards', () => {
  const groups = [100, 80, 40, 30, 20, 10].map((seconds, i) => ({
    project: i % 2 ? 'mobile' : 'desktop',
    file: `${i}.spec.ts`,
    seconds,
  }));
  test('assigns every project/file once and balances unequal file lengths', () => {
    const shards = balanceGroups(groups, 2);
    expect(shards.flat().sort((a, b) => a.file.localeCompare(b.file))).toEqual(groups);
    expect(shards.map((s) => s.reduce((n, g) => n + g.seconds, 0))).toEqual([140, 140]);
    expect(groups.map((g) => g.seconds)).toEqual([100, 80, 40, 30, 20, 10]);
  });
  test('is deterministic even when discovery order changes', () => {
    expect(balanceGroups([...groups].reverse(), 4)).toEqual(balanceGroups(groups, 4));
  });
  test('rejects invalid counts', () => {
    for (const count of [0, -1, 1.5, NaN]) expect(() => balanceGroups([], count)).toThrow();
  });
});
