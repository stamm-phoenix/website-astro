import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aenderungText,
  beitrittUrl,
  datumKurz,
  planungUrl,
  tokenAusHash,
} from '../src/lib/essensplanung.ts';
import { fuerText, leseMenge, mengeFeld } from '../src/lib/essensplanungGerichte.ts';
import { mengeText } from '../../api/lib/essen-gerichte-model.ts';

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

test('amounts accept a comma and stay empty without a number', () => {
  assert.equal(leseMenge('1,5'), 1.5);
  assert.equal(leseMenge(' 200 '), 200);
  assert.equal(leseMenge(''), null);
  assert.ok(Number.isNaN(leseMenge('zwei')));
  assert.equal(mengeFeld(1.5), '1,5');
  assert.equal(mengeText(1500, 'g'), '1.500 g');
  assert.equal(mengeText(null, null), null);
});

test('a line names for whom it is only when not for everyone', () => {
  const zeile = {
    id: 1,
    etag: '',
    position: 1,
    planungZutatId: 1,
    menge: null,
    einheit: null,
    fest: false,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    ohne: [],
    nur: [],
    hinweis: '',
  };
  assert.equal(fuerText(zeile), null);
  assert.equal(fuerText({ ...zeile, fuerAlles: false }), 'nur vegetarisch, vegan');
});
