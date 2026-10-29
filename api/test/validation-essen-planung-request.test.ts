import assert from 'node:assert/strict';
import test from 'node:test';
import { readEtag, readGemeinsamerLink, readRolle, readTagId } from '../lib/essen-planung-request';
import { fields } from './fixtures/essen-fields';

const VERSION_FEHLT = 'Die Version fehlt. Bitte lade die Seite neu.';

test('Etag: the body wins over the If-Match header', () => {
  assert.equal(readEtag({ etag: '"abc"' }, '"header"'), '"abc"');
  assert.equal(readEtag({ etag: 'W/"abc"' }, null), 'W/"abc"');
  assert.equal(readEtag(null, '"header"'), '"header"');
  assert.equal(readEtag({}, '"header"'), '"header"');
  assert.equal(readEtag({ etag: '', other: 1 }, '"header"'), '"header"');
  assert.equal(readEtag({ etag: 5 }, '"header"'), '"header"');
});

test('Etag: only a quoted version is valid', () => {
  for (const body of [
    null,
    {},
    { etag: 'abc' },
    { etag: '""' },
    { etag: '"a\nb"' },
    { etag: '"a"x' },
    { etag: 'w/"a"' },
    { etag: 7 },
  ]) {
    assert.deepEqual(
      fields(() => readEtag(body, null)),
      { etag: VERSION_FEHLT }
    );
  }
  assert.deepEqual(
    fields(() => readEtag({}, '')),
    { etag: VERSION_FEHLT }
  );
  // A broken version in the body is not replaced by a good header
  assert.deepEqual(
    fields(() => readEtag({ etag: 'abc' }, '"header"')),
    { etag: VERSION_FEHLT }
  );
});

test('Rolle: owner or editor, nothing else', () => {
  assert.equal(readRolle({ rolle: 'besitzer' }), 'besitzer');
  assert.equal(readRolle({ rolle: 'bearbeiten' }), 'bearbeiten');
  for (const body of [null, {}, { rolle: 'lesen' }, { rolle: '' }, { rolle: 3 }, { rolle: null }]) {
    assert.deepEqual(
      fields(() => readRolle(body)),
      { rolle: 'Bitte eine Rolle wählen.' }
    );
  }
});

test('Shared link: which link and on or off', () => {
  assert.deepEqual(readGemeinsamerLink({ art: 'lesen', an: true }), { art: 'lesen', an: true });
  assert.deepEqual(readGemeinsamerLink({ art: 'beitritt', an: false, x: 1 }), {
    art: 'beitritt',
    an: false,
  });
  const message = { art: 'Bitte angeben, welcher Link erzeugt oder abgeschaltet wird.' };
  for (const body of [
    null,
    {},
    { art: 'lesen' },
    { an: true },
    { art: 'anders', an: true },
    { art: 'lesen', an: 'true' },
    { art: 'lesen', an: 1 },
    { art: 'lesen', an: null },
    { art: 3, an: 3 },
  ]) {
    assert.deepEqual(
      fields(() => readGemeinsamerLink(body)),
      message
    );
  }
});

test('Day ID: an integer, else 0', () => {
  assert.equal(readTagId({ tagId: 12 }), 12);
  assert.equal(readTagId({ tagId: -3 }), -3);
  assert.equal(readTagId({ tagId: 0 }), 0);
  for (const tagId of [1.5, '12', null, undefined, true, {}, [3], NaN, Infinity]) {
    assert.equal(readTagId({ tagId }), 0);
  }
  assert.equal(readTagId({}), 0);
  assert.equal(readTagId(null), 0);
});
