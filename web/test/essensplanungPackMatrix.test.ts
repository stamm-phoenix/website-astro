import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NIEMAND,
  naechsteZelle,
  packSpalten,
  spalteVon,
  spaltenSumme,
} from '../src/lib/essensplanungPackMatrix.ts';

const mitglied = (id: number, name: string, entzogen = false, ich = false) => ({
  id,
  name,
  entzogen,
  ich,
});
const zeile = (zustaendigId: number | null, zustaendig: string, gepackt = false) => ({
  zustaendigId,
  zustaendig,
  gepackt,
});

test('the columns are the members with access, the free names by name, then nobody', () => {
  const spalten = packSpalten(
    [mitglied(1, 'Kim', false, true), mitglied(2, 'Alex', true), mitglied(3, 'Jo', true)],
    [
      zeile(null, 'Rover'),
      zeile(null, ' Bezirk  '),
      zeile(3, 'Jo'),
      zeile(null, 'Rover'),
      zeile(9, 'Weg'),
    ]
  );
  assert.deepEqual(
    spalten.map((s) => [s.key, s.name, s.zustaendigId, s.zustaendigText, s.ich]),
    [
      ['m:1', 'Kim', 1, '', true],
      // Without access, but still packs something
      ['m:3', 'Jo', 3, '', false],
      // A member the view lacks, named from the row
      ['m:9', 'Weg', 9, '', false],
      ['t:Bezirk', 'Bezirk', null, 'Bezirk', false],
      ['t:Rover', 'Rover', null, 'Rover', false],
      [NIEMAND, 'Niemand', null, '', false],
    ]
  );
});

test('a row belongs to the column of who packs it; sums count packed of all', () => {
  assert.equal(spalteVon(zeile(4, 'Kim')), 'm:4');
  assert.equal(spalteVon(zeile(null, '  Rover ')), 't:Rover');
  assert.equal(spalteVon(zeile(null, '')), NIEMAND);
  const zeilen = [zeile(4, 'Kim', true), zeile(4, 'Kim'), zeile(null, '', true)];
  assert.deepEqual(spaltenSumme(zeilen, 'm:4'), { gepackt: 1, gesamt: 2 });
  assert.deepEqual(spaltenSumme(zeilen, NIEMAND), { gepackt: 1, gesamt: 1 });
  assert.deepEqual(spaltenSumme(zeilen, 't:Rover'), { gepackt: 0, gesamt: 0 });
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
