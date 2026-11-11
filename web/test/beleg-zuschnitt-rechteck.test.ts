import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  eckenVon,
  griffPunkt,
  istRechteck,
  rechteckUm,
  ziehen,
} from '../src/lib/belegZuschnittRechteck';
import type { Quad } from '../src/lib/belegScan';

const SCHRAEG: Quad = [
  { x: 110, y: 90 },
  { x: 700, y: 120 },
  { x: 680, y: 1000 },
  { x: 90, y: 980 },
];

describe('rechteckiger Zuschnitt', () => {
  test('starts as the smallest rectangle around the free corners', () => {
    const r = rechteckUm(SCHRAEG, 800, 1200);
    assert.deepEqual(r, { links: 90, oben: 90, rechts: 700, unten: 1000 });
    assert.equal(istRechteck(eckenVon(r)), true);
    assert.equal(istRechteck(SCHRAEG), false);
  });

  test('corners on one line start from the whole image', () => {
    const linie: Quad = [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
      { x: 20, y: 5 },
      { x: 30, y: 5 },
    ];
    assert.deepEqual(rechteckUm(linie, 800, 1200), { links: 0, oben: 0, rechts: 800, unten: 1200 });
  });

  test('a corner moves two edges, a side one', () => {
    const start = { links: 100, oben: 100, rechts: 500, unten: 700 };
    assert.deepEqual(ziehen(start, 'nw', -20, 30, 800, 1200), { ...start, links: 80, oben: 130 });
    assert.deepEqual(ziehen(start, 'e', 50, 999, 800, 1200), { ...start, rechts: 550 });
    assert.deepEqual(ziehen(start, 's', 0, -40, 800, 1200), { ...start, unten: 660 });
  });

  test('edges stay inside the image and apart', () => {
    const start = { links: 100, oben: 100, rechts: 500, unten: 700 };
    assert.equal(ziehen(start, 'w', -500, 0, 800, 1200).links, 0);
    // 5 % of the longer side keeps the rectangle from collapsing or turning over
    assert.equal(ziehen(start, 'w', 1000, 0, 800, 1200).links, 440);
    assert.deepEqual(ziehen(start, 'se', 5000, 5000, 800, 1200), {
      ...start,
      rechts: 800,
      unten: 1200,
    });
  });

  test('moving keeps the size and stops at the image edge', () => {
    const start = { links: 100, oben: 100, rechts: 500, unten: 700 };
    assert.deepEqual(ziehen(start, 'mitte', 50, -20, 800, 1200), {
      links: 150,
      oben: 80,
      rechts: 550,
      unten: 680,
    });
    assert.deepEqual(ziehen(start, 'mitte', 1000, 1000, 800, 1200), {
      links: 400,
      oben: 600,
      rechts: 800,
      unten: 1200,
    });
  });

  test('handles sit on the corners and in the middle of the sides', () => {
    const r = { links: 100, oben: 100, rechts: 500, unten: 700 };
    assert.deepEqual(griffPunkt(r, 'ne'), { x: 500, y: 100 });
    assert.deepEqual(griffPunkt(r, 'w'), { x: 100, y: 400 });
    assert.deepEqual(griffPunkt(r, 's'), { x: 300, y: 700 });
  });
});
