import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { aufgabenPdfReport, vorlageChecklistReport } from '../src/lib/aufgabenPdf';
import type { Task, TaskProject, TaskTemplate } from '../src/lib/types';

const TODAY = '2026-10-29';

function task(id: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    etag: 'e',
    title: `Aufgabe ${id}`,
    description: '',
    assignee: '',
    assignees: [{ name: 'Eva', login: 'eva@example.org' }],
    dueDate: '2026-11-02',
    projectId: 1,
    state: 'offen',
    sourceId: '',
    sourceVersion: '',
    quote: '',
    ...extra,
  } as Task;
}

const projects: TaskProject[] = [
  { id: 1, etag: 'e', title: 'Herbstlager', campflowId: '' },
  { id: 2, etag: 'e', title: 'Nikolaus', campflowId: '' },
];

describe('aufgabenPdfReport', () => {
  test('one section per project, tasks without one last', () => {
    const report = aufgabenPdfReport(
      {
        tasks: [
          task(1, { description: 'Zelte zählen' }),
          task(2, { projectId: null, dueDate: '2026-10-20', assignees: [] }),
          task(3, { projectId: 2, state: 'erledigt', dueDate: '2026-10-20' }),
        ],
        projects,
        status: 'alle',
        project: 'alle',
        ownOnly: false,
      },
      TODAY
    );
    assert.equal(report.title, 'Aufgaben');
    assert.equal(report.subtitle, '3 Aufgaben');
    assert.deepEqual(report.notes, ['Filter: Status: Offen und erledigt']);
    assert.deepEqual(
      report.sections.map((s) => s.heading),
      ['Herbstlager · 1 Aufgabe', 'Nikolaus · 1 Aufgabe', 'Ohne Projekt · 1 Aufgabe']
    );
    assert.deepEqual(report.sections[0].rows, [
      ['Aufgabe 1\nZelte zählen', 'Eva', '02.11.2026', 'Offen'],
    ]);
    // Overdue only while open
    assert.deepEqual(report.sections[1].rows?.[0].slice(2), ['20.10.2026', 'Erledigt']);
    assert.deepEqual(report.sections[2].rows?.[0].slice(1, 3), [
      'Nicht zugewiesen',
      '20.10.2026\nüberfällig',
    ]);
    assert.equal(report.fileName, `Aufgaben ${TODAY}.pdf`);
  });

  test('a chosen project gives one table and names the filters', () => {
    const report = aufgabenPdfReport(
      { tasks: [task(1)], projects, status: 'offen', project: '1', ownOnly: true },
      TODAY
    );
    assert.equal(report.title, 'Aufgaben · Herbstlager');
    assert.deepEqual(report.notes, [
      'Filter: Status: Offen · Projekt: Herbstlager · Nur mir zugewiesen',
    ]);
    assert.equal(report.sections.length, 1);
    assert.equal(report.sections[0].heading, undefined);
    assert.equal(report.fileName, `Aufgaben Herbstlager ${TODAY}.pdf`);
  });

  test('an empty selection says so', () => {
    const report = aufgabenPdfReport(
      { tasks: [], projects, status: 'erledigt', project: '', ownOnly: false },
      TODAY
    );
    assert.equal(report.title, 'Aufgaben · Ohne Projekt');
    assert.deepEqual(report.sections, [{ lines: ['Keine Aufgaben für diese Auswahl.'] }]);
  });
});

describe('vorlageChecklistReport', () => {
  test('a checklist with an empty column to tick off, earliest first', () => {
    const template: TaskTemplate = {
      id: 1,
      etag: 'e',
      title: 'Zeltlager',
      items: [
        { title: 'Abbau', description: '', assignee: '', daysBefore: -1 },
        {
          title: 'Anmeldung',
          description: 'Formular verschicken',
          assignee: '',
          assignees: [{ name: 'Ben', login: '' }],
          daysBefore: 30,
        },
        { title: 'Einkauf', description: '', assignee: '', daysBefore: 0 },
      ],
    };
    const report = vorlageChecklistReport(template);
    assert.equal(report.title, 'Zeltlager');
    assert.equal(report.subtitle, 'Checkliste · 3 Aufgaben');
    assert.equal(report.fileName, 'Checkliste Zeltlager.pdf');
    const [table] = report.sections;
    assert.deepEqual(table.columns, ['', 'Aufgabe', 'Zuständig', 'Wann']);
    assert.deepEqual(table.rows, [
      ['', 'Anmeldung\nFormular verschicken', 'Ben', '30 Tage vorher'],
      ['', 'Einkauf', '', 'Am Tag der Aktion'],
      ['', 'Abbau', '', '1 Tag danach'],
    ]);
    assert.equal(table.widths?.[0], 8);
  });
});
