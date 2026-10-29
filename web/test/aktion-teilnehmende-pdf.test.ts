import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { teilnehmendePdfReport } from '../src/lib/aktionTeilnehmendePdf';
import type { TeilnehmendePdf } from '../src/lib/aktionTeilnehmendePdf';
import type { PersonColumn } from '../src/lib/campflowFields';
import { pdfText } from '../src/lib/pdfZeichen';
import type { CampflowPerson } from '../src/lib/types';

function column(key: string, label = key): PersonColumn {
  return {
    key,
    label,
    text: (p) => String(p[key] ?? ''),
    sortValue: (p) => String(p[key] ?? ''),
  };
}

const persons = [
  { id: '1', name: 'Anna', group_names: '🟠 Wölfling' },
  { id: '2', name: 'Ben', group_names: '🔴 Rover' },
] as unknown as CampflowPerson[];

function list(extra: Partial<TeilnehmendePdf> = {}): TeilnehmendePdf {
  return {
    title: 'Sommerlager',
    range: '01.08.2026 – 08.08.2026',
    columns: [column('name', 'Name'), column('group_names', 'Gruppen')],
    persons,
    statuses: ['registered', 'confirmed'],
    search: '',
    sortLabel: 'Name',
    sortAsc: true,
    ...extra,
  };
}

describe('teilnehmendePdfReport', () => {
  test('puts an empty tick column before the shown columns, in the shown order', () => {
    const report = teilnehmendePdfReport(list());
    const [table] = report.sections;
    assert.deepEqual(table.columns, ['Da', 'Name', 'Gruppen']);
    assert.deepEqual(table.rows, [
      ['', 'Anna', 'Wölfling'],
      ['', 'Ben', 'Rover'],
    ]);
    assert.deepEqual(table.widths, { 0: 9, 1: 34 });
    assert.equal(report.title, 'Teilnehmende');
    assert.equal(report.subtitle, 'Sommerlager · 01.08.2026 – 08.08.2026');
    assert.equal(report.fileName, 'Teilnehmende Sommerlager.pdf');
    assert.equal(report.landscape, false);
  });

  test('names the filters, the order and the number of people', () => {
    const report = teilnehmendePdfReport(
      list({ search: ' Rover ', sortLabel: 'Alter', sortAsc: false, persons: persons.slice(1) })
    );
    assert.deepEqual(report.notes, [
      '1 Person · Status: Bestätigt, Angemeldet',
      'Suche: „Rover“',
      'Sortiert nach Alter, absteigend',
    ]);
  });

  test('turns the page for many columns', () => {
    const columns = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => column(key));
    assert.equal(teilnehmendePdfReport(list({ columns })).landscape, true);
  });
});

describe('pdfText', () => {
  test('drops characters the PDF cannot show and keeps umlauts, quotes and €', () => {
    assert.equal(pdfText('🟢 Pfadfinder*in ✓'), 'Pfadfinder*in');
    assert.equal(pdfText('„Größe“ – 12 €'), '„Größe“ – 12 €');
  });
});
