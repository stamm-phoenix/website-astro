import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadCategories, filterDownloads } from '../src/lib/downloadsFilter';

const FILES = [
  { fileName: 'Packliste Sommerlager.pdf', category: 'Lager' },
  { fileName: 'Mitgliedsantrag DPSG.pdf', category: 'Anmeldung' },
  { fileName: 'Liederbuch.zip', category: 'Allgemein' },
  { fileName: 'Anmeldung Sommerlager.pdf', category: 'Anmeldung' },
];

test('topics are sorted and the default topic comes last', () => {
  assert.deepEqual(downloadCategories(FILES), ['Anmeldung', 'Lager', 'Allgemein']);
  assert.deepEqual(downloadCategories([]), []);
});

test('the search needs every word, ignores case and accents', () => {
  assert.deepEqual(
    filterDownloads(FILES, 'sommer ANMELDUNG', '').map((f) => f.fileName),
    ['Anmeldung Sommerlager.pdf']
  );
  assert.equal(filterDownloads(FILES, '  ', '').length, 4);
  assert.equal(filterDownloads(FILES, 'liederbuch', '').length, 1);
  assert.equal(filterDownloads(FILES, 'zelt', '').length, 0);
});

test('a topic narrows the list and combines with the search', () => {
  assert.equal(filterDownloads(FILES, '', 'Anmeldung').length, 2);
  assert.deepEqual(
    filterDownloads(FILES, 'sommerlager', 'Lager').map((f) => f.fileName),
    ['Packliste Sommerlager.pdf']
  );
  assert.equal(filterDownloads([{ fileName: 'a.pdf', category: '' }], '', 'Allgemein').length, 1);
});
