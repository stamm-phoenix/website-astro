import assert from 'node:assert/strict';
import test from 'node:test';
import type { Einkauf, EinkaufHaken } from '../../api/lib/essen-einkaeufe-model.ts';
import {
  einkaufDruckZeile,
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

test('a thing moved past a trip in between stays with the trip it was moved to', () => {
  const a = einkauf();
  const b = einkauf();
  const c = einkauf();
  const s = stand([a, b, c]);
  s.gerichte[0].zutaten = [];
  s.zusatzbedarf = [{ id: 1, etag: '', planungZutatId: 1, menge: 1, einheit: 'kg', hinweis: '' }];
  // Moved from A to C: „ohne“ on A, „mit“ on C; B has no rule of its own
  a.regeln = [{ planungZutatId: 1, art: 'ohne', menge: null, einheit: null }];
  c.regeln = [{ planungZutatId: 1, art: 'mit', menge: null, einheit: null }];
  assert.deepEqual(liste(s, a), []);
  assert.deepEqual(liste(s, b), []);
  assert.deepEqual(liste(s, c), ['1 kg Nudeln (mit)']);
  // A finished target no longer holds it
  c.abgeschlossen = true;
  assert.deepEqual(liste(s, b), ['1 kg Nudeln']);
});

test('a thing without an amount ticked off on a trip leaves the whole shopping list too', () => {
  const a = einkauf();
  const s = stand([a]);
  s.zusatzbedarf = [
    { id: 1, etag: '', planungZutatId: 4, menge: null, einheit: null, hinweis: '' },
  ];
  const gesamt = () =>
    einkaufsliste(s, new Map()).flatMap((g) =>
      g.kategorien.flatMap((k) => k.posten.map((p) => p.name))
    );
  assert.ok(gesamt().includes('Brötchen'));
  a.posten = [haken(4, 0, 'stueck')];
  assert.ok(liste(s, a).includes('Brötchen ✓0 stueck'));
  assert.ok(!gesamt().includes('Brötchen'));
  // Pasta with an amount but nothing bought stays on both lists
  a.posten = [haken(4, 0, 'stueck'), haken(1, 0, 'g')];
  assert.ok(gesamt().includes('Nudeln'));
  assert.ok(liste(s, a).some((p) => p.startsWith('1.2 kg Nudeln ✓0 g')));
});

test('a thing moved to a trip of fewer meals brings all it needs there', () => {
  // A covers meals 1 and 2, B only meal 1: moved from A to B, B buys for both meals
  const a = einkauf({ bisMahlzeitId: 2 });
  const b = einkauf({ bisMahlzeitId: 1 });
  const s = stand([a, b]);
  s.tage[0].mahlzeiten = s.tage[0].mahlzeiten.slice(0, 2);
  s.gerichte[0].zutaten = [zeile(1, 4, 1, 'stueck')];
  assert.deepEqual(liste(s, a), ['2 stueck Brötchen']);
  a.regeln = [{ planungZutatId: 4, art: 'ohne', menge: null, einheit: null }];
  b.regeln = [{ planungZutatId: 4, art: 'mit', menge: null, einheit: null }];
  assert.deepEqual(liste(s, a), []);
  assert.deepEqual(liste(s, b), ['2 stueck Brötchen (mit)']);
});

test('a thing without an amount keeps its key when ticked off', () => {
  const a = einkauf();
  const s = stand([a]);
  s.zusatzbedarf = [
    { id: 1, etag: '"01"', planungZutatId: 4, menge: null, einheit: null, hinweis: '' },
  ];
  const key = () =>
    einkaufListen(s, new Map())
      .get(a.id)!
      .kategorien.flatMap((k) => k.posten)
      .find((p) => p.planungZutatId === 4)!.key;
  assert.equal(key(), '4:');
  a.posten = [{ ...haken(4, 0, 'stueck'), etag: '"02"' }];
  assert.equal(key(), '4:');
});

test('a tick covers only what was put on the list before it', () => {
  // Gloves ticked off on a finished trip; later they are needed again
  const fertig = einkauf({ abgeschlossen: true });
  const nach = einkauf();
  const s = stand([fertig, nach]);
  s.gerichte = [];
  s.zusatzbedarf = [
    { id: 1, etag: '"05"', planungZutatId: 4, menge: null, einheit: null, hinweis: '' },
  ];
  fertig.posten = [{ ...haken(4, 0, 'stueck'), etag: '"07"' }];
  const gesamt = () =>
    einkaufsliste(s, new Map()).flatMap((g) =>
      g.kategorien.flatMap((k) => k.posten.map((p) => p.name))
    );
  assert.deepEqual(gesamt(), []);
  assert.deepEqual(liste(s, nach), []);
  s.zusatzbedarf = [
    { id: 2, etag: '"09"', planungZutatId: 4, menge: null, einheit: null, hinweis: '' },
  ];
  assert.deepEqual(gesamt(), ['Brötchen']);
  assert.deepEqual(liste(s, nach), ['Brötchen']);
});

test('a thing without an amount with a fixed amount is one row when ticked off', () => {
  const a = einkauf();
  const s = stand([a]);
  s.gerichte = [];
  s.zusatzbedarf = [
    { id: 1, etag: '"01"', planungZutatId: 4, menge: null, einheit: null, hinweis: '' },
  ];
  a.regeln = [{ planungZutatId: 4, art: 'fest', menge: 2, einheit: 'stueck' }];
  assert.deepEqual(liste(s, a), ['2 stueck Brötchen (fest)']);
  a.posten = [{ ...haken(4, 2, 'stueck'), etag: '"02"' }];
  assert.deepEqual(liste(s, a), ['2 stueck Brötchen ✓2 stueck (fest)']);
  const info = einkaufListen(s, new Map()).get(a.id)!;
  assert.equal(info.anzahl, 1);
  assert.equal(info.abgehakt, 1);
});

test('on paper a ticked off thing shows what was bought, also after finishing', () => {
  const a = einkauf({ bisMahlzeitId: 3 });
  const s = stand([a]);
  const zeilen = () =>
    einkaufListen(s, new Map())
      .get(a.id)!
      .kategorien.flatMap((k) => k.posten.map(einkaufDruckZeile));
  assert.deepEqual(zeilen(), [
    { abgehakt: false, menge: '1,2 kg', name: 'Nudeln' },
    { abgehakt: false, menge: 'nach Gefühl', name: 'Pfeffer' },
  ]);
  a.posten = [haken(1, 800, 'g', 'Vollkornnudeln')];
  assert.deepEqual(zeilen()[0], {
    abgehakt: true,
    menge: '800 g',
    name: 'Nudeln → Vollkornnudeln',
  });
  a.abgeschlossen = true;
  assert.deepEqual(zeilen(), [{ abgehakt: true, menge: '800 g', name: 'Nudeln → Vollkornnudeln' }]);
});
