import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beitragColumns,
  beitragText,
  beitragZahlen,
  beitraegeOf,
  kenntAlle,
} from '../src/lib/aktionBeitraege';
import type { AktionBeitrag, AktionBeitraegeData, CampflowPerson } from '../src/lib/types';

function fee(status: AktionBeitrag['status'], dueCent: number, paidCent: number): AktionBeitrag {
  return {
    id: `fee_${status}`,
    reference: `RF${status.length}`,
    description: 'Teilnehmendenbeitrag',
    amountCent: dueCent || 9000,
    dueCent,
    paidCent,
    openCent: dueCent - paidCent,
    status,
  };
}

const person = (id: string): CampflowPerson => ({ id });

const DATA: AktionBeitraegeData = {
  eventId: 'evt_1',
  loadedAt: '2026-10-19T12:00:00.000Z',
  persons: {
    per_paid: [fee('paid', 9000, 9000)],
    per_open: [fee('unpaid', 9000, 0)],
    per_part: [fee('partial', 9000, 4000)],
    per_refund: [fee('refund', 9000, 10000)],
    per_storno: [fee('cancelled', 0, 0)],
    per_none: [],
  },
};

test('a person shows the amount and the payment status of each Beitrag', () => {
  assert.equal(beitragText(DATA.persons.per_paid), '90,00 € · Bezahlt');
  assert.equal(beitragText(DATA.persons.per_part), '90,00 € · Teilweise bezahlt, 50,00 € offen');
  // A cancelled Beitrag names the amount that was cancelled, not 0 €
  assert.equal(beitragText(DATA.persons.per_storno), '90,00 € · Storniert');
  assert.equal(beitragText([]), 'Kein Beitrag');
  assert.equal(beitragText(undefined), '');
});

test('people CampFlow did not know yet have no Beiträge, not „Kein Beitrag“', () => {
  assert.equal(beitraegeOf(DATA, person('per_neu')), undefined);
  assert.equal(beitraegeOf(null, person('per_paid')), undefined);
  assert.equal(beitraegeOf(DATA, person('toString')), undefined);
  assert.equal(kenntAlle(DATA, [person('per_paid'), person('per_none')]), true);
  assert.equal(kenntAlle(DATA, [person('per_paid'), person('per_neu')]), false);
});

test('sorting by Beitrag puts open ones first and unknown people last', () => {
  const [beitrag, verwendungszweck] = beitragColumns(DATA);
  const order = [
    'per_neu',
    'per_none',
    'per_storno',
    'per_paid',
    'per_refund',
    'per_part',
    'per_open',
  ]
    .map(person)
    .sort((a, b) => Number(beitrag.sortValue(a)) - Number(beitrag.sortValue(b)))
    .map((p) => p.id);
  assert.deepEqual(order, [
    'per_open',
    'per_part',
    'per_refund',
    'per_paid',
    'per_storno',
    'per_none',
    'per_neu',
  ]);
  assert.equal(verwendungszweck.text(person('per_open')), 'RF6');
  assert.equal(verwendungszweck.text(person('per_neu')), '');
});

test('the overview counts people with open Beiträge and the open sum', () => {
  assert.deepEqual(beitragZahlen(DATA, Object.keys(DATA.persons).map(person)), {
    offen: 2,
    offenCent: 14000,
    erstatten: 1,
  });
});
