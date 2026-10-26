import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isErledigt,
  matchesFilter,
  matchesSearch,
  meineBeitraege,
  sammlungStand,
  sammlungZahlen,
  statusLabel,
  summen,
} from '../src/lib/beitraege';
import { formatEuro } from '../src/lib/format';
import type { Beitrag, BeitragSammlung } from '../src/lib/types';

function beitrag(status: Beitrag['status'], dueCent: number, paidCent: number): Beitrag {
  return {
    id: `fee_${status}`,
    reference: 'HU74966',
    description: 'Teilnehmendenbeitrag',
    batchId: 'bat_1',
    costUnit: { id: 'cun_1', name: 'Stammeslager 2026' },
    category: 'Teilnehmerbeiträge',
    payer: 'Kim Beispiel',
    payerId: 'per_Kim',
    paymentMethod: 'bank_transfer',
    date: '2026-03-21',
    amountCent: dueCent || 10000,
    dueCent,
    paidCent,
    openCent: dueCent - paidCent,
    status,
    paidAt: paidCent > 0 ? '2026-03-27' : null,
  };
}

const sammlung = (extra: Partial<BeitragSammlung>): BeitragSammlung => ({
  id: 'bat_1',
  name: 'Stammeslager 2026',
  type: 'event',
  eventId: 'evt_1',
  feeCount: 14,
  settledCount: 11,
  totalCent: 122000,
  openCent: 15000,
  refundCent: 3000,
  ...extra,
});

test('the status says in words what is paid, open or to pay back', () => {
  assert.deepEqual(statusLabel(beitrag('paid', 10000, 10000)), {
    label: 'Bezahlt',
    tone: 'success',
  });
  assert.equal(statusLabel(beitrag('unpaid', 10000, 0)).label, 'Nicht bezahlt');
  assert.equal(
    statusLabel(beitrag('partial', 10000, 4000)).label.replace(/\s/g, ' '),
    'Teilweise bezahlt, 60,00 € offen'
  );
  assert.equal(
    statusLabel(beitrag('refund', 7000, 10000)).label.replace(/\s/g, ' '),
    '30,00 € zu erstatten'
  );
  assert.equal(statusLabel(beitrag('cancelled', 0, 0)).label, 'Storniert');
});

test('„Noch offen“ includes partly paid Beiträge', () => {
  assert.ok(matchesFilter(beitrag('partial', 10000, 4000), 'offen'));
  assert.ok(matchesFilter(beitrag('unpaid', 10000, 0), 'offen'));
  assert.ok(!matchesFilter(beitrag('refund', 7000, 10000), 'offen'));
  assert.ok(matchesFilter(beitrag('refund', 7000, 10000), 'alle'));
});

test('the search finds names, Kostenstellen and Verwendungszweck in any order', () => {
  const fee = beitrag('paid', 10000, 10000);
  assert.ok(matchesSearch(fee, 'beispiel kim'));
  assert.ok(matchesSearch(fee, 'stammeslager'));
  assert.ok(matchesSearch(fee, 'hu74966'));
  assert.ok(!matchesSearch(fee, 'kim müller'));
});

test('sums keep money to pay back apart from what is still open', () => {
  const sums = summen([
    beitrag('paid', 10000, 10000),
    beitrag('unpaid', 5000, 0),
    beitrag('refund', 7000, 10000),
  ]);
  assert.deepEqual(sums, { dueCent: 22000, paidCent: 20000, openCent: 5000, refundCent: 3000 });
});

