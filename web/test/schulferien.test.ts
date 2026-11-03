import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { berlinDate, currentSchulferien, requireCurrentSchulferien } from '../src/lib/schulferien';

describe('Bayerische Schulferien', () => {
  const cases: [string, string | null][] = [
    ['2026-11-01', null],
    ['2026-11-02', 'Herbstferien'],
    ['2026-11-06', 'Herbstferien'],
    ['2026-11-07', null],
    ['2026-12-24', 'Weihnachtsferien'],
    ['2026-12-31', 'Weihnachtsferien'],
    ['2027-01-01', 'Weihnachtsferien'],
    ['2027-01-08', 'Weihnachtsferien'],
    ['2027-01-09', null],
    ['2027-02-08', 'Frühjahrsferien'],
    ['2027-03-22', 'Osterferien'],
    ['2027-05-28', 'Pfingstferien'],
    ['2027-09-13', 'Sommerferien'],
    ['2028-02-29', 'Frühjahrsferien'],
    ['2030-09-09', 'Sommerferien'],
  ];
  for (const [date, name] of cases) {
    test(`${date}: ${name} (inclusive boundaries)`, () => {
      const result = currentSchulferien(date);
      assert.equal(result === null ? null : result?.name, name);
    });
  }

  test('unknown dates are distinct from a school day', () => {
    assert.equal(currentSchulferien('2030-09-10'), undefined);
    assert.equal(currentSchulferien('2024-01-01'), undefined);
  });

  test('Berlin day changes at midnight, independent of device timezone and DST', () => {
    assert.equal(berlinDate(new Date('2026-11-01T22:59:59Z')), '2026-11-01');
    assert.equal(berlinDate(new Date('2026-11-01T23:00:00Z')), '2026-11-02');
    assert.equal(berlinDate(new Date('2027-08-01T22:00:00Z')), '2027-08-02');
  });

  test('build requires renewed data three months before coverage expires', () => {
    assert.doesNotThrow(() => requireCurrentSchulferien(new Date('2026-11-03T12:00:00Z')));
    assert.throws(() => requireCurrentSchulferien(new Date('2030-07-01T12:00:00Z')));
  });
});
