import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySession, parseSession } from '../lib/abrechnung-session';

// parseSession is shared with the browser (the draft store), so it stays free of zod; these
// tests pin its leniency: whatever does not fit is left empty instead of rejected.

const PERSON = {
  id: 'extra-1',
  lastName: 'Muster',
  firstName: 'Erika',
  gender: 'w',
  age: 24,
  plz: '83620',
  herkunft: 'landkreis',
  betreuer: false,
};

test('parseSession reads anything but an object as an empty session', () => {
  for (const value of [undefined, null, 'x', 5, [], [{ zusatztag: true }]]) {
    assert.deepEqual(parseSession(value), emptySession());
  }
});

test('parseSession keeps only the entries of the maps that fit', () => {
  const session = parseSession({
    zusatztag: 'ja',
    excluded: { a: true, b: false, c: 1 },
    betreuer: { a: true, b: 'true' },
    plz: { a: '83620', b: 83620, c: null },
    betraege: { a: -5, b: 1.5, c: '3', d: 0 },
    leihgebuehren: {
      ok: { count: 2, days: null },
      days: { count: 0, days: 3 },
      noDays: { count: 1 },
      negative: { count: -1, days: null },
      fraction: { count: 1.5, days: null },
      text: 'x',
    },
    kjr: { ort: 'Haus', plz: 5, beginn: '08:00' },
    deckblatt: 'x',
  });
  assert.equal(session.zusatztag, false);
  assert.deepEqual(session.excluded, { a: true });
  assert.deepEqual(session.betreuer, { a: true });
  assert.deepEqual(session.plz, { a: '83620' });
  assert.deepEqual(session.betraege, { a: -5, d: 0 });
  assert.deepEqual(session.leihgebuehren, {
    ok: { count: 2, days: null },
    days: { count: 0, days: 3 },
  });
  assert.deepEqual(session.kjr, { ort: 'Haus', plz: '', beginn: '08:00', ende: '' });
  assert.deepEqual(session.deckblatt, { vorkalkulation: '', kalkulation: '' });
});

test('parseSession drops the added persons that do not fit and keeps ort only when it is a string', () => {
  const bad = [
    { ...PERSON, id: 'x-1' },
    { ...PERSON, id: 5 },
    { ...PERSON, gender: 'x' },
    { ...PERSON, herkunft: 'mars' },
    { ...PERSON, age: undefined },
    { ...PERSON, age: -1 },
    { ...PERSON, age: 1.5 },
    { ...PERSON, ort: 4 },
    { ...PERSON, betreuer: 'ja' },
    { ...PERSON, plz: null },
    null,
    'x',
  ];
  const session = parseSession({
    extra: [...bad, PERSON, { ...PERSON, id: 'extra-2', age: null, gender: '', ort: undefined }],
  });
  assert.deepEqual(session.extra, [PERSON, { ...PERSON, id: 'extra-2', age: null, gender: '' }]);
  assert.deepEqual(parseSession({ extra: [{ ...PERSON, ort: 'Rosenheim' }] }).extra, [
    { ...PERSON, ort: 'Rosenheim' },
  ]);
  assert.deepEqual(parseSession({ extra: 'x' }).extra, []);
});

test('parseSession cleans the Kurzbeschreibung and bounds its days and blocks', () => {
  const block = { id: 'b-1', von: '08:00', bis: '', text: 'Frühstück' };
  const tag = { datum: '2026-07-01', bloecke: [block] };
  const session = parseSession({
    kurzbeschreibung: {
      einleitung: 'x'.repeat(2001),
      tage: [
        tag,
        { datum: '1.7.2026', bloecke: [] },
        { datum: '2026-07-02', bloecke: 'x' },
        { datum: '2026-07-03' },
        {
          datum: '2026-07-04',
          bloecke: [
            block,
            { ...block, id: '<x>' },
            { ...block, von: '8 Uhr' },
            { ...block, bis: '24:00' },
            { ...block, text: 'x'.repeat(201) },
            { ...block, text: 5 },
            null,
          ],
        },
      ],
    },
  });
  assert.equal(session.kurzbeschreibung.einleitung, '');
  assert.deepEqual(session.kurzbeschreibung.tage, [
    tag,
    { datum: '2026-07-02', bloecke: [] },
    { datum: '2026-07-03', bloecke: [] },
    { datum: '2026-07-04', bloecke: [block] },
  ]);
  const many = Array.from({ length: 40 }, (_, i) => ({
    datum: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
    bloecke: Array.from({ length: 40 }, (_, n) => ({ ...block, id: `b${n}` })),
  }));
  const bounded = parseSession({ kurzbeschreibung: { einleitung: 'ok', tage: many } });
  assert.equal(bounded.kurzbeschreibung.einleitung, 'ok');
  assert.equal(bounded.kurzbeschreibung.tage.length, 31);
  assert.equal(bounded.kurzbeschreibung.tage[0].bloecke.length, 30);
  assert.deepEqual(parseSession({ kurzbeschreibung: 'x' }).kurzbeschreibung, {
    einleitung: '',
    tage: [],
  });
  assert.deepEqual(parseSession({ kurzbeschreibung: { tage: 5 } }).kurzbeschreibung, {
    einleitung: '',
    tage: [],
  });
});
