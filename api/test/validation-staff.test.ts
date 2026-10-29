import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  storedModulesSchema,
  validateChangelogSeen,
  validateStaffFavorites,
  validateStaffRecentVisit,
  validateStaffSettings,
} from '../lib/validation/staff';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const SETTINGS = 'Die Einstellung ist ungültig. Bitte lade die Seite neu und wähle sie erneut.';

test('settings keep only known keys with valid values, and nothing else may be sent', () => {
  assert.deepEqual(validateStaffSettings({ settings: { protokollText: 'markdown' } }), {
    protokollText: 'markdown',
  });
  assert.deepEqual(validateStaffSettings({ settings: { protokollText: 'formatiert' } }), {
    protokollText: 'formatiert',
  });
  for (const body of [
    null,
    [],
    {},
    { settings: null },
    { settings: 'markdown' },
    { settings: [] },
    { settings: {} },
    { settings: ['markdown'] },
    { settings: { protokollText: 'html' } },
    { settings: { protokollText: 1 } },
    { settings: { other: 'markdown' } },
    { settings: { protokollText: 'markdown', other: true } },
  ])
    assert.deepEqual(
      fields(() => validateStaffSettings(body)),
      { settings: SETTINGS },
      JSON.stringify(body)
    );
});

test('a visit is a path of the Leitendenbereich, without trailing slashes', () => {
  assert.equal(validateStaffRecentVisit({ module: '/leitendenbereich' }), '/leitendenbereich');
  assert.equal(
    validateStaffRecentVisit({ module: '/leitendenbereich/aufgaben/' }),
    '/leitendenbereich/aufgaben'
  );
  assert.equal(
    validateStaffRecentVisit({ module: '/leitendenbereich/abrechnung/a-1' }),
    '/leitendenbereich/abrechnung/a-1'
  );
  for (const body of [
    null,
    {},
    { module: 3 },
    { module: '' },
    { module: 'leitendenbereich/aufgaben' },
    { module: '/leitendenbereich/Aufgaben' },
    { module: '/leitendenbereich/a//b' },
    { module: '/leitendenbereich/a?x=1' },
    { module: 'https://example.test/leitendenbereich' },
    { module: '/leitendenbereich\n' },
  ])
    assert.deepEqual(
      fields(() => validateStaffRecentVisit(body)),
      { module: 'Der Bereich ist ungültig.' },
      JSON.stringify(body)
    );
});

test('the seen changelog entry is an entry ID', () => {
  const id = '2026-10-20-04-neuigkeiten';
  assert.equal(validateChangelogSeen({ lastSeenId: id }), id);
  for (const body of [
    null,
    {},
    { lastSeenId: 4 },
    { lastSeenId: '' },
    { lastSeenId: '2026-10-20-4-x' },
    { lastSeenId: `2026-10-20-04-${'a'.repeat(80)}` },
  ])
    assert.deepEqual(
      fields(() => validateChangelogSeen(body)),
      { lastSeenId: 'Die Neuigkeit ist ungültig.' },
      JSON.stringify(body)
    );
});

test('favorites are up to 50 distinct module paths', () => {
  assert.deepEqual(validateStaffFavorites({ modules: [] }), []);
  assert.deepEqual(
    validateStaffFavorites({
      modules: ['/leitendenbereich/aufgaben', '/leitendenbereich/', '/leitendenbereich/aufgaben'],
    }),
    ['/leitendenbereich/aufgaben', '/leitendenbereich/']
  );
  const many = Array.from({ length: 50 }, () => '/leitendenbereich/aufgaben');
  assert.equal(validateStaffFavorites({ modules: many }).length, 1);
  const message = 'Die Favoriten sind ungültig. Bitte lade die Seite neu und wähle sie erneut.';
  for (const body of [
    null,
    {},
    { modules: 'a' },
    { modules: [3] },
    { modules: ['/start'] },
    { modules: ['/leitendenbereich/aufgaben', null] },
    { modules: [...many, '/leitendenbereich/aufgaben'] },
    {
      modules: Array.from({ length: 51 }, (_, index) => `/leitendenbereich/modul-${index}`),
    },
  ])
    assert.deepEqual(
      fields(() => validateStaffFavorites(body)),
      { modules: message },
      JSON.stringify(body)?.slice(0, 80)
    );
});

test('stored modules keep the strings of a list and read anything else as empty', () => {
  assert.deepEqual(storedModulesSchema.parse(['a', 1, null, 'b', ['c'], {}]), ['a', 'b']);
  for (const value of [null, undefined, 'a', 4, {}, { 0: 'a' }])
    assert.deepEqual(storedModulesSchema.parse(value), [], String(value));
});