test('a Sammlung shows how many paid and what is left', () => {
  const zahlen = sammlungZahlen([
    ...Array.from({ length: 10 }, () => beitrag('paid', 10000, 10000)),
    beitrag('refund', 7000, 10000),
    beitrag('unpaid', 10000, 0),
    beitrag('partial', 10000, 4000),
    beitrag('cancelled', 0, 0),
  ]);
  assert.deepEqual(zahlen, { paid: 11, cancelled: 1, due: 13 });
  assert.equal(
    sammlungStand(sammlung({}), zahlen).replace(/\s/g, ' '),
    '11 von 13 bezahlt · 1 storniert · 150,00 € offen · 30,00 € zu erstatten'
  );
  const done = sammlung({ settledCount: 14, openCent: 0, refundCent: 0 });
  assert.equal(
    sammlungStand(done, { paid: 13, cancelled: 1, due: 13 }),
    'Alle bezahlt · 1 storniert'
  );
  assert.ok(isErledigt(done));
  assert.ok(!isErledigt(sammlung({ settledCount: 14, openCent: 0 })));
});

test('cancelled Beiträge never count as paid', () => {
  const onlyCancelled = sammlungZahlen([beitrag('cancelled', 0, 0), beitrag('cancelled', 0, 0)]);
  assert.deepEqual(onlyCancelled, { paid: 0, cancelled: 2, due: 0 });
  const none = sammlung({ feeCount: 2, settledCount: 2, openCent: 0, refundCent: 0 });
  assert.equal(sammlungStand(none, onlyCancelled), 'Alle storniert');
});

test('a Sammlung without Beiträge is not called cancelled', () => {
  const empty = sammlung({
    feeCount: 0,
    settledCount: 0,
    totalCent: 0,
    openCent: 0,
    refundCent: 0,
  });
  assert.equal(sammlungStand(empty, sammlungZahlen([])), 'Noch keine Beiträge');
});

test('„Meine Beiträge“ lists the own ones with something left to do, on either side', () => {
  const fees = [
    beitrag('unpaid', 10000, 0),
    beitrag('partial', 10000, 4000),
    beitrag('refund', 7000, 10000),
    beitrag('paid', 10000, 10000),
    beitrag('cancelled', 0, 0),
    { ...beitrag('unpaid', 5000, 0), id: 'fee_other', payer: 'Kim Anders', batchId: null },
  ];
  const data = { loadedAt: '', batches: [sammlung({})], fees, ich: null };
  // Like `isIch`: the server's answer, else the linked person by ID, else the name
  const isIch = (person: { id?: string; name: string; ich?: boolean }) =>
    person.ich ?? (person.id === 'per_Ich' || person.name === 'Kim Beispiel');
  const own = meineBeitraege(data, isIch);
  assert.deepEqual(
    own.map((fee) => fee.id),
    ['fee_unpaid', 'fee_partial', 'fee_refund']
  );
  assert.equal(own[0].title, 'Stammeslager 2026');
  assert.equal(own[0].href, '/leitendenbereich/beitraege?sammlung=bat_1');
  assert.equal(own[2].label, `${formatEuro(3000)} bekommst du zurück`);
  // The server's answer wins over the name: a namesake is not „ich“, another payer may be.
  // What it could not check (fee_partial) is decided by the payer as before.
  const matched = meineBeitraege(
    { ...data, ich: { fee_unpaid: false, fee_refund: true, fee_other: true } },
    isIch
  );
  assert.deepEqual(
    matched.map((fee) => [fee.id, fee.title, fee.href]),
    [
      ['fee_partial', 'Stammeslager 2026', '/leitendenbereich/beitraege?sammlung=bat_1'],
      ['fee_refund', 'Stammeslager 2026', '/leitendenbereich/beitraege?sammlung=bat_1'],
      ['fee_other', 'Teilnehmendenbeitrag', '/leitendenbereich/beitraege?ansicht=alle'],
    ]
  );
  // The payer's ID finds the linked person even under another name
  const byId = meineBeitraege(
    { ...data, fees: [{ ...fees[0], payer: 'K. B.', payerId: 'per_Ich' }] },
    isIch
  );
  assert.deepEqual(
    byId.map((fee) => fee.id),
    ['fee_unpaid']
  );
  assert.deepEqual(meineBeitraege(null, isIch), []);
});
