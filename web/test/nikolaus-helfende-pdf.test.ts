import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { helfendePdfReport } from '../src/lib/nikolausHelfendePdf';
import type { StaffNikolausHelfendeData } from '../src/lib/types';

const data: StaffNikolausHelfendeData = {
  persons: [
    {
      id: '2',
      etag: 'e',
      name: 'Ben',
      availability: { '2026-12-05': ['Krampus', 'Küche'] },
      positiveTags: [],
      negativeTags: ['Wölflinge'],
      notes: 'Erst ab 17 Uhr',
    },
    {
      id: '1',
      etag: 'e',
      name: 'Anna',
      availability: { '2026-12-05': ['Nikolaus'], '2026-12-06': ['Nikolaus'] },
      positiveTags: ['Jupfis'],
      negativeTags: [],
      notes: '',
    },
  ],
  tags: [],
  days: [
    { date: '2026-12-05', teams: ['A', 'B'] },
    { date: '2026-12-06', teams: ['A'] },
  ],
};

describe('helfendePdfReport', () => {
  const report = helfendePdfReport(data, 'nikolaus-helfende.pdf');

  test('lists the helpers by name with their posts per day and wishes', () => {
    assert.equal(report.subtitle, '2 Personen eingetragen');
    assert.equal(report.landscape, false);
    const [persons] = report.sections;
    assert.equal(persons.columns?.length, 5);
    assert.deepEqual(persons.rows, [
      ['Anna', 'Nikolaus', 'Nikolaus', 'Bevorzugt: Jupfis', ''],
      ['Ben', 'Krampus, Küche', '–', 'Nicht zu: Wölflinge', 'Erst ab 17 Uhr'],
    ]);
  });

  test('counts the volunteers per day and post with their names and what is missing', () => {
    const coverage = report.sections[1];
    assert.equal(coverage.heading, 'Meldungen pro Tag und Posten');
    assert.deepEqual(coverage.columns?.slice(1, 3), ['Nikolaus', 'Krampus']);
    const [saturday, sunday] = coverage.rows ?? [];
    assert.match(saturday[0], /\n2 Teams$/);
    assert.equal(saturday[1], '1 / 2 – 1 fehlt\nAnna');
    assert.equal(saturday[2], '1 / 2 – 1 fehlt\nBen');
    assert.equal(saturday.at(-1), '1\nBen');
    assert.equal(sunday[1], '1 / 1\nAnna');
  });

  test('turns the pages to landscape for many days', () => {
    const days = ['01', '02', '03', '04'].map((day) => ({ date: `2026-12-${day}`, teams: [] }));
    assert.equal(helfendePdfReport({ ...data, days }, 'x').landscape, true);
  });
});
