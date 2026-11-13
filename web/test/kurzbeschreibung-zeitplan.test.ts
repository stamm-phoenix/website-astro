import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ZEITPLAN_HEADER,
  placeZeitplan,
  type ZeitplanItem,
} from '../src/lib/kurzbeschreibungZeitplan';

/** Heading of a day followed by `blocks` blocks of 10 mm. */
function tag(index: number, blocks: number): ZeitplanItem[] {
  return [
    { tag: index, header: true, zeit: '', lines: [], height: ZEITPLAN_HEADER },
    ...Array.from({ length: blocks }, () => ({
      tag: index,
      header: false,
      zeit: '10:00',
      lines: ['Programm'],
      height: 10,
    })),
  ];
}

test('a short Zeitplan stays in the first column of the first page', () => {
  const placed = placeZeitplan([...tag(0, 3), ...tag(1, 2)], 3, 60, 200);
  assert.ok(placed);
  assert.deepEqual(new Set(placed.map((item) => item.page)), new Set([1]));
  assert.equal(placed[0].column, 0);
  assert.equal(placed[0].y, 60);
  assert.ok(placed.every((item) => !item.continued));
});

test('a day that does not fit goes on in the next column with its heading repeated', () => {
  const placed = placeZeitplan(tag(0, 6), 2, 60, 40);
  assert.ok(placed);
  const second = placed.filter((item) => item.column === 1);
  assert.ok(second.length > 0);
  assert.equal(second[0].continued, true);
});

test('it reports that the Zeitplan does not fit on the page it is limited to', () => {
  assert.equal(placeZeitplan(tag(0, 40), 3, 60, 100, 1), null);
});

test('without a limit the Zeitplan goes on to further pages', () => {
  const placed = placeZeitplan(tag(0, 40), 3, 60, 100);
  assert.ok(placed);
  assert.ok(Math.max(...placed.map((item) => item.page)) > 1);
});
