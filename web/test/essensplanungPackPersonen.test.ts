import assert from 'node:assert/strict';
import test from 'node:test';
import { aenderungText } from '../src/lib/essensplanung.ts';
import {
  auswahlVon,
  personKey,
  personenAenderung,
  personenText,
  personenWahl,
} from '../src/lib/essensplanungPackliste.ts';
import { personenErfolg } from '../src/components/essensplanung/packSpeichern.ts';
import type { PackZuteilung } from '../src/lib/types.ts';

const person = (
  id: number,
  mitgliedId: number | null,
  name: string,
  gepackt = false
): PackZuteilung => ({ id, etag: '"1"', mitgliedId, name, gepackt });

const kochschuerze = {
  personen: [person(1, 1, 'Kim', true), person(2, 2, 'Alex'), person(3, null, 'Sam')],
};

test('a person is keyed like their column: a member by id, a free name by its merged name', () => {
  assert.equal(personKey(person(1, 4, 'Kim')), 'm:4');
  assert.equal(personKey(person(1, null, '  Rover  Team ')), 't:rover team');
  assert.equal(personenText(kochschuerze), 'Kim, Alex, Sam');
  assert.equal(personenText(kochschuerze, true), 'Kim (gepackt), Alex, Sam');
  assert.equal(personenText({ personen: [person(1, 1, 'Kim', true)] }, true), 'Kim');
});

test('members to choose: those with access, and those without who pack it already', () => {
  const mitglieder = [
    { id: 1, name: 'Kim', entzogen: false, ich: true },
    { id: 2, name: 'Ben', entzogen: true, ich: false },
  ];
  assert.deepEqual(personenWahl(mitglieder, null), [
    { id: 1, name: 'Kim', ich: true, ohneZugang: false },
  ]);
  assert.deepEqual(personenWahl(mitglieder, { personen: [person(5, 2, 'Ben')] }), [
    { id: 1, name: 'Kim', ich: true, ohneZugang: false },
    { id: 2, name: 'Ben', ich: false, ohneZugang: true },
  ]);
  // Those who do not manage the members get no removed ones in the view
  assert.deepEqual(personenWahl([mitglieder[0]], { personen: [person(5, 2, 'Ben')] }), [
    { id: 1, name: 'Kim', ich: true, ohneZugang: false },
    { id: 2, name: 'Ben', ich: false, ohneZugang: true },
  ]);
});

test('a choice saves only what changed from the row it started with', () => {
  assert.deepEqual(auswahlVon(kochschuerze), { mitglieder: [1, 2], namen: ['Sam'] });
  assert.deepEqual(personenAenderung(kochschuerze, auswahlVon(kochschuerze)), {
    mitglieder: [],
    namen: [],
    weg: [],
  });
  // „Alle“ adds the others, a name in another case is the same, unticked ones go
  assert.deepEqual(
    personenAenderung(kochschuerze, { mitglieder: [1, 3, 4], namen: ['SAM', 'Rover'] }),
    { mitglieder: [3, 4], namen: ['Rover'], weg: [2] }
  );
  assert.deepEqual(personenAenderung(kochschuerze, { mitglieder: [], namen: [] }), {
    mitglieder: [],
    namen: [],
    weg: [1, 2, 3],
  });
});

test('saving who packs says who packs it now', () => {
  assert.equal(personenErfolg('Topf', ['Kim'], [], 1), 'Kim packt Topf ein.');
  assert.equal(
    personenErfolg('Kochschürze', ['Kim', 'Alex', 'Sam'], [], 3),
    'Kim, Alex und Sam packen Kochschürze ein.'
  );
  assert.equal(
    personenErfolg('Topf', ['Kim'], ['Ben'], 1),
    'Kim packt Topf ein. Ben packt Topf nicht mehr ein.'
  );
  assert.equal(personenErfolg('Topf', [], ['Ben'], 0), 'Für Topf ist niemand mehr zuständig.');
});

test('changes of the packing list say what happened', () => {
  const text = (aktion: string, details: Record<string, unknown>) =>
    aenderungText({ seq: 1, at: '', wer: 'Kim', aktion, details });
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', gepackt: true }),
    'Kim hat eingepackt: Gaskocher'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', gepackt: false }),
    'Kim hat wieder ausgepackt: Gaskocher'
  );
  // A share: for someone else it is named
  assert.equal(
    text('packliste-geaendert', { name: 'Kochschürze', gepackt: true, fuer: 'Kim' }),
    'Kim hat eingepackt: Kochschürze'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Kochschürze', gepackt: true, fuer: 'Alex' }),
    'Kim hat für Alex eingepackt: Kochschürze'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Kochschürze', hinzu: ['Alex', 'Sam'] }),
    'Kim hat Alex, Sam zuständig gemacht: Kochschürze'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Kochschürze', weg: ['Sam'] }),
    'Kim hat Sam als zuständig entfernt: Kochschürze'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Kochschürze', hinzu: ['Alex'], weg: ['Sam'] }),
    'Kim hat geändert, wer einpackt: Kochschürze'
  );
  // Entries from before
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', zustaendig: 'Ben' }),
    'Kim hat Ben zuständig gemacht: Gaskocher'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', zustaendig: '' }),
    'Kim hat eine Zuständigkeit entfernt: Gaskocher'
  );
  assert.equal(
    text('packliste-neu', { name: 'Gaskocher' }),
    'Kim hat etwas auf die Packliste gesetzt: Gaskocher'
  );
});
