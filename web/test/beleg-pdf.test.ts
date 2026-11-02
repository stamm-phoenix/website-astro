import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gezeigteSeiten,
  isPdfFile,
  MAX_BELEG_CHECK_PAGES,
  MAX_BELEG_SHOWN_PAGES,
  pruefSeiten,
  weiterePruefSeiten,
} from '../src/lib/belegPdf';

test('the check reads every page of a short PDF', () => {
  assert.deepEqual(pruefSeiten(1), [0]);
  assert.deepEqual(pruefSeiten(3), [0, 1, 2]);
  assert.deepEqual(pruefSeiten(MAX_BELEG_CHECK_PAGES), [0, 1, 2, 3, 4]);
});

test('of a long PDF the check reads the first pages and the last, with the total', () => {
  assert.deepEqual(pruefSeiten(9), [0, 1, 2, 3, 8]);
  assert.equal(pruefSeiten(9).length, MAX_BELEG_CHECK_PAGES);
});

test('the further pages to check leave out the first, which is the photo', () => {
  assert.deepEqual(weiterePruefSeiten([]), []);
  assert.deepEqual(weiterePruefSeiten(['s2']), ['s2']);
  const weitere = ['s2', 's3', 's4', 's5', 's6', 's7'];
  assert.deepEqual(weiterePruefSeiten(weitere), ['s2', 's3', 's4', 's7']);
});

test('a very long PDF shows only its first pages', () => {
  assert.equal(gezeigteSeiten(3), 3);
  assert.equal(gezeigteSeiten(MAX_BELEG_SHOWN_PAGES + 5), MAX_BELEG_SHOWN_PAGES);
});

test('a PDF is recognised by its type or its name', () => {
  assert.equal(isPdfFile(new File([], 'Rechnung.PDF')), true);
  assert.equal(isPdfFile(new File([], 'x', { type: 'application/pdf' })), true);
  assert.equal(isPdfFile(new File([], 'foto.jpg', { type: 'image/jpeg' })), false);
});

test('of a PDF longer than shown the check reads its real last page', () => {
  // 25 pages: 2 to 20 are shown, page 25 is drawn only for the check
  const weitere = Array.from({ length: MAX_BELEG_SHOWN_PAGES - 1 }, (_, i) => `s${i + 2}`);
  assert.deepEqual(weiterePruefSeiten(weitere, 's25'), ['s2', 's3', 's4', 's25']);
  assert.deepEqual(weiterePruefSeiten(['s2', 's3'], null), ['s2', 's3']);
});
