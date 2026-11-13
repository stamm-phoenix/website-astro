import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  addOptions,
  events,
  form,
  input,
  installDom,
  reset,
  select,
  storage,
  textarea,
  visit,
  windowEvents,
} from './fixtures/rettungDom.ts';
import {
  RESCUE_EVENT,
  fillDialog,
  findRescue,
  forgetRescue,
  rescueDialog,
  rescueValues,
  rescuedDialog,
  rescuedLabel,
  shownValues,
  withoutEditedField,
  type GeretteterWert,
  type RescueEditor,
} from '../src/lib/geretteteEingaben.ts';
import { RESCUE_KEY } from '../src/lib/staffStorageKeys.ts';

// What the iPhone app keeps of a dialog across the new login, which reloads the page in the
// same tab (staff-app.spec.ts keeps one browser walk-through per kind of dialog)

let removeDom: () => void = () => {};
before(() => (removeDom = installDom()));
after(() => removeDom());
beforeEach(() => reset());

const NOW = Date.now();

function editor(label: string, text = '', format: 'html' | 'markdown' = 'html') {
  let value = text;
  const handle: RescueEditor & { value: () => string } = {
    format: () => format,
    label: () => label,
    get: () => value,
    set: (next) => (value = next),
    value: () => value,
  };
  return handle;
}

function gruppenstunde(alter = '', name = 'Alter') {
  return form(
    input(name, { value: alter, label: true }),
    input('Auf der Website veröffentlichen', { type: 'checkbox' }),
    input('Kennwort', { type: 'password', value: 'geheim' }),
    input('Foto', { type: 'file' }),
    input('id', { type: 'hidden', value: '12' })
  );
}

test('the input of a dialog comes back into the same dialog after the page reload', () => {
  const before = gruppenstunde('16 bis 20 Jahre');
  (before.elements[1] as unknown as { checked: boolean }).checked = true;
  const beschreibung = editor('Beschreibung', '<p>Neu: Hüttenwochenende.</p>');
  assert.equal(
    rescueDialog(before, 'gruppenstunde:12', 'Gruppenstunde Wölflinge bearbeiten', 'v1', [
      beschreibung,
    ]),
    true
  );

  // The reload renders the dialog again with the saved values
  const after = gruppenstunde('8 bis 10 Jahre');
  const neu = editor('Beschreibung', '<p>Alt</p>');
  const kept = findRescue('gruppenstunde:12', 'v1', NOW);
  assert.ok(kept);
  assert.deepEqual(fillDialog(after, [neu], kept), []);
  assert.equal((after.elements[0] as unknown as { value: string }).value, '16 bis 20 Jahre');
  assert.equal((after.elements[1] as unknown as { checked: boolean }).checked, true);
  assert.equal(neu.value(), '<p>Neu: Hüttenwochenende.</p>');
});

test('passwords, files and hidden fields are never kept', () => {
  rescueDialog(gruppenstunde('9'), 'gruppenstunde:12', 'Dialog', 'v1', []);
  const keys = findRescue('gruppenstunde:12', 'v1', NOW)?.map((kept) => kept.key);
  assert.deepEqual(keys, ['Alter#0', 'Auf der Website veröffentlichen#0']);
});

test('fields with the same label keep their own value in their order, like template rows', () => {
  const rows = form(
    input('Aufgabentitel', { value: 'Zelte prüfen' }),
    input('Tage vor der Aktion', { value: '10' }),
    input('Aufgabentitel', { value: 'Einkauf planen' }),
    input('Tage vor der Aktion', { value: '9' })
  );
  rescueDialog(rows, 'vorlage:neu', 'Vorlage', 'start', []);
  const kept = findRescue('vorlage:neu', 'start', NOW) ?? [];
  assert.deepEqual(
    kept.map((value) => [value.key, value.value]),
    [
      ['Aufgabentitel#0', 'Zelte prüfen'],
      ['Tage vor der Aktion#0', '10'],
      ['Aufgabentitel#1', 'Einkauf planen'],
      ['Tage vor der Aktion#1', '9'],
    ]
  );
  // Only the first row exists after the reload: the second waits for its fields
  const one = form(input('Aufgabentitel'), input('Tage vor der Aktion'));
  const rest = fillDialog(one, [], kept);
  assert.deepEqual(
    rest.map((value) => value.key),
    ['Aufgabentitel#1', 'Tage vor der Aktion#1']
  );
  assert.equal(rescuedLabel(rest[0]), 'Aufgabentitel');
});

