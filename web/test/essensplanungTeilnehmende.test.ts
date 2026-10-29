import assert from 'node:assert/strict';
import test from 'node:test';
import { zahlText, zeitraumText } from '../src/lib/essensplanungTeilnehmende.ts';
import {
  esserJeMahlzeit,
  gruppenFaktorGueltig,
  leseGruppenFaktor,
} from '../../api/lib/essen-teilnehmende-model.ts';
import type { PlanungAnsicht } from '../src/lib/types.ts';

const mahlzeit = (id: number, kennung: string, name: string, ohneGruppen: number[] = []) => ({
  id,
  kennung,
  name,
  ohneGruppen,
});
const tage = [
  { mahlzeiten: [mahlzeit(1, '1_1', 'Frühstück', [10]), mahlzeit(2, '1_2', 'Mittagessen')] },
  { mahlzeiten: [mahlzeit(3, '2_1', 'Frühstück')] },
];
const gruppen = [
  { id: 10, faktor: 0.7 },
  { id: 20, faktor: 1.2 },
];
const zeile = (
  gruppeId: number,
  ernaehrung: 'alles' | 'vegetarisch' | 'vegan',
  anzahl: number,
  vonMahlzeitId: number | null = null,
  bisMahlzeitId: number | null = null
) => ({ gruppeId, ernaehrung, anzahl, vonMahlzeitId, bisMahlzeitId });

test('eaters count presence, skipped groups and factors', () => {
  const esser = esserJeMahlzeit({
    tage,
    gruppen,
    teilnehmende: [zeile(10, 'alles', 10), zeile(20, 'vegan', 3, 2, 2)],
  });
  // Breakfast without group 10; lunch everybody; the vegans only at lunch
  assert.deepEqual(esser.get(1), {
    personen: 0,
    gewichtet: 0,
    je: {
      alles: { personen: 0, gewichtet: 0 },
      vegetarisch: { personen: 0, gewichtet: 0 },
      vegan: { personen: 0, gewichtet: 0 },
    },
  });
  assert.equal(esser.get(2)?.personen, 13);
  assert.equal(esser.get(2)?.gewichtet, 10.6);
  assert.equal(esser.get(2)?.je.vegan.gewichtet, 3.6);
  assert.equal(esser.get(3)?.personen, 10);
});

test('a limit that is not in the plan any more leaves nothing', () => {
  const esser = esserJeMahlzeit({ tage, gruppen, teilnehmende: [zeile(20, 'alles', 2, 99)] });
  assert.equal(esser.get(2)?.personen, 0);
  assert.equal(esser.get(3)?.personen, 0);
});

test('the stay reads from and until meals', () => {
  const ansicht = { tage } as unknown as PlanungAnsicht;
  const text = (von: number | null, bis: number | null) =>
    zeitraumText(ansicht, {
      ...zeile(10, 'alles', 1, von, bis),
      id: 1,
      etag: '',
      unvertraeglichkeiten: [],
      hinweis: '',
    });
  assert.equal(text(null, null), '');
  assert.equal(text(2, null), 'ab 1_2 Mittagessen');
  assert.equal(text(null, 3), 'bis 2_1 Frühstück');
  assert.equal(text(1, 3), 'ab 1_1 Frühstück bis 2_1 Frühstück');
});

test('group factors take a comma and two decimals', () => {
  assert.equal(leseGruppenFaktor('0,7'), 0.7);
  assert.ok(gruppenFaktorGueltig(0.01));
  assert.ok(!gruppenFaktorGueltig(0));
  assert.ok(!gruppenFaktorGueltig(0.005));
  assert.ok(!gruppenFaktorGueltig(5.01));
  assert.equal(zahlText(1.2), '1,2');
});
