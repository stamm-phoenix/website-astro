import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  events,
  fieldsOf,
  form,
  input,
  installDom,
  reset,
  select,
  setFields,
} from './fixtures/rettungDom.ts';
import {
  acceptVersion,
  adoptKept,
  canAdopt,
  leftOverValues,
  fillAppeared,
  keepDialogInput,
  keptOnOpening,
  openedDialog,
  rescueNotice,
  restoreKept,
} from '../src/lib/dialogRettung.ts';
import {
  rescuedDialog,
  type GeretteterWert,
  type RescueField,
} from '../src/lib/geretteteEingaben.ts';
import { rescuePeople, rescueRowCount } from '../src/lib/taskRescue.ts';

// How an opened `EditDialog` keeps its input and fills it in again after the new login of the
// iPhone app, including the conflict with a newer saved version

let removeDom: () => void = () => {};
before(() => (removeDom = installDom()));
after(() => removeDom());
beforeEach(() => reset('/leitendenbereich/aufgaben'));

const NOW = Date.now();
const tick = (): Promise<void> => Promise.resolve();

function titled(value: string) {
  return form(input('Titel', { value }), input('Beschreibung', { value: 'Original' }));
}

test('a saved record is recognised by its version, not by values loaded later', () => {
  // Prices or names from the directory may arrive after the dialog opened
  const before = openedDialog('bestellung:5', 'Bestellstatus bearbeiten', 'v1', [
    '',
    'Lena Brandstaetter',
  ]);
  keepDialogInput(titled('42'), before, [], [], [], []);
  const after = openedDialog('bestellung:5', 'Bestellstatus bearbeiten', 'v1', [
    '45',
    'Lena Brandstätter',
  ]);
  assert.deepEqual(keptOnOpening(after, NOW)?.conflict, false);
  assert.equal(keptOnOpening(after, NOW)?.values[0].value, '42');
});

test('a new record is recognised by its visible starting values', () => {
  const empty = openedDialog('vorlage:neu', 'Vorlage', '', ['', '14']);
  keepDialogInput(titled('Zeltlager'), empty, [], [], [], []);
  assert.equal(
    keptOnOpening(openedDialog('vorlage:neu', 'Vorlage', '', ['', '14']), NOW)?.conflict,
    false
  );
  assert.equal(
    keptOnOpening(openedDialog('vorlage:neu', 'Vorlage', '', ['', '7']), NOW)?.conflict,
    true
  );
});

test('input for a version someone changed since is shown as a conflict, never filled in', () => {
  keepDialogInput(
    titled('My unsaved question'),
    openedDialog('frage:7', 'Frage bearbeiten', 'v1', []),
    [],
    [],
    [],
    []
  );
  const kept = keptOnOpening(openedDialog('frage:7', 'Frage bearbeiten', 'v2', []), NOW);
  assert.equal(kept?.conflict, true);
  assert.equal(kept?.values[0].value, 'My unsaved question');
  assert.equal(keptOnOpening(openedDialog('frage:8', 'Frage bearbeiten', 'v2', []), NOW), null);
  assert.equal(keptOnOpening(openedDialog(undefined, 'Frage bearbeiten', 'v1', []), NOW), null);
});

test('an adopted calendar entry that changed since makes the kept input a conflict', () => {
  const opening = openedDialog('aktion:neu:evt_Sola26', 'Veröffentlichen', '', ['']);
  const entry = [{ key: 'k1', version: 'e1' }];
  keepDialogInput(titled('Sola'), opening, [], [], [], entry);
  assert.equal(keptOnOpening(opening, NOW, () => 'e1')?.conflict, false);
  assert.equal(keptOnOpening(opening, NOW, () => 'e2')?.conflict, true);
});

test('a confirmed photo advances the version without making unsaved fields the baseline', () => {
  let opening = openedDialog('leitende:3', 'Photo bearbeiten', 'v1', []);
  opening = acceptVersion(opening, 'v1', 'v2');
  keepDialogInput(titled('Photo recovered'), opening, [], [], [], []);
  assert.equal(
    keptOnOpening(openedDialog('leitende:3', 'Photo bearbeiten', 'v2', []), NOW)?.conflict,
    false
  );
  // A write that started from another version leaves the opening alone
  assert.equal(acceptVersion(opening, 'v1', 'v3'), opening);
});

