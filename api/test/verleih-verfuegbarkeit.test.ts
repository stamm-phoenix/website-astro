import test from 'node:test';
import assert from 'node:assert/strict';
import { reservierterBestand } from '../lib/verleih-model';

test('consecutive reservations are not added together, inclusive overlap is', () => {
  const first = { von: '2026-12-01', bis: '2026-12-03', menge: 2 };
  assert.equal(
    reservierterBestand(
      [first, { von: '2026-12-04', bis: '2026-12-06', menge: 3 }],
      '2026-12-01',
      '2026-12-06'
    ),
    3
  );
  assert.equal(
    reservierterBestand(
      [first, { von: '2026-12-03', bis: '2026-12-06', menge: 3 }],
      '2026-12-01',
      '2026-12-06'
    ),
    5
  );
});
test('overdue material blocks later dates until returned; disjoint reservations do not', () => {
  const old = { von: '2026-11-01', bis: '2026-11-03', menge: 2 };
  assert.equal(reservierterBestand([old], '2026-12-01', '2026-12-03'), 0);
  assert.equal(
    reservierterBestand([{ ...old, ueberfaellig: true }], '2026-12-01', '2026-12-03'),
    2
  );
});

test('clearing a date in the form does not crash the availability view', () => {
  assert.equal(
    reservierterBestand([{ von: '2026-12-01', bis: '2026-12-03', menge: 1 }], '', ''),
    0
  );
});

test('the last supported calendar year still reserves material', () => {
  assert.equal(
    reservierterBestand(
      [{ von: '9999-12-01', bis: '9999-12-31', menge: 2 }],
      '9999-12-01',
      '9999-12-31'
    ),
    2
  );
});
