import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bedarf,
  einkaufsMenge,
  esserRechner,
  isstZeile,
  kochMenge,
  summiere,
  zeilenMenge,
} from '../src/lib/essensplanungRechnung.ts';
import type {
  RechnungsMahlzeit,
  RechnungsStand,
  RechnungsTeilnehmende,
  ZeileFuer,
} from '../src/lib/essensplanungRechnung.ts';
import type { Ernaehrung } from '../src/lib/types.ts';

// ---------------------------------------------------------------------------------------------
// The Bezirkslager 2026 from the sheet (test/fixtures/essensplanung-bezirkslager/README.md)
// ---------------------------------------------------------------------------------------------

function csv(datei: string): Record<string, string>[] {
  const text = readFileSync(
    new URL(`./fixtures/essensplanung-bezirkslager/${datei}`, import.meta.url),
    'utf8'
  );
  const zeilen: string[][] = [];
  let feld = '';
  let zeile: string[] = [];
  let zitat = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (zitat) {
      if (c === '"' && text[i + 1] === '"') {
        feld += '"';
        i++;
      } else if (c === '"') zitat = false;
      else feld += c;
    } else if (c === '"') zitat = true;
    else if (c === ',') {
      zeile.push(feld);
      feld = '';
    } else if (c === '\n') {
      zeile.push(feld.replace(/\r$/, ''));
      zeilen.push(zeile);
      zeile = [];
      feld = '';
    } else feld += c;
  }
  if (feld || zeile.length) zeilen.push([...zeile, feld]);
  const [kopf, ...rest] = zeilen;
  return rest
    .filter((werte) => werte.length > 1)
    .map((werte) => Object.fromEntries(kopf.map((name, index) => [name, werte[index] ?? ''])));
}

const ERNAEHRUNG: Record<string, Ernaehrung> = {
  mit_allem: 'alles',
  vegetarisch: 'vegetarisch',
  vegan: 'vegan',
};

function lager() {
  const gruppen = csv('gruppenfaktoren.csv').map((row, index) => ({
    id: index + 1,
    name: row.gruppe,
    faktor: Number(row.faktor),
  }));
  const plan = csv('tagesplan.csv');
  const mahlzeitId = new Map(plan.map((row, index) => [row.mahlzeit_id, index + 1]));
  // One row of participants per meal, diet and group, present at that meal only
  const teilnehmende: RechnungsTeilnehmende[] = plan.flatMap((row) =>
    Object.entries(ERNAEHRUNG).flatMap(([spalte, ernaehrung]) =>
      gruppen
        .map((gruppe) => ({
          gruppeId: gruppe.id,
          ernaehrung,
          anzahl: Number(row[`${spalte}_${gruppe.name}`]),
          unvertraeglichkeiten: [],
          vonMahlzeitId: mahlzeitId.get(row.mahlzeit_id)!,
          bisMahlzeitId: mahlzeitId.get(row.mahlzeit_id)!,
        }))
        .filter((zeile) => zeile.anzahl > 0)
    )
  );
  const tage = [...new Set(plan.map((row) => row.tag))].map((tag) => ({
    mahlzeiten: plan
      .filter((row) => row.tag === tag)
      .map((row): RechnungsMahlzeit => ({
        id: mahlzeitId.get(row.mahlzeit_id)!,
        ohneGruppen: [],
        einplanungen: [],
      })),
  }));
  return { gruppen, plan, mahlzeitId, teilnehmende, tage };
}

