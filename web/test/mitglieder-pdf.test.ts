import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mitgliederReport } from '../src/lib/mitgliederPdf';
import type { CampflowColumn, CampflowPerson } from '../src/lib/types';

const TODAY = '2026-10-29';

const COLUMNS: CampflowColumn[] = [
  {
    id: 'col_Eltern',
    name: 'Erziehungsberechtigte',
    type: 'string',
    allowed_values: null,
    external_id: null,
  },
  {
    id: 'col_Konfession',
    name: 'Konfession',
    type: 'string',
    allowed_values: null,
    external_id: null,
  },
];

function person(id: string, extra: Partial<CampflowPerson> = {}): CampflowPerson {
  return {
    id,
    name: { first_name: 'Emma', last_name: 'Huber' },
    birthdate: '2017-03-12',
    primary_email: 'emma@example.org',
    cc_emails: ['papa@example.org'],
    phone_numbers: [{ number: '0176 123', label: 'Mama' }, { number: '08062 1' }],
    address: { street: 'Ahornweg 1', postcode: '83052', city: 'Bruckmühl', country_code: 'de' },
    group_names: ['🟠 Wölfling', '🐦‍🔥 Leiter*in'],
    join_date: '2020-01-01',
    leave_date: null,
    col_Konfession: 'evangelisch',
    ...extra,
  };
}

describe('mitgliederReport', () => {
  test('a group tab: name, birthday and age, groups without emoji, contacts and address', () => {
    const report = mitgliederReport({
      persons: [person('1')],
      columns: COLUMNS,
      ansicht: 'gruppe:🟠 Wölfling',
      search: '',
      today: TODAY,
    });
    assert.equal(report.title, 'Mitglieder Wölfling');
    assert.equal(report.subtitle, 'Stand 29.10.2026 · 1 Mitglied');
    assert.equal(report.notes, undefined);
    assert.equal(report.landscape, true);
    assert.equal(report.fileName, 'Mitglieder Wölfling 2026-10-29.pdf');
    const [table] = report.sections;
    assert.deepEqual(table.columns, [
      'Name',
      'Geburtstag (Alter)',
      'Gruppen',
      'Telefon',
      'E-Mail',
      'Adresse',
    ]);
    assert.deepEqual(table.rows, [
      [
        'Emma Huber',
        '12.03.2017 (9)',
        'Wölfling\nLeiter*in',
        '0176 123 (Mama)\n08062 1',
        'emma@example.org\npapa@example.org',
        'Ahornweg 1, 83052 Bruckmühl',
      ],
    ]);
  });

  test('parents get a column only when someone has them; „Ohne Gruppe“ has no groups', () => {
    const report = mitgliederReport({
      persons: [person('1', { group_names: [], col_Eltern: 'Maria Huber' }), person('2')],
      columns: COLUMNS,
      ansicht: 'ohne-gruppe',
      search: 'huber',
      today: TODAY,
    });
    assert.equal(report.title, 'Mitglieder ohne Gruppe');
    assert.deepEqual(report.notes, ['Suche: „huber“']);
    const [table] = report.sections;
    assert.deepEqual(table.columns, [
      'Name',
      'Geburtstag (Alter)',
      'Telefon',
      'E-Mail',
      'Eltern',
      'Adresse',
    ]);
    assert.equal(table.rows?.[0][4], 'Maria Huber');
    assert.equal(table.rows?.[1][4], '');
  });

  test('without parent fields there is no column for them', () => {
    const report = mitgliederReport({
      persons: [person('1')],
      columns: COLUMNS,
      ansicht: 'alle',
      search: '',
      today: TODAY,
    });
    assert.equal(report.title, 'Mitglieder');
    assert.ok(!report.sections[0].columns?.includes('Eltern'));
  });

  test('former and future members say so below their name', () => {
    const report = mitgliederReport({
      persons: [
        person('1', { leave_date: '2026-07-31' }),
        person('2', { join_date: '2026-12-01', birthdate: null, age: 30 }),
      ],
      columns: [],
      ansicht: 'ausgetreten',
      search: '',
      today: TODAY,
    });
    assert.equal(report.title, 'Ausgetretene Mitglieder');
    assert.equal(report.subtitle, 'Stand 29.10.2026 · 2 Mitglieder');
    const rows = report.sections[0].rows!;
    assert.equal(rows[0][0], 'Emma Huber\nAusgetreten am 31.07.2026');
    assert.equal(rows[1][0], 'Emma Huber\nTritt am 01.12.2026 ein');
    assert.equal(rows[1][1], '30 Jahre');
  });
});
