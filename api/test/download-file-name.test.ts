import assert from 'node:assert/strict';
import test from 'node:test';
import { renamedDownloadFileName } from '../lib/download-file-name';
import { checkFileName, downloadMimeType } from '../lib/validation/downloads';

test('punctuation and dates keep the original PDF extension and content type', () => {
  for (const name of ['Anmeldung 1. Advent', 'Anmeldung 20.10.2026', 'Anmeldung']) {
    const result = renamedDownloadFileName(name, 'Anmeldung.pdf');
    assert.equal(result, `${name}.pdf`);
    assert.equal(checkFileName(result), undefined);
    assert.equal(downloadMimeType(result), 'application/pdf');
  }
  assert.equal(renamedDownloadFileName('Anmeldung.PDF', 'Vorlage.pdf'), 'Anmeldung.PDF');
  assert.equal(renamedDownloadFileName('Text.txt', 'Vorlage.pdf'), 'Text.txt');
  assert.equal(renamedDownloadFileName('Route.gpx', 'Alt.gpx'), 'Route.gpx');
});
