import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { anwesenheitListe, anwesenheitReport } from '../src/lib/anwesenheitPdf';
import type { AnwesenheitChild, AnwesenheitMeeting } from '../src/lib/types';

function meeting(date: string, extra: Partial<AnwesenheitMeeting> = {}): AnwesenheitMeeting {
  return {
    stufe: 'Wölflinge',
    date,
    members: 4,
    excused: 1,
    guests: 0,
    notes: '',
    cancelled: false,
    ...extra,
  };
}

const MEETINGS = [
  meeting('2026-10-02', { members: 5, guests: 1, notes: 'Knoten geübt 🪢' }),
  meeting('2026-10-09', { members: 2 }),
  meeting('2026-10-16', { cancelled: true, members: 0, excused: 0, notes: 'Ferien' }),
  meeting('2026-09-25', { members: 6, excused: 0 }),
  meeting('2025-12-05', { members: 3 }),
  meeting('2026-10-02', { stufe: 'Rover', members: 9 }),
];

describe('anwesenheitReport', () => {
  const report = anwesenheitReport('Wölflinge', MEETINGS);

  test('names the Stufe and the months it covers', () => {
    assert.equal(report.title, 'Anwesenheit Wölflinge');
    assert.equal(report.subtitle, 'Gruppenstunden von Dezember 2025 bis Oktober 2026');
    assert.equal(report.fileName, 'Anwesenheit Wölflinge 2025-2026.pdf');
  });

  test('has one table per year, newest first, with its sums and the average of held ones', () => {
    assert.deepEqual(
      report.sections.map((section) => section.heading),
      ['2026', '2025', 'Gesamt', 'Gruppenstunden']
    );
    const [year] = report.sections;
    assert.deepEqual(year.rows, [
      ['Oktober 2026', '2', '3,5', '7', '2', '1', '1'],
      ['September 2026', '1', '6', '6', '0', '0', '0'],
    ]);
    assert.deepEqual(year.foot, [['Summe 2026', '3', '4,3', '13', '2', '1', '1']]);
    assert.deepEqual(report.sections[2].foot, [['2025 bis 2026', '4', '4', '16', '3', '1', '1']]);
  });

  test('lists every Gruppenstunde of the Stufe with what they did, without emoji', () => {
    const list = report.sections.at(-1)!;
    assert.equal(list.rows?.length, 5);
    assert.deepEqual(list.rows?.[0], ['Fr., 16.10.2026', '–', '–', '–', 'Ausgefallen: Ferien']);
    assert.deepEqual(list.rows?.[2], ['Fr., 02.10.2026', '5', '1', '1', 'Knoten geübt']);
  });

  test('a single year has no overall sum', () => {
    const single = anwesenheitReport('Rover', MEETINGS);
    assert.deepEqual(
      single.sections.map((section) => section.heading),
      ['2026', 'Gruppenstunden']
    );
    assert.equal(single.fileName, 'Anwesenheit Rover 2026.pdf');
  });
});

describe('anwesenheitListe', () => {
  const children: AnwesenheitChild[] = [
    { kind: 'stufe', id: '1', firstName: 'Anna', lastName: 'Test', status: 'anwesend' },
    { kind: 'unbekannt', id: '2', status: 'anwesend' },
    { kind: 'stufe', id: '3', firstName: 'Ben', lastName: 'Beispiel', status: 'abwesend' },
  ];
  const liste = anwesenheitListe('Wölflinge', '2026-10-23', children);

  test('names the Stufe and the day', () => {
    assert.equal(liste.title, 'Anwesenheit Wölflinge');
    assert.equal(liste.subtitle, 'Gruppenstunde am Freitag, 23. Oktober 2026');
    assert.equal(liste.fileName, 'Anwesenheitsliste Wölflinge 2026-10-23.pdf');
  });

  test('lists the named children in the order of the page with empty boxes', () => {
    const [list, guests] = liste.sections;
    assert.deepEqual(list.columns, ['Nr.', 'Name', 'Da', 'Entschuldigt']);
    // Empty, also for a child already recorded: the list is filled in by hand
    assert.deepEqual(list.rows, [
      ['1', 'Anna Test', '', ''],
      ['2', 'Ben Beispiel', '', ''],
    ]);
    assert.equal(guests.heading, 'Gäste');
    assert.ok(guests.rows?.every((row) => row.every((cell) => cell.trim() === '')));
  });
});
