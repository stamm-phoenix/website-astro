import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aenderungText,
  beitrittUrl,
  datumKurz,
  planungUrl,
  tokenAusHash,
} from '../src/lib/essensplanung.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ01234-_';

test('tokens are read only from the expected fragment parameter', () => {
  assert.equal(tokenAusHash(`#t=${TOKEN}`, 't'), TOKEN);
  assert.equal(tokenAusHash(`#t=${TOKEN}`, 'b'), null);
  assert.equal(tokenAusHash('#t=zu-kurz', 't'), null);
  assert.equal(tokenAusHash('', 't'), null);
});

test('links carry the token in the fragment and round-trip', () => {
  const url = new URL(planungUrl(TOKEN, 'https://example.org'));
  assert.equal(url.pathname, '/essensplanung/planung');
  assert.equal(url.search, '');
  assert.equal(tokenAusHash(url.hash, 't'), TOKEN);
  assert.equal(tokenAusHash(new URL(beitrittUrl(TOKEN, 'https://example.org')).hash, 'b'), TOKEN);
});

test('changes read as a sentence with name and day', () => {
  assert.equal(datumKurz('2027-08-01'), 'So., 1.8.2027');
  assert.equal(
    aenderungText({
      seq: 1,
      at: '2027-07-01T10:00:00Z',
      wer: 'Kim',
      aktion: 'mahlzeit-geaendert',
      details: { name: 'Brunch', datum: '2027-08-01' },
    }),
    'Kim hat eine Mahlzeit geändert: Brunch (So., 1.8.2027)'
  );
  assert.equal(
    aenderungText({
      seq: 2,
      at: '',
      wer: '',
      aktion: 'mitglied-beigetreten',
      details: { name: 'Kim' },
    }),
    'Jemand ist beigetreten'
  );
});
