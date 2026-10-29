import assert from 'node:assert/strict';
import test from 'node:test';
import type { Einkauf, EinkaufHaken } from '../../api/lib/essen-einkaeufe-model.ts';
import {
  einkaufListen,
  einkaufsReihenfolge,
  type EinkaufsStand,
} from '../src/lib/essensplanungEinkaeufe.ts';
import { einkaufsliste } from '../src/lib/essensplanungEinkauf.ts';
import { lager, lagerZeilen } from '../src/lib/essensplanungLager.ts';
import type { PlanungZutat } from '../src/lib/types.ts';

const zutat = (
  id: number,
  name: string,
  einheitenart: PlanungZutat['einheitenart'],
  geschaeftId: number | null = null
): PlanungZutat => ({
  id,
  etag: '',
  zutatId: null,
  name,
  kategorieId: 1,
  einheitenart,
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [],
  abweichend: { kategorie: false, einheitenart: false },
  zeilen: 1,
  geschaeftId,
});

const zeile = (
  id: number,
  planungZutatId: number,
  menge: number | null,
  einheit: 'g' | 'stueck' = 'g'
) => ({
  id,
  planungZutatId,
  menge,
  einheit: menge === null ? null : einheit,
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [],
  nur: [],
});

let naechste = 1;
function einkauf(werte: Partial<Einkauf> = {}): Einkauf {
  const id = werte.id ?? 50 + naechste++;
  return {
    id,
    etag: '',
    position: id,
    name: `Einkauf ${id}`,
    datum: null,
    geschaeftId: null,
    bisMahlzeitId: null,
    abgeschlossen: false,
    posten: [],
    regeln: [],
    ...werte,
  };
}

function haken(
  planungZutatId: number,
  erhalten: number,
  einheit: EinkaufHaken['einheit'],
  ersatz = ''
) {
  return {
    id: 900 + planungZutatId,
    etag: '"1"',
    planungZutatId,
    einheit,
    erhalten,
    ersatz,
    von: 'Kim',
    am: '',
  };
}

/**
 * Three meals of pasta for 4 (400 g each, Metro) with pepper by eye; the trips are what a test
 * adds.
 */
function stand(einkaeufe: Einkauf[]): EinkaufsStand {
  return {
    tage: [
      {
        mahlzeiten: [1, 2, 3].map((id) => ({
          id,
          ohneGruppen: [],
          einplanungen: [{ id: 10 + id, gerichtId: 100, faktor: 1, status: 'offen' as const }],
        })),
      },
    ],
    gruppen: [{ id: 1, faktor: 1 }],
    teilnehmende: [
      {
        gruppeId: 1,
        ernaehrung: 'alles' as const,
        anzahl: 4,
        unvertraeglichkeiten: [],
        vonMahlzeitId: null,
        bisMahlzeitId: null,
      },
    ],
    gerichte: [{ id: 100, personen: 4, zutaten: [zeile(1, 1, 400), zeile(2, 3, null)] }],
    zutaten: [
      zutat(1, 'Nudeln', 'masse', 7),
      zutat(2, 'Coca-Cola', 'volumen'),
      zutat(3, 'Pfeffer', 'masse'),
      zutat(4, 'Brötchen', 'stueck', 8),
    ],
    geschaefte: [
      { id: 7, etag: '', position: 1, name: 'Metro' },
      { id: 8, etag: '', position: 2, name: 'Bäcker' },
    ],
    bestand: [],
    zusatzbedarf: [],
    einkaeufe,
  };
}

/** „400 g Nudeln“ per thing of a trip, ticked off ones with what was bought. */
function liste(s: EinkaufsStand, e: Einkauf): string[] {
  const l = einkaufListen(s, new Map([[1, 'Lebensmittel']])).get(e.id)!;
  return l.kategorien.flatMap((k) =>
    k.posten.map(
      (p) =>
        `${p.menge === null ? '' : `${p.menge} ${p.einheit} `}${p.name}${p.haken ? ` ✓${p.haken.erhalten} ${p.haken.einheit}` : ''}${p.regel ? ` (${p.regel})` : ''}`
    )
  );
}

