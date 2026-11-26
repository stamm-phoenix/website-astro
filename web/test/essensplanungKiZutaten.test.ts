import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { KiZutatErgebnis } from '../../api/lib/essen-ki-zutaten-model';
import type { EssenZutat } from '../../api/lib/essen-validation';
import { ApiError } from '../src/lib/api';
import {
  kiZutatenPruefen,
  kiZutatenSortiert,
  planungZutatKiBody,
  zentraleZutatKiBody,
} from '../src/lib/essensplanungKiZutaten';

function ergebnis(id: number, status: KiZutatErgebnis['status']): KiZutatErgebnis {
  return { id, etag: `e${id}`, name: `Z${id}`, status, text: '', aenderungen: [], vorschlag: null };
}

const WERTE = {
  name: 'Spaghetti',
  kategorieId: 3,
  einheitenart: 'masse' as const,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [10],
  grammProTl: null,
  grammProEl: 12,
  grammProStueck: null,
};

describe('kiZutatenPruefen', () => {
  test('asks in portions of 25, three at a time, and keeps every answer', async () => {
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);
    let gleichzeitig = 0;
    let hoechstens = 0;
    const fortschritt: number[] = [];
    const lauf = await kiZutatenPruefen(
      ids,
      async (portion) => {
        gleichzeitig++;
        hoechstens = Math.max(hoechstens, gleichzeitig);
        await new Promise((resolve) => setTimeout(resolve, 5));
        gleichzeitig--;
        return { ergebnisse: portion.map((id) => ergebnis(id, 'passt')) };
      },
      { fortschritt: (fertig) => fortschritt.push(fertig) }
    );
    assert.deepEqual(
      lauf.ergebnisse.map((e) => e.id).toSorted((a, b) => a - b),
      ids
    );
    assert.deepEqual([lauf.fehler, lauf.offen], [null, []]);
    assert.equal(hoechstens, 3);
    assert.equal(fortschritt.at(-1), 80);
  });

  test('stops at an error and returns the ids not answered', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    const lauf = await kiZutatenPruefen(
      ids,
      async (portion) => {
        if (portion[0] === 26) throw new ApiError(429, 'KI gerade nicht verfügbar.');
        return { ergebnisse: portion.map((id) => ergebnis(id, 'passt')) };
      },
      { parallel: 1 }
    );
    assert.equal(lauf.ergebnisse.length, 25);
    assert.equal(lauf.fehler, 'KI gerade nicht verfügbar.');
    assert.deepEqual(lauf.offen, ids.slice(25));
  });
});

test('kiZutatenSortiert puts proposals first and fitting ones last', () => {
  const sortiert = kiZutatenSortiert([
    ergebnis(1, 'passt'),
    ergebnis(2, 'ohne_antwort'),
    ergebnis(3, 'vorschlag'),
    ergebnis(4, 'unklar'),
  ]);
  assert.deepEqual(
    sortiert.map((e) => e.id),
    [3, 4, 2, 1]
  );
});

test('the bodies take the proposal at the checked version', () => {
  const mitVorschlag = { ...ergebnis(7, 'vorschlag'), vorschlag: WERTE };
  assert.equal(planungZutatKiBody(ergebnis(7, 'passt')), null);
  assert.deepEqual(planungZutatKiBody(mitVorschlag), {
    etag: 'e7',
    name: 'Spaghetti',
    kategorieId: 3,
    einheitenart: 'masse',
    vegetarisch: true,
    vegan: true,
    allergene: [10],
  });
  const aktuell = {
    id: 7,
    etag: 'neuer',
    abtropfgewicht: true,
    merkmaleGeprueft: true,
    hinweis: 'Hartweizen',
  } as EssenZutat;
  assert.deepEqual(zentraleZutatKiBody(aktuell, mitVorschlag), {
    id: 7,
    etag: 'e7',
    ...WERTE,
    abtropfgewicht: true,
    merkmaleGeprueft: true,
    hinweis: 'Hartweizen',
  });
});
