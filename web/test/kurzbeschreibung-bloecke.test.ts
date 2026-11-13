import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ZEITBLOECKE_PRO_TAG } from '../src/lib/kurzbeschreibung.ts';
import type { ZeitBlock, ZeitplanTag } from '../src/lib/kurzbeschreibung.ts';
import { dropBlock, ensureTage, moveBlock } from '../src/lib/kurzbeschreibungBloecke.ts';

const block = (id: string): ZeitBlock => ({ id, von: '', bis: '', text: id });
const day = (datum: string, ...ids: string[]): ZeitplanTag => ({ datum, bloecke: ids.map(block) });
const ids = (tag: ZeitplanTag): string[] => tag.bloecke.map((b) => b.id);

test('ensureTage keeps the shown days only with the first change', () => {
  const kurz = { tage: [] as ZeitplanTag[] };
  const shown = [day('2027-05-01', 'x'), day('2027-05-02')];
  const tage = ensureTage(kurz, shown);
  assert.deepEqual(
    tage.map((t) => [t.datum, t.bloecke.length]),
    [
      ['2027-05-01', 0],
      ['2027-05-02', 0],
    ]
  );
  assert.equal(ensureTage(kurz, []), tage);
});

test('moveBlock moves inside a day and over the edge to the next or previous day', () => {
  const days = [day('2027-05-01', 'a', 'b'), day('2027-05-02', 'c')];
  assert.equal(moveBlock(days, 0, 0, 1).kind, 'moved');
  assert.deepEqual(ids(days[0]), ['b', 'a']);
  moveBlock(days, 0, 1, 1);
  assert.deepEqual(ids(days[0]), ['b']);
  assert.deepEqual(ids(days[1]), ['a', 'c']);
  moveBlock(days, 1, 0, -1);
  assert.deepEqual(ids(days[0]), ['b', 'a']);
  assert.deepEqual(ids(days[1]), ['c']);
});

test('moveBlock refuses a full neighbour day and changes nothing', () => {
  const full = Array.from({ length: MAX_ZEITBLOECKE_PRO_TAG }, (_, i) => `f${i}`);
  const days = [day('2027-05-01', 'a'), day('2027-05-02', ...full)];
  assert.deepEqual(moveBlock(days, 0, 0, 1), { kind: 'full', datum: '2027-05-02' });
  assert.deepEqual(ids(days[0]), ['a']);
  assert.equal(days[1].bloecke.length, MAX_ZEITBLOECKE_PRO_TAG);
});

test('dropBlock places before the index and restores when the other day is full', () => {
  const days = [day('2027-05-01', 'a', 'b', 'c'), day('2027-05-02', 'd')];
  assert.equal(dropBlock(days, { tagIndex: 0, index: 0 }, { tagIndex: 0, index: 3 }), true);
  assert.deepEqual(ids(days[0]), ['b', 'c', 'a']);
  assert.equal(dropBlock(days, { tagIndex: 0, index: 0 }, { tagIndex: 1, index: 0 }), true);
  assert.deepEqual(ids(days[1]), ['b', 'd']);
  const full = Array.from({ length: MAX_ZEITBLOECKE_PRO_TAG }, (_, i) => `f${i}`);
  const other = [day('2027-05-01', 'a'), day('2027-05-02', ...full)];
  assert.equal(dropBlock(other, { tagIndex: 0, index: 0 }, { tagIndex: 1, index: 0 }), false);
  assert.deepEqual(ids(other[0]), ['a']);
});