test('the input of one record never lands in another record with the same dialog', () => {
  rescueDialog(
    gruppenstunde('Küche aufräumen', 'Titel'),
    'aufgabe:1',
    'Aufgabe bearbeiten',
    'v1',
    []
  );
  // Another task with the same title and the same values when opened
  assert.equal(findRescue('aufgabe:2', 'v1', NOW), null);
  assert.ok(findRescue('aufgabe:1', 'v1', NOW));
});

test('the input is kept only on its own page and for one hour', () => {
  rescueDialog(
    gruppenstunde('9'),
    'gruppenstunde:12',
    'Gruppenstunde Wölflinge bearbeiten',
    'v1',
    []
  );
  assert.equal(rescuedDialog(NOW), 'Gruppenstunde Wölflinge bearbeiten');
  visit('/leitendenbereich/gruppenstunden', '?ansicht=karte');
  assert.equal(rescuedDialog(NOW), null);
  assert.equal(findRescue('gruppenstunde:12', 'v1', NOW), null);
  visit('/leitendenbereich/gruppenstunden');
  assert.ok(findRescue('gruppenstunde:12', 'v1', NOW + 60 * 60 * 1000));
  assert.equal(findRescue('gruppenstunde:12', 'v1', NOW + 60 * 60 * 1000 + 60_000), null);
  // Expired input is deleted, not only hidden
  assert.equal(storage.getItem(RESCUE_KEY), null);
});

test('a different starting version is not filled in, but can be shown as a conflict', () => {
  rescueDialog(gruppenstunde('9'), 'frage:7', 'Frage bearbeiten', 'v1', []);
  assert.equal(findRescue('frage:7', 'v2', NOW), null);
  assert.deepEqual(
    findRescue('frage:7', null, NOW)?.map((kept) => kept.value),
    ['9', 'false']
  );
});

test('damaged kept input is dropped instead of filled in', () => {
  storage.setItem(RESCUE_KEY, JSON.stringify({ savedAt: NOW, path: location.pathname, fields: 3 }));
  assert.equal(findRescue('frage:7', null, NOW), null);
  assert.equal(storage.getItem(RESCUE_KEY), null);
  storage.setItem(RESCUE_KEY, '{kaputt');
  assert.equal(rescuedDialog(NOW), null);
});

test('when the browser cannot store the input, keeping it reports false', () => {
  storage.failing = true;
  assert.equal(rescueDialog(gruppenstunde('9'), 'gruppenstunde:12', 'Dialog', 'v1', []), false);
  assert.equal(rescueValues('frage:neu', 'Neue Frage', '', []), false);
});

test('forgetting ends only the own input and tells the hint above the page', () => {
  let told = 0;
  const listener = () => told++;
  windowEvents.addEventListener(RESCUE_EVENT, listener);
  try {
    rescueDialog(gruppenstunde('9'), 'aufgabe:1', 'Aufgabe bearbeiten', 'v1', []);
    // Opening and cancelling another task keeps the input of the first
    forgetRescue('aufgabe:2');
    assert.ok(findRescue('aufgabe:1', 'v1', NOW));
    assert.equal(told, 0);
    forgetRescue('aufgabe:1');
    assert.equal(findRescue('aufgabe:1', 'v1', NOW), null);
    assert.equal(rescuedDialog(NOW), null);
    assert.equal(told, 1);
  } finally {
    windowEvents.removeEventListener(RESCUE_EVENT, listener);
  }
});

