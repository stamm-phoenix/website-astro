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
import { leseFaktor, mahlzeitStand, tagStand } from '../../api/lib/essen-planung-model.ts';
import { faktorFeld, faktorText } from '../src/lib/essensplanungEinplanung.ts';

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

test('changes of participants and groups at a meal read apart', () => {
  const text = (aktion: string, details: Record<string, unknown>) =>
    aenderungText({ seq: 3, at: '', wer: 'Kim', aktion, details });
  assert.equal(
    text('teilnehmende-neu', { name: 'Wö', anzahl: 10 }),
    'Kim hat Teilnehmende hinzugefügt: 10 Wö'
  );
  assert.equal(
    text('teilnehmende-geloescht', { name: 'Wö', anzahl: 10 }),
    'Kim hat Teilnehmende entfernt: 10 Wö'
  );
  assert.equal(
    text('mahlzeit-gruppen', { name: 'Frühstück', datum: '2027-08-01', gruppe: 'Wö', isst: false }),
    'Kim nimmt eine Gruppe aus einer Mahlzeit: Wö bei Frühstück (So., 1.8.2027)'
  );
  assert.equal(
    text('mahlzeit-gruppen', { name: 'Frühstück', datum: '2027-08-01', gruppe: 'Wö', isst: true }),
    'Kim lässt eine Gruppe mitessen: Wö bei Frühstück (So., 1.8.2027)'
  );
});

test('amounts accept a comma and stay empty without a number', () => {
  assert.equal(leseMenge('1,5'), 1.5);
  assert.equal(leseMenge(' 200 '), 200);
  assert.equal(leseMenge('1.500'), 1500);
  assert.equal(leseMenge('1.500,5'), 1500.5);
  assert.equal(leseMenge('1.5'), 1.5);
  assert.equal(leseMenge('0.250'), 0.25);
  assert.ok(Number.isNaN(leseMenge('1.50.0')));
  assert.equal(leseMenge(''), null);
  assert.ok(Number.isNaN(leseMenge('zwei')));
  assert.equal(mengeFeld(1.5), '1,5');
  assert.equal(mengeText(1500, 'g'), '1.500 g');
  assert.equal(mengeText(null, null), null);
  assert.equal(mengeText(2, 'kg', true), '2 kg (ATG)');
  assert.equal(mengeText(3, 'stueck', true), '3 Stück');
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

test('planned dishes read with factor, place and the delete versions', () => {
  assert.equal(faktorText(1), '');
  assert.equal(faktorText(0.5), '×0,5');
  assert.equal(faktorFeld(1.25), '1,25');
  assert.equal(leseFaktor('0,5'), 0.5);
  assert.ok(Number.isNaN(leseFaktor('halb')));
  assert.equal(
    aenderungText({
      seq: 3,
      at: '',
      wer: 'Kim',
      aktion: 'einplanung-geaendert',
      details: { name: 'Chili', mahlzeit: 'Abendessen', datum: '2027-08-01', verschoben: true },
    }),
    'Kim hat ein Gericht verschoben: Chili bei Abendessen (So., 1.8.2027)'
  );
  const einplanung = (etag: string) => ({
    id: 1,
    etag,
    gerichtId: 1,
    position: 1,
    faktor: 1,
    zustaendigId: null,
    zustaendig: '',
  });
  const mahlzeit = {
    id: 1,
    etag: '"0000000000000002"',
    position: 1,
    kennung: '1_1',
    name: 'Frühstück',
    uhrzeit: null,
    einplanungen: [einplanung('"0000000000000005"')],
    ohneGruppen: [],
  };
  assert.equal(mahlzeitStand(mahlzeit), '"0000000000000005"');
  assert.equal(
    tagStand({ id: 1, etag: '"0000000000000009"', datum: '', nummer: 1, mahlzeiten: [mahlzeit] }),
    '"0000000000000009"'
  );
});