test('each trip buys the open meals up to its last one, less what earlier trips buy', () => {
  const a = einkauf({ bisMahlzeitId: 1 });
  const b = einkauf({ bisMahlzeitId: 3 });
  const s = stand([b, a]);
  assert.deepEqual(liste(s, a), ['400 g Nudeln', 'Pfeffer']);
  assert.deepEqual(liste(s, b), ['800 g Nudeln']);
  // Without a last meal, or with one deleted since, a trip covers everything
  const c = einkauf({ bisMahlzeitId: 999 });
  assert.deepEqual(liste(stand([c]), c), ['1.2 kg Nudeln', 'Pfeffer']);
});

test('trips go by date, those without one last, then by position', () => {
  const ohne = einkauf({ position: 1 });
  const spaet = einkauf({ position: 2, datum: '2027-08-03' });
  const frueh = einkauf({ position: 3, datum: '2027-08-01' });
  assert.deepEqual(
    einkaufsReihenfolge([ohne, spaet, frueh]).map((e) => e.id),
    [frueh.id, spaet.id, ohne.id]
  );
  // The earliest trip buys it all
  assert.deepEqual(liste(stand([ohne, spaet, frueh]), frueh), ['1.2 kg Nudeln', 'Pfeffer']);
  assert.deepEqual(liste(stand([ohne, spaet, frueh]), ohne), []);
});

test('the stock counts, and a trip takes only the ingredients of its shop', () => {
  const metro = einkauf({ geschaeftId: 7, bisMahlzeitId: 1 });
  const baecker = einkauf({ geschaeftId: 8 });
  const s = stand([metro, baecker]);
  s.bestand = [{ id: 1, etag: '', planungZutatId: 1, menge: 500, einheit: 'g', hinweis: '' }];
  // 400 g needed up to meal 1, 500 g in stock; pepper has no shop, so no trip of a shop takes it
  assert.deepEqual(liste(s, metro), []);
  assert.deepEqual(liste(s, baecker), []);
  // „mit“: the baker brings the pasta after all
  baecker.regeln = [{ planungZutatId: 1, art: 'mit', menge: null, einheit: null }];
  assert.deepEqual(liste(s, baecker), ['700 g Nudeln (mit)']);
});

test('what was ticked off is in stock; a rest is bought on the next trip', () => {
  const a = einkauf({ bisMahlzeitId: 3 });
  const b = einkauf();
  const s = stand([a, b]);
  a.posten = [haken(1, 1, 'kg')];
  assert.deepEqual(liste(s, a), ['1.2 kg Nudeln ✓1 kg', 'Pfeffer']);
  assert.deepEqual(liste(s, b), ['200 g Nudeln']);
  assert.deepEqual(
    lager(s).find((p) => p.planungZutatId === 1),
    { planungZutatId: 1, einheit: 'g', anfang: 0, erhalten: 1000, verbraucht: 0, jetzt: 1000 }
  );
  // The open shopping list is what is needed less the stock now
  assert.deepEqual(
    einkaufsliste(s, new Map()).flatMap((g) =>
      g.kategorien.flatMap((k) => k.posten.map((p) => [p.name, p.menge, p.einheit]))
    ),
    [
      ['Nudeln', 200, 'g'],
      ['Pfeffer', null, null],
    ]
  );
});

test('a replacement counts as bought and is named in the stock', () => {
  const a = einkauf();
  const b = einkauf();
  const s = stand([a, b]);
  s.zusatzbedarf = [{ id: 1, etag: '', planungZutatId: 2, menge: 4, einheit: 'l', hinweis: '' }];
  assert.deepEqual(liste(s, a).slice(0, 1), ['4 l Coca-Cola']);
  a.posten = [haken(2, 3, 'l', 'Pepsi Cola')];
  assert.deepEqual(liste(s, b), ['1 l Coca-Cola']);
  const zeile = lagerZeilen(s).find((z) => z.planungZutatId === 2)!;
  assert.equal(zeile.ersatz, '→ Pepsi Cola');
  assert.equal(zeile.erhalten, '3 l');
});