test('the hint names the dialog as it was titled when it opened', () => {
  const opening = openedDialog('leitende:1', 'Lena Brandstetter bearbeiten', 'v1', []);
  // The title follows the name field, but the list still shows the old name
  keepDialogInput(titled('Lena Brandstätter'), opening, [], [], [], []);
  assert.equal(rescuedDialog(NOW), 'Lena Brandstetter bearbeiten');
});

test('a person created in the open dialog keeps later input under the saved ID', () => {
  keepDialogInput(
    titled('Recovery edited person'),
    openedDialog('leitende:9', 'Person', 'v1', []),
    [],
    [],
    [],
    []
  );
  assert.equal(keptOnOpening(openedDialog('leitende:neu', 'Neue Person', '', ['']), NOW), null);
  assert.equal(
    keptOnOpening(openedDialog('leitende:9', 'Person', 'v1', []), NOW)?.values[0].value,
    'Recovery edited person'
  );
});

test('a dialog without a record keeps nothing', () => {
  assert.equal(
    keepDialogInput(titled('x'), openedDialog(undefined, 'Dialog', '', []), [], [], [], []),
    false
  );
});

interface Row {
  title: string;
}

/**
 * A template dialog whose rows are rendered from `rows`, like `AufgabenTemplateDialog`: a new
 * row gets a new field, existing rows keep theirs.
 */
function templateDialog(rows: Row[], title = '') {
  const state = { rows };
  const dialog = form(input('Titel', { value: title }));
  const render = (): void => {
    const [heading, ...fields] = fieldsOf(dialog);
    setFields(dialog, [
      heading,
      ...state.rows.map(
        (row, index) => fields[index] ?? input('Aufgabentitel', { value: row.title })
      ),
    ]);
  };
  render();
  const count = rescueRowCount(
    'Vorlagenaufgaben#custom',
    () => state.rows,
    (next) => {
      state.rows = next;
    },
    () => ({ title: '' })
  );
  return { dialog, state, render, count };
}