test('every line of the sheet comes out as the sheet computed it', () => {
  const { gruppen, mahlzeitId, teilnehmende, tage } = lager();
  const esser = esserRechner({ tage, gruppen, teilnehmende });
  const zeilen = csv('gericht_zutaten.csv');
  assert.equal(zeilen.length, 683);
  let geprueft = 0;
  for (const row of zeilen) {
    const fest = row.feste_gesamtmenge !== '';
    const roh = fest ? row.feste_gesamtmenge : row.rezeptmenge;
    // Typos of the sheet such as „s“ are no amount; the sheet computed 0 for them
    const menge = /^\d+(\.\d+)?$/.test(roh) ? Number(roh) : null;
    const fuer: ZeileFuer = {
      fuerAlles: row.mit_allem === 'true',
      fuerVegetarisch: row.vegetarisch === 'true',
      fuerVegan: row.vegan === 'true',
      ohne: [],
      nur: [],
    };
    const wer = esser({ id: mahlzeitId.get(row.mahlzeit_id)!, ohneGruppen: [] }, fuer);
    const ergebnis =
      zeilenMenge(
        { menge, fest },
        Number(row.referenz_personen),
        wer,
        Number(row.gerichtsfaktor)
      ) ?? 0;
    const erwartet = Number(row.gesamt_sheet);
    assert.ok(
      Math.abs(ergebnis - erwartet) < 0.01,
      `${row.mahlzeit_id} ${row.zutat}: ${ergebnis} statt ${erwartet}`
    );
    geprueft++;
  }
  assert.equal(geprueft, 683);
});

test('the examples of the docs: bread for everyone, milk without the vegans', () => {
  const { gruppen, mahlzeitId, teilnehmende, tage } = lager();
  const esser = esserRechner({ tage, gruppen, teilnehmende });
  const fruehstueck = { id: mahlzeitId.get('2_1')!, ohneGruppen: [] };
  const alle = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true, ohne: [], nur: [] };
  assert.equal(Math.round(esser(fruehstueck, alle) * 100) / 100, 35.5);
  assert.equal(
    Math.round(zeilenMenge({ menge: 80, fest: false }, 1, esser(fruehstueck, alle), 1)!),
    2840
  );
  const ohneVegan = { ...alle, fuerVegan: false };
  assert.equal(Math.round(esser(fruehstueck, ohneVegan) * 100) / 100, 31.2);
  assert.equal(
    Math.round(zeilenMenge({ menge: 200, fest: false }, 1, esser(fruehstueck, ohneVegan), 1)!),
    6240
  );
});

