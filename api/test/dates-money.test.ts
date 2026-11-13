import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  berlinDay,
  formatDateMedium,
  formatDateTimeLong,
  formatDateTimeMedium,
} from '../lib/dates';
import { formatEuro } from '../lib/money';

test('berlinDay uses the Berlin calendar day', () => {
  assert.equal(berlinDay(new Date('2026-09-30T22:30:00Z')), '2026-10-01');
  assert.equal(berlinDay(new Date('2026-12-31T22:59:00Z')), '2026-12-31');
});

test('addDays crosses month, year and leap day boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-10-25', 0), '2026-10-25');
});

test('date formats are written in Berlin time', () => {
  const at = new Date('2026-10-14T13:30:00Z');
  assert.equal(formatDateTimeMedium(at), '14.10.2026, 15:30');
  assert.match(formatDateTimeLong(at), /^14\. Oktober 2026.*15:30$/);
  assert.equal(formatDateMedium(new Date('2026-10-14T22:30:00Z')), '15.10.2026');
});

test('formatEuro writes cents as German euros', () => {
  assert.equal(formatEuro(1250).replace(/\s/g, ' '), '12,50 €');
  assert.equal(formatEuro(0).replace(/\s/g, ' '), '0,00 €');
});