test('kept rows are added before their fields are filled in', async () => {
  // Row A was removed before the new login
  const kept = templateDialog([{ title: 'B' }, { title: 'C' }], 'Zeltlager');
  const opening = openedDialog('vorlage:4', 'Vorlage', 'v1', []);
  keepDialogInput(kept.dialog, opening, [], [], [kept.count], []);

  const again = templateDialog([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
  const values = keptOnOpening(opening, NOW)?.values ?? [];
  const rest = await restoreKept(again.dialog, [], values, [again.count], async () =>
    again.render()
  );
  assert.deepEqual(rest, []);
  assert.deepEqual(
    again.dialog.elements.map((field) => (field as unknown as { value: string }).value),
    ['Zeltlager', 'B', 'C']
  );
});

test('values of rows that do not exist yet wait and take their field when it appears', async () => {
  const kept = templateDialog([
    { title: 'Zelte prüfen' },
    { title: 'Einkauf planen' },
    { title: 'Bus buchen' },
  ]);
  const opening = openedDialog('vorlage:neu', 'Vorlage', '', ['']);
  keepDialogInput(kept.dialog, opening, [], [], [], []);

  // A new template has no row count to restore: one row comes back, two wait
  const again = templateDialog([{ title: '' }]);
  let pending = await restoreKept(
    again.dialog,
    [],
    keptOnOpening(opening, NOW)?.values ?? [],
    [],
    tick
  );
  assert.deepEqual(
    pending.map((value) => value.value),
    ['Einkauf planen', 'Bus buchen']
  );
  assert.equal(
    rescueNotice(false, true, pending.length),
    'Ein Teil deiner Eingaben von vor der neuen Anmeldung ist wieder eingesetzt. Den Rest findest du im Abschnitt „Noch nicht eingesetzt“.'
  );

  // „Vorlagenaufgabe hinzufügen“ twice
  again.state.rows = [...again.state.rows, { title: '' }, { title: '' }];
  again.render();
  pending = fillAppeared(again.dialog, [], pending, []);
  assert.deepEqual(pending, []);
  assert.deepEqual(
    again.dialog.elements.slice(1).map((field) => (field as unknown as { value: string }).value),
    ['Zelte prüfen', 'Einkauf planen', 'Bus buchen']
  );
});

test('selected people come back with their identities, not as the cleared search field', async () => {
  let people = [
    { name: 'Alex Beispiel', login: 'alex@example.test' },
    { name: 'Bea Beispiel', login: 'bea@example.test' },
  ];
  const field = rescuePeople(
    'Zuständige',
    () => people,
    (next) => (people = next)
  );
  const opening = openedDialog('aufgabe:neu', 'Aufgabe anlegen', '', ['']);
  keepDialogInput(form(input('Zuständigkeit')), opening, [], [], [field], []);
  people = [];
  const rest = await restoreKept(
    form(input('Zuständigkeit')),
    [],
    keptOnOpening(opening, NOW)?.values ?? [],
    [field],
    tick
  );
  assert.deepEqual(rest, []);
  assert.deepEqual(people, [
    { name: 'Alex Beispiel', login: 'alex@example.test' },
    { name: 'Bea Beispiel', login: 'bea@example.test' },
  ]);
});

test('a choice is filled in before the fields its handler changes', async () => {
  // Adopting a calendar entry sets its own Stufen; the kept Stufen must win afterwards
  const eintrag = select('Vorhandenen Kalendereintrag', ['', 'k1'], ['']);
  const rover = input('Rover', { type: 'checkbox' });
  const woe = input('Wölflinge', { type: 'checkbox' });
  eintrag.addEventListener('change', () => {
    rover.checked = true;
    woe.checked = true;
  });
  const dialog = form(eintrag, rover, woe);
  const order = events(eintrag, rover, woe);
  const rest = await restoreKept(
    dialog,
    [],
    [
      { key: 'Rover#0', kind: 'checked', value: 'true' },
      { key: 'Wölflinge#0', kind: 'checked', value: 'false' },
      { key: 'Vorhandenen Kalendereintrag#0', kind: 'value', value: 'k1' },
    ],
    [] as RescueField[],
    tick
  );
  assert.deepEqual(rest, []);
  assert.equal(order[0], '0:change');
  assert.deepEqual([rover.checked, woe.checked], [true, false]);
});

test('the notice says whether everything, a part or nothing was filled in', () => {
  assert.equal(rescueNotice(false, false, 0), null);
  assert.equal(
    rescueNotice(false, true, 0),
    'Deine Eingaben von vor der neuen Anmeldung sind wieder eingesetzt. Prüf sie und speichere.'
  );
  assert.match(rescueNotice(true, true, 2) ?? '', /^Dieser Eintrag wurde inzwischen geändert\./);
});

test('a conflict lists cleared fields and removed check marks too', () => {
  const pending: GeretteterWert[] = [
    { key: 'Frage#0', kind: 'value', value: '' },
    { key: 'Auf der Website veröffentlichen#0', kind: 'checked', value: 'false' },
    { key: 'Antwort#editor', kind: 'editor', value: '', format: 'html' },
  ];
  assert.deepEqual(leftOverValues(true, pending), pending);
  // Without a conflict an empty value has nothing to fill in later
  assert.deepEqual(leftOverValues(false, pending), []);
});

test('kept people of a conflicting task are adopted on request, other values only copied', () => {
  let people: { name: string; login: string }[] = [];
  const field = rescuePeople(
    'Aufgabe 1: Zuständige',
    () => people,
    (next) => (people = next)
  );
  const kept: GeretteterWert = {
    key: field.key,
    kind: 'custom',
    value: JSON.stringify([
      { name: 'Alex Beispiel', login: 'alex@example.test' },
      { name: 'Bea Beispiel', login: 'bea@example.test' },
    ]),
  };
  const title: GeretteterWert = { key: 'Titel#0', kind: 'value', value: 'Alt' };
  assert.equal(canAdopt(kept, [field]), true);
  assert.equal(canAdopt(title, [field]), false);
  assert.equal(adoptKept(title, [title, kept], [field]), null);

  const adopted = adoptKept(kept, [title, kept], [field]);
  assert.deepEqual(adopted, {
    pending: [title],
    notice: 'Aufgabe 1: Zuständige übernommen. Prüfe die Auswahl im Formular und speichere.',
  });
  assert.deepEqual(
    people.map((person) => person.login),
    ['alex@example.test', 'bea@example.test']
  );
  // A row count is restored on its own and never offered for adoption
  const rows = rescueRowCount(
    'Vorlagenaufgaben#custom',
    () => [1],
    () => {},
    () => 0
  );
  assert.equal(canAdopt({ key: rows.key, kind: 'custom', value: '2' }, [rows]), false);
  assert.equal(adoptKept({ ...kept, value: '{' }, [kept], [field]), null);
});
