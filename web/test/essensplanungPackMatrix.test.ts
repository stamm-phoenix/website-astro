import assert from 'node:assert/strict';
import test from 'node:test';
import { naechsteZelle } from '../src/lib/essensplanungPackMatrix.ts';
import { anteil, packSpalten, spaltenSumme } from '../src/lib/essensplanungPackSpalten.ts';

const mitglied = (id: number, name: string, entzogen = false, ich = false) => ({
  id,
  name,
  entzogen,
  ich,
});
let naechste = 1;
const person = (mitgliedId: number | null, name: string, gepackt = false) => ({
  id: naechste++,
  etag: '"1"',
  mitgliedId,
  name,
  gepackt,
});
const zeile = (...personen: ReturnType<typeof person>[]) => ({ personen });

test('the columns are the members with access, then the free names by name', () => {
  const spalten = packSpalten(
    [mitglied(1, 'Kim', false, true), mitglied(2, 'Alex', true), mitglied(3, 'Jo', true)],
    [
      zeile(person(null, 'Rover'), person(null, 'Bezirk')),
      zeile(person(3, 'Jo'), person(null, 'rover')),
      // A member the view lacks, e.g. for those who only read
      zeile(person(9, 'Sam')),
      zeile(),
    ]
  );
  assert.deepEqual(
    spalten.map((s) => [s.key, s.name, s.mitgliedId, s.ich, s.ohneZugang]),
    [
      ['m:1', 'Kim', 1, true, false],
      ['m:3', 'Jo', 3, false, true],
      ['m:9', 'Sam', 9, false, true],
      ['t:bezirk', 'Bezirk', null, false, false],
      ['t:rover', 'Rover', null, false, false],
    ]
  );
});

test('a person packs their own share; sums count their packed shares', () => {
  const zeilen = [
    zeile(person(1, 'Kim', true), person(null, 'Rover')),
    zeile(person(1, 'Kim'), person(2, 'Alex', true)),
    zeile(person(null, 'ROVER', true)),
  ];
  assert.equal(anteil(zeilen[0], 'm:1')?.gepackt, true);
  assert.equal(anteil(zeilen[0], 'm:2'), undefined);
  assert.equal(anteil(zeilen[2], 't:rover')?.name, 'ROVER');
  assert.deepEqual(spaltenSumme(zeilen, 'm:1'), { gepackt: 1, gesamt: 2 });
  assert.deepEqual(spaltenSumme(zeilen, 't:rover'), { gepackt: 1, gesamt: 2 });
  assert.deepEqual(spaltenSumme(zeilen, 'm:3'), { gepackt: 0, gesamt: 0 });
});

test('the keys move the focus like in a spreadsheet and stop at the edges', () => {
  const von = { zeile: 2, spalte: 1 };
  assert.deepEqual(naechsteZelle(von, { key: 'ArrowUp' }, 5, 4), { zeile: 1, spalte: 1 });
  assert.deepEqual(naechsteZelle(von, { key: 'ArrowDown' }, 5, 4), { zeile: 3, spalte: 1 });
  assert.deepEqual(naechsteZelle(von, { key: 'ArrowLeft' }, 5, 4), { zeile: 2, spalte: 0 });
  assert.deepEqual(naechsteZelle(von, { key: 'ArrowRight' }, 5, 4), { zeile: 2, spalte: 2 });
  assert.deepEqual(naechsteZelle({ zeile: 0, spalte: 0 }, { key: 'ArrowUp' }, 5, 4), {
    zeile: 0,
    spalte: 0,
  });
  assert.deepEqual(naechsteZelle({ zeile: 4, spalte: 3 }, { key: 'ArrowRight' }, 5, 4), {
    zeile: 4,
    spalte: 3,
  });
  assert.deepEqual(naechsteZelle(von, { key: 'Home' }, 5, 4), { zeile: 2, spalte: 0 });
  assert.deepEqual(naechsteZelle(von, { key: 'End' }, 5, 4), { zeile: 2, spalte: 3 });
  assert.deepEqual(naechsteZelle(von, { key: 'Home', ctrlKey: true }, 5, 4), {
    zeile: 0,
    spalte: 0,
  });
  assert.deepEqual(naechsteZelle(von, { key: 'End', metaKey: true }, 5, 4), {
    zeile: 4,
    spalte: 3,
  });
  assert.deepEqual(naechsteZelle(von, { key: 'PageDown' }, 30, 4), { zeile: 12, spalte: 1 });
  assert.deepEqual(naechsteZelle(von, { key: 'PageUp' }, 30, 4), { zeile: 0, spalte: 1 });
  // A row gone meanwhile: back into the matrix
  assert.deepEqual(naechsteZelle({ zeile: 9, spalte: 1 }, { key: 'ArrowLeft' }, 5, 4), {
    zeile: 4,
    spalte: 0,
  });
  assert.equal(naechsteZelle(von, { key: 'a' }, 5, 4), null);
  assert.equal(naechsteZelle(von, { key: 'ArrowUp' }, 0, 4), null);
});