test('the weighted eaters per meal match the sums of the sheet', () => {
  const { gruppen, plan, mahlzeitId, teilnehmende, tage } = lager();
  const esser = esserRechner({ tage, gruppen, teilnehmende });
  const nur = (ernaehrung: 'fuerAlles' | 'fuerVegetarisch' | 'fuerVegan'): ZeileFuer => ({
    fuerAlles: ernaehrung === 'fuerAlles',
    fuerVegetarisch: ernaehrung === 'fuerVegetarisch',
    fuerVegan: ernaehrung === 'fuerVegan',
    ohne: [],
    nur: [],
  });
  for (const row of plan) {
    const mahlzeit = { id: mahlzeitId.get(row.mahlzeit_id)!, ohneGruppen: [] };
    for (const [spalte, fuer] of [
      ['gewichtet_mit_allem_sheet', nur('fuerAlles')],
      ['gewichtet_vegetarisch_sheet', nur('fuerVegetarisch')],
      ['gewichtet_vegan_sheet', nur('fuerVegan')],
    ] as const) {
      assert.ok(
        Math.abs(esser(mahlzeit, fuer) - Number(row[spalte])) < 0.01,
        `${row.mahlzeit_id} ${spalte}`
      );
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The rules beyond the sheet
// ---------------------------------------------------------------------------------------------

const person = (
  ernaehrung: Ernaehrung,
  unvertraeglichkeiten: number[] = []
): RechnungsTeilnehmende => ({
  gruppeId: 1,
  ernaehrung,
  anzahl: 1,
  unvertraeglichkeiten,
  vonMahlzeitId: null,
  bisMahlzeitId: null,
});

test('intolerances leave people out of a line or give them their own', () => {
  const alle = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true };
  const nudeln = { ...alle, ohne: [7], nur: [] };
  const glutenfrei = { ...alle, ohne: [], nur: [7] };
  assert.equal(isstZeile(person('alles'), nudeln), true);
  assert.equal(isstZeile(person('alles', [7]), nudeln), false);
  assert.equal(isstZeile(person('alles'), glutenfrei), false);
  assert.equal(isstZeile(person('vegan', [3, 7]), glutenfrei), true);
  assert.equal(isstZeile(person('vegan', [7]), { ...glutenfrei, fuerVegan: false }), false);
});

function stand(): RechnungsStand {
  return {
    tage: [
      {
        mahlzeiten: [
          { id: 1, ohneGruppen: [], einplanungen: [{ id: 11, gerichtId: 100, faktor: 1 }] },
          { id: 2, ohneGruppen: [2], einplanungen: [{ id: 12, gerichtId: 100, faktor: 0.5 }] },
        ],
      },
    ],
    gruppen: [
      { id: 1, faktor: 1 },
      { id: 2, faktor: 0.5 },
    ],
    teilnehmende: [
      { ...person('alles'), anzahl: 10 },
      { ...person('vegan'), gruppeId: 2, anzahl: 4 },
      { ...person('alles', [7]), anzahl: 2, vonMahlzeitId: 2, bisMahlzeitId: 2 },
    ],
    gerichte: [
      {
        id: 100,
        personen: 4,
        zutaten: [
          {
            id: 1001,
            planungZutatId: 1,
            menge: 1,
            einheit: 'kg',
            fest: false,
            fuerAlles: true,
            fuerVegetarisch: true,
            fuerVegan: true,
            ohne: [7],
            nur: [],
          },
          {
            id: 1002,
            planungZutatId: 2,
            menge: 2,
            einheit: 'packung',
            fest: true,
            fuerAlles: true,
            fuerVegetarisch: true,
            fuerVegan: true,
            ohne: [],
            nur: [],
          },
          {
            id: 1003,
            planungZutatId: 3,
            menge: null,
            einheit: null,
            fest: false,
            fuerAlles: true,
            fuerVegetarisch: true,
            fuerVegan: true,
            ohne: [],
            nur: [],
          },
        ],
      },
    ],
  };
}

test('needs per planned dish follow presence, left out groups and the factor', () => {
  const liste = bedarf(stand());
  // Meal 1: 10 people plus 4 × 0.5; meal 2 leaves group 2 out and the 2 with gluten skip it
  assert.deepEqual(
    liste.map(({ einplanungId, zeileId, esser, menge, einheit }) => ({
      einplanungId,
      zeileId,
      esser,
      menge,
      einheit,
    })),
    [
      { einplanungId: 11, zeileId: 1001, esser: 12, menge: 3, einheit: 'kg' },
      { einplanungId: 11, zeileId: 1002, esser: 0, menge: 2, einheit: 'packung' },
      { einplanungId: 12, zeileId: 1001, esser: 10, menge: 1.25, einheit: 'kg' },
      { einplanungId: 12, zeileId: 1002, esser: 0, menge: 2, einheit: 'packung' },
    ]
  );
});

test('sums are kept per unit and rounded only when bought', () => {
  const summen = summiere([
    ...bedarf(stand()),
    { planungZutatId: 1, menge: 250, einheit: 'g' },
    { planungZutatId: 2, menge: 0.3, einheit: 'packung' },
  ]);
  assert.deepEqual(summen, [
    { planungZutatId: 1, einheit: 'g', menge: 4500 },
    { planungZutatId: 2, einheit: 'packung', menge: 4.3 },
  ]);
  assert.deepEqual(einkaufsMenge(4500, 'g'), { menge: 4.5, einheit: 'kg' });
  assert.deepEqual(einkaufsMenge(999, 'ml'), { menge: 999, einheit: 'ml' });
  assert.deepEqual(einkaufsMenge(1500, 'ml'), { menge: 1.5, einheit: 'l' });
  assert.deepEqual(einkaufsMenge(4.3, 'packung'), { menge: 5, einheit: 'packung' });
  assert.deepEqual(einkaufsMenge(3.0000000001, 'stueck'), { menge: 3, einheit: 'stueck' });
});

test('amounts for cooking read in kg and l from 1000 and are not rounded up', () => {
  assert.equal(kochMenge(2840, 'g'), '2,84 kg');
  assert.equal(kochMenge(0.4, 'kg'), '400 g');
  assert.equal(kochMenge(1250, 'ml'), '1,25 l');
  assert.equal(kochMenge(7.2, 'stueck'), '7,2 Stück');
  assert.equal(kochMenge(1.2, 'kg', true), '1,2 kg (ATG)');
});
