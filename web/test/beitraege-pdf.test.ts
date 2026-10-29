import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { beitraegeListePdf, sammlungenPdf } from '../src/lib/beitraegePdf';
import type { Beitrag, BeitragSammlung } from '../src/lib/types';

/** The report with plain spaces, as Intl puts a no-break space before the €. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll('\u00a0', ' ')) as T;
}

const LOADED = '2026-10-29T09:30:00Z';

function fee(id: string, extra: Partial<Beitrag> = {}): Beitrag {
  return {
    id,
    reference: `BEI-${id}`,
    description: 'Sommerlager',
    batchId: 's1',
    costUnit: { id: 'k1', name: 'Lager' },
    category: null,
    payer: `Person ${id}`,
    payerId: null,
    paymentMethod: null,
    date: '2026-05-01',
    amountCent: 10000,
    dueCent: 10000,
    paidCent: 0,
    openCent: 10000,
    status: 'unpaid',
    paidAt: null,
    ...extra,
  };
}

const fees = [
  fee('1', { paidCent: 10000, openCent: 0, status: 'paid', paidAt: '2026-05-10' }),
  fee('2', { paidCent: 4000, openCent: 6000, status: 'partial', paidAt: '2026-05-11' }),
  fee('3', { paidCent: 12000, openCent: -2000, status: 'refund', paidAt: '2026-05-12' }),
  fee('4', { dueCent: 0, openCent: 0, status: 'cancelled', batchId: 's2' }),
];

describe('beitraegeListePdf', () => {
  test('lists each Beitrag with its amounts and sums them in the foot', () => {
    const report = plain(
      beitraegeListePdf({
        title: 'Sommerlager',
        fees,
        filter: 'alle',
        kostenstelle: '',
        search: '',
        loadedAt: LOADED,
      })
    );
    assert.equal(report.title, 'Beiträge – Sommerlager');
    assert.equal(report.landscape, true);
    assert.deepEqual(report.notes, []);
    const table = report.sections[0];
    assert.deepEqual(table.rows?.[1], [
      'Person 2',
      'Lager · Sommerlager\nVerwendungszweck BEI-2',
      '11.05.2026',
      '100,00 €',
      '40,00 €',
      '60,00 €',
      '',
      'Teilweise bezahlt',
    ]);
    assert.deepEqual(table.rows?.[2].slice(5), ['', '20,00 €', 'Zu viel bezahlt']);
    assert.equal(table.rows?.[3][7], 'Storniert (100,00 €)');
    assert.deepEqual(table.foot, [
      ['Summe', '4 Beiträge', '', '300,00 €', '260,00 €', '60,00 €', '20,00 €', ''],
    ]);
    assert.equal(report.fileName, 'Beiträge Sommerlager.pdf');
  });

  test('names the filters', () => {
    const report = plain(
      beitraegeListePdf({
        title: 'Alle Beiträge',
        fees: [fees[1]],
        filter: 'offen',
        kostenstelle: 'Lager',
        search: ' Person ',
        loadedAt: LOADED,
      })
    );
    assert.equal(report.title, 'Alle Beiträge');
    assert.deepEqual(report.notes, [
      'Zahlungsstand: Noch offen · Kostenstelle: Lager · Suche: „Person“',
    ]);
    assert.match(report.subtitle, /^1 Beitrag · Stand aus CampFlow: /);
    assert.equal(report.fileName, 'Beiträge.pdf');
  });
});

function batch(id: string, extra: Partial<BeitragSammlung> = {}): BeitragSammlung {
  return {
    id,
    name: `Sammlung ${id}`,
    type: 'event',
    eventId: null,
    feeCount: 0,
    settledCount: 0,
    totalCent: 0,
    openCent: 0,
    refundCent: 0,
    ...extra,
  };
}

describe('sammlungenPdf', () => {
  test('shows how far each Sammlung is paid and the totals', () => {
    const report = plain(
      sammlungenPdf({
        batches: [
          batch('s1', { feeCount: 3, totalCent: 30000, openCent: 6000, refundCent: 2000 }),
          batch('s2', { feeCount: 1 }),
        ],
        fees,
        search: '',
        hideDone: true,
        loadedAt: LOADED,
      })
    );
    const table = report.sections[0];
    assert.deepEqual(table.rows, [
      ['Sammlung s1', '3', '', '2 von 3 (66 %)', '300,00 €', '60,00 €', '20,00 €', ''],
      ['Sammlung s2', '1', '1', '–', '0,00 €', '', '', 'Erledigt'],
    ]);
    assert.deepEqual(table.foot, [
      ['Summe', '4', '1', '2 von 3 (66 %)', '300,00 €', '60,00 €', '20,00 €', ''],
    ]);
    assert.deepEqual(report.notes, ['Ohne erledigte Sammlungen']);
    assert.match(report.subtitle, /^2 Sammlungen · /);
  });
});
