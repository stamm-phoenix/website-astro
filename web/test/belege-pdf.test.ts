import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { belegFilterText, belegePdfReport } from '../src/lib/belegePdf';
import type { BelegEintrag, BelegFilter } from '../src/lib/belegEintraege';

const OHNE_FILTER: BelegFilter = {
  quelle: '',
  stand: '',
  costUnitId: '',
  categoryId: '',
  search: '',
  onlyMine: false,
};

function eintrag(key: string, extra: Partial<BelegEintrag> = {}): BelegEintrag {
  return {
    key,
    quelle: 'website',
    stand: 'eingereicht',
    title: `Laden ${key}`,
    date: '2026-10-03',
    amountCent: 1250,
    income: false,
    hasAmount: true,
    label: 'Eingereicht',
    tone: 'neutral',
    paidBy: 'Eva',
    where: 'Sommerlager · Verpflegung',
    costUnitIds: [],
    categoryIds: [],
    previewUrl: null,
    own: false,
    settledAt: null,
    tags: [],
    hinweis: null,
    ...extra,
  };
}

describe('belegePdfReport', () => {
  test('one row per receipt and the sums of Ausgaben and Einnahmen', () => {
    const report = belegePdfReport(
      [
        eintrag('1'),
        eintrag('2', { amountCent: 750, paidBy: null, label: 'Bezahlt am 05.10.2026' }),
        eintrag('3', { income: true, amountCent: 5000 }),
        eintrag('4', { hasAmount: false, amountCent: 0, date: '' }),
      ],
      OHNE_FILTER
    );
    assert.equal(report.title, 'Belege');
    assert.equal(report.subtitle, '4 Belege, davon 1 ohne Betrag');
    assert.deepEqual(report.notes, []);
    const [table] = report.sections;
    assert.deepEqual(table.rows?.[0], [
      '03.10.2026',
      'Laden 1',
      'Eva',
      'Sommerlager · Verpflegung',
      '12,50\u00a0€',
      'Eingereicht',
    ]);
    assert.equal(table.rows?.[1][2], '');
    assert.equal(table.rows?.[2][4], '+ 50,00\u00a0€');
    assert.deepEqual(table.rows?.[3].slice(0, 1), ['']);
    assert.equal(table.rows?.[3][4], '–');
    assert.deepEqual(table.foot, [
      ['', 'Ausgaben · 2 Belege', '', '', '20,00\u00a0€', ''],
      ['', 'Einnahmen · 1 Beleg', '', '', '+ 50,00\u00a0€', ''],
    ]);
    assert.match(report.fileName, /^Belege \d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test('names the filters and the CampFlow number', () => {
    const filter: BelegFilter = {
      quelle: 'campflow',
      stand: 'bezahlt',
      costUnitId: 'k1',
      categoryId: 'c1',
      search: ' Edeka ',
      onlyMine: true,
    };
    assert.equal(
      belegFilterText(filter, { kostenstelle: 'Sommerlager', kategorie: 'Verpflegung' }),
      'Quelle: CampFlow · Stand: Bezahlt · Kostenstelle: Sommerlager · Kategorie: Verpflegung · Suche: „Edeka“ · Nur meine Belege'
    );
    const report = belegePdfReport(
      [eintrag('5', { campflow: { number: '2026-101' } as BelegEintrag['campflow'] })],
      filter,
      { kostenstelle: 'Sommerlager', kategorie: 'Verpflegung' }
    );
    assert.equal(report.notes?.[0]?.startsWith('Filter: Quelle: CampFlow'), true);
    assert.equal(report.sections[0].rows?.[0][1], 'Laden 5\nBeleg 2026-101');
    assert.match(report.fileName, /^Belege Auswahl /);
    // Without Einnahmen only the Ausgaben are summed up
    assert.equal(report.sections[0].foot?.length, 1);
  });
});