test('a choice whose options are still loading waits instead of being cleared', () => {
  const kept: GeretteterWert[] = [{ key: 'Aktion#0', kind: 'value', value: 'evt_Sola26' }];
  const aktion = select('Aktion', ['']);
  const dialog = form(input('Titel'), aktion);
  assert.deepEqual(fillDialog(dialog, [], kept), kept);
  assert.equal(aktion.selectedOptions.length, 0);

  // Another login before the list arrived keeps the waiting choice, not the empty field
  rescueDialog(dialog, 'projekt:neu', 'Projekt', 'start', [], kept);
  const again = findRescue('projekt:neu', 'start', NOW) ?? [];
  assert.equal(again.find((value) => value.key === 'Aktion#0')?.value, 'evt_Sola26');

  addOptions(aktion, ['evt_Sola26', 'evt_Hike']);
  const seen = events(aktion);
  assert.deepEqual(fillDialog(dialog, [], again), []);
  assert.deepEqual(
    aktion.selectedOptions.map((option) => option.value),
    ['evt_Sola26']
  );
  assert.deepEqual(seen, ['0:change']);
});

test('a deliberate edit of a waiting field replaces its kept value', () => {
  const aktion = select('Aktion', ['']);
  const dialog = form(input('Titel'), aktion);
  const waiting: GeretteterWert[] = [{ key: 'Aktion#0', kind: 'value', value: 'evt_Sola26' }];
  assert.deepEqual(withoutEditedField(dialog, waiting, dialog.elements[0]), waiting);
  assert.deepEqual(withoutEditedField(dialog, waiting, aktion), []);
});

test('choices are filled in first, the other fields only in the second pass', () => {
  const stufe = select('Vorhandenen Kalendereintrag', ['', 'k1'], ['']);
  const rover = input('Rover', { type: 'checkbox' });
  const dialog = form(stufe, rover);
  const kept: GeretteterWert[] = [
    { key: 'Vorhandenen Kalendereintrag#0', kind: 'value', value: 'k1' },
    { key: 'Rover#0', kind: 'checked', value: 'true' },
  ];
  const seen = events(stufe, rover);
  const rest = fillDialog(dialog, [], kept, 'choices');
  assert.deepEqual(seen, ['0:change']);
  assert.deepEqual(rest, [kept[1]]);
  assert.deepEqual(fillDialog(dialog, [], rest), []);
  assert.equal(rover.checked, true);
});

test('editors wait for the second pass and while they are still loading', () => {
  const kept: GeretteterWert[] = [
    {
      key: 'Antwort#editor',
      kind: 'editor',
      value: '<p>Siehe <a href="https://example.org/treffpunkt">Karte</a></p>',
      format: 'html',
    },
  ];
  const antwort = editor('Antwort');
  const dialog = form(input('Frage'));
  assert.deepEqual(fillDialog(dialog, [antwort], kept, 'choices'), kept);
  assert.deepEqual(fillDialog(dialog, [], kept), kept);
  assert.deepEqual(fillDialog(dialog, [antwort], kept), []);
  assert.equal(antwort.value(), kept[0].value);
});

test('a removed check mark and a radio choice come back, an equal value fires nothing', () => {
  const box = input('Auf der Website veröffentlichen', { type: 'checkbox', checked: true });
  const bar = input('Zahlung', { type: 'radio' });
  const eigen = input('Zahlung', { type: 'radio', checked: true });
  const text = textarea('Notiz', 'gleich');
  const dialog = form(box, bar, eigen, text);
  const seen = events(box, bar, eigen, text);
  const rest = fillDialog(
    dialog,
    [],
    [
      { key: 'Auf der Website veröffentlichen#0', kind: 'checked', value: 'false' },
      { key: 'Zahlung#0', kind: 'checked', value: 'true' },
      { key: 'Zahlung#1', kind: 'checked', value: 'false' },
      { key: 'Notiz#0', kind: 'value', value: 'gleich' },
    ]
  );
  assert.deepEqual(rest, []);
  assert.equal(box.checked, false);
  assert.equal(bar.checked, true);
  assert.deepEqual(seen, ['0:change', '1:change']);
});

test('only values worth showing are listed as not filled in', () => {
  const values: GeretteterWert[] = [
    { key: 'Frage#0', kind: 'value', value: '' },
    { key: 'Veröffentlichen#0', kind: 'checked', value: 'false' },
    { key: 'Zuständige#custom', kind: 'custom', value: '[]', display: '' },
    { key: 'Titel#0', kind: 'value', value: 'Zelte' },
  ];
  assert.deepEqual(
    shownValues(values).map((kept) => kept.key),
    ['Titel#0']
  );
  assert.equal(rescuedLabel(values[2]), 'Zuständige');
});