test('rules: not on this trip, or a fixed amount', () => {
  const a = einkauf({ bisMahlzeitId: 1 });
  const b = einkauf();
  const s = stand([a, b]);
  a.regeln = [{ planungZutatId: 1, art: 'ohne', menge: null, einheit: null }];
  assert.deepEqual(liste(s, a), ['Pfeffer']);
  assert.deepEqual(liste(s, b), ['1.2 kg Nudeln']);
  assert.deepEqual(einkaufListen(s, new Map()).get(a.id)!.ohne, [
    { planungZutatId: 1, name: 'Nudeln' },
  ]);
  a.regeln = [{ planungZutatId: 1, art: 'fest', menge: 1, einheit: 'kg' }];
  assert.deepEqual(liste(s, a), ['1 kg Nudeln (fest)', 'Pfeffer']);
  assert.deepEqual(liste(s, b), ['200 g Nudeln']);
});

test('a finished trip keeps only what was ticked off; the rest goes to the next one', () => {
  const a = einkauf({ bisMahlzeitId: 1, abgeschlossen: true, posten: [haken(1, 100, 'g')] });
  const b = einkauf({ bisMahlzeitId: 2 });
  const s = stand([a, b]);
  assert.deepEqual(liste(s, a), ['Nudeln ✓100 g']);
  // 800 g up to meal 2, 100 g bought; the pepper by eye moves on too
  assert.deepEqual(liste(s, b), ['700 g Nudeln', 'Pfeffer']);
  const info = einkaufListen(s, new Map()).get(a.id)!;
  assert.equal(info.anzahl, 1);
  assert.equal(info.abgehakt, 1);
});

test('extra needs count from the first trip on; cooked meals need nothing more', () => {
  const a = einkauf({ bisMahlzeitId: 1 });
  const s = stand([a]);
  s.zusatzbedarf = [{ id: 1, etag: '', planungZutatId: 2, menge: 2, einheit: 'l', hinweis: '' }];
  s.tage[0].mahlzeiten[0].einplanungen[0].status = 'gekocht';
  assert.deepEqual(liste(s, a), ['2 l Coca-Cola', 'Pfeffer']);
});

test('things without an amount stay on the list until ticked off or in stock', () => {
  const a = einkauf();
  const b = einkauf();
  const s = stand([a, b]);
  s.zusatzbedarf = [
    { id: 1, etag: '', planungZutatId: 4, menge: null, einheit: null, hinweis: '' },
  ];
  // Brötchen belong to the baker: a trip of all shops takes them
  assert.ok(liste(s, a).includes('Brötchen'));
  a.posten = [haken(3, 0, 'g')];
  assert.ok(liste(s, a).includes('Pfeffer ✓0 g'));
  assert.ok(!liste(s, b).includes('Pfeffer'));
  // In stock: on no trip
  a.posten = [];
  s.bestand = [{ id: 1, etag: '', planungZutatId: 3, menge: 50, einheit: 'g', hinweis: '' }];
  assert.ok(!liste(s, a).includes('Pfeffer'));
  assert.ok(!liste(s, b).includes('Pfeffer'));
});

test('pieces are rounded up, and the next trip counts what is really bought', () => {
  const a = einkauf({ bisMahlzeitId: 1 });
  const b = einkauf();
  const s = stand([a, b]);
  // 2.5 rolls per meal: 3 on the first trip, 7.5 − 3 = 4.5 → 5 on the second
  s.gerichte[0].zutaten = [zeile(1, 4, 2.5, 'stueck')];
  assert.deepEqual(liste(s, a), ['3 stueck Brötchen']);
  assert.deepEqual(liste(s, b), ['5 stueck Brötchen']);
});
