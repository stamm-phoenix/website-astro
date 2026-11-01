import assert from 'node:assert/strict';
import test from 'node:test';
import { aenderungText } from '../src/lib/essensplanung.ts';
import {
  belegDruckZeile,
  belegStatistik,
  belegTitel,
  bezahltVonWahl,
  euro,
  gefilterteBelege,
  personKey,
  statistikDruck,
} from '../src/lib/essensplanungBelege.ts';
import type { PlanungBeleg, PlanungMitglied } from '../src/lib/types.ts';

let naechste = 1;
const beleg = (werte: Partial<PlanungBeleg>): PlanungBeleg => ({
  id: naechste++,
  etag: '"1"',
  datum: '2027-08-01',
  betragCent: 1000,
  haendler: 'Rewe',
  notiz: '',
  bezahltVonId: 1,
  bezahltVonText: '',
  bezahltVon: 'Kim',
  erstattet: false,
  erstattetAm: null,
  erstattetVon: '',
  foto: null,
  original: false,
  angelegtVon: 'Kim',
  angelegtAm: '2027-08-01T10:00:00Z',
  ...werte,
});

const belege = [
  beleg({ betragCent: 4250 }),
  beleg({ betragCent: 8735, erstattet: true }),
  beleg({
    betragCent: 1450,
    bezahltVonId: null,
    bezahltVonText: 'Oma Inge',
    bezahltVon: 'Oma Inge',
  }),
  beleg({
    betragCent: 550,
    bezahltVonId: null,
    bezahltVonText: ' oma  inge ',
    bezahltVon: ' oma  inge ',
  }),
  beleg({ betragCent: 2000, bezahltVonId: 2, bezahltVon: 'Ben', erstattet: true }),
];

test('the statistics count paid back receipts in the totals only', () => {
  const statistik = belegStatistik(belege);
  assert.equal(statistik.anzahl, 5);
  assert.equal(statistik.gesamtCent, 16985);
  assert.equal(statistik.offenCent, 6250);
  assert.equal(statistik.erstattetCent, 10735);
  assert.deepEqual(
    statistik.personen.map((p) => [p.name, p.anzahl, p.gesamtCent, p.offenCent]),
    [
      ['Kim', 2, 12985, 4250],
      ['Oma Inge', 2, 2000, 2000],
      ['Ben', 1, 2000, 0],
    ]
  );
  assert.deepEqual(belegStatistik([]), {
    personen: [],
    anzahl: 0,
    gesamtCent: 0,
    offenCent: 0,
    erstattetCent: 0,
  });
});

test('free names are one person regardless of case and spaces', () => {
  assert.equal(personKey(belege[2]), personKey(belege[3]));
  assert.notEqual(personKey(belege[0]), personKey(belege[2]));
});

test('the filter shows open or paid back receipts', () => {
  assert.equal(gefilterteBelege(belege, 'alle').length, 5);
  assert.equal(gefilterteBelege(belege, 'offen').length, 3);
  assert.ok(gefilterteBelege(belege, 'erstattet').every((b) => b.erstattet));
});

test('the PDF rows read like the page', () => {
  assert.equal(euro(123456).replace(/\s/g, ' '), '1.234,56 €');
  assert.deepEqual(belegDruckZeile(beleg({ haendler: '', notiz: 'Pfand', erstattet: true })), {
    datum: '01.08.2027',
    haendler: '–',
    notiz: 'Pfand',
    bezahltVon: 'Kim',
    betrag: euro(1000),
    status: 'erstattet',
  });
  const zeilen = statistikDruck(belegStatistik(belege.slice(0, 2)));
  assert.deepEqual(zeilen.at(-1), ['Summe', '2', euro(12985), euro(4250)]);
  assert.equal(belegTitel(belege[0]), `01.08.2027 · Rewe · ${euro(4250)} · Kim`);
});

test('a member without access is offered only while they paid', () => {
  const mitglied = (id: number, entzogen: boolean): PlanungMitglied => ({
    id,
    etag: '',
    name: `M${id}`,
    rolle: 'bearbeiten',
    email: null,
    entzogen,
    ich: false,
  });
  const alle = [mitglied(1, false), mitglied(2, true)];
  assert.deepEqual(
    bezahltVonWahl(alle).map((m) => m.id),
    [1]
  );
  assert.deepEqual(
    bezahltVonWahl(alle, 2).map((m) => m.id),
    [1, 2]
  );
});

test('the change log names receipts paid back', () => {
  const text = (details: Record<string, unknown>) =>
    aenderungText({ seq: 1, at: '', wer: 'Kim', aktion: 'beleg-geaendert', details });
  assert.equal(
    text({ name: 'Rewe', erstattet: true, datum: '2027-08-01' }),
    'Kim hat einen Beleg als erstattet markiert: Rewe (So., 1.8.2027)'
  );
  assert.match(text({ name: 'Rewe', erstattet: false }), /aufgehoben/);
  assert.equal(text({ name: 'Rewe' }), 'Kim hat einen Beleg geändert: Rewe');
});
