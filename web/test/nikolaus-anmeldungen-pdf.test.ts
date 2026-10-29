import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { anmeldungenPdfReport } from '../src/lib/nikolausAnmeldungenPdf';
import type { StaffNikolausBooking } from '../src/lib/types';

function booking(id: string, extra: Partial<StaffNikolausBooking> = {}): StaffNikolausBooking {
  return {
    id,
    slotKey: '2026-12-05T17:00',
    status: 'confirmed',
    familyName: `Muster ${id}`,
    street: 'Hauptstraße 1',
    postalCode: '86899',
    city: 'Landsberg',
    phone: '',
    addressNotes: '',
    childrenCount: 2,
    withKrampus: false,
    ...extra,
  } as unknown as StaffNikolausBooking;
}

describe('anmeldungenPdfReport', () => {
  const report = anmeldungenPdfReport({
    bookings: [
      booking('3', { slotKey: '2026-12-06T18:00', status: 'pending', childrenCount: 1 }),
      booking('2', { familyName: 'Zeller', withKrampus: true, phone: '0170 1' }),
      booking('1', { familyName: 'Albrecht', slotKey: '2026-12-05T17:00', addressNotes: 'Tor' }),
    ],
    problems: { '2': 'overbooked' },
    filters: ['Mit Krampus', 'Bestätigt, Ausstehend'],
    fileName: 'nikolaus-anmeldungen.pdf',
  });

  test('sums up all bookings and names the filters', () => {
    assert.equal(report.title, 'Nikolaus-Anmeldungen');
    assert.equal(report.subtitle, '3 Anmeldungen · 5 Kinder · 1 mit Krampus');
    assert.deepEqual(report.notes, ['Filter: Mit Krampus · Bestätigt, Ausstehend']);
  });

  test('has one section per day with the bookings in the order of the slots', () => {
    assert.deepEqual(
      report.sections.map((section) => section.heading),
      ['Samstag, 5. Dezember', 'Sonntag, 6. Dezember']
    );
    const [first, second] = report.sections;
    assert.deepEqual(first.lines, ['2 Anmeldungen · 4 Kinder · 1 mit Krampus']);
    assert.deepEqual(first.rows, [
      [
        '17:00–17:30',
        'Familie Albrecht',
        'Hauptstraße 1, 86899 Landsberg\nTor',
        '2',
        'Nein',
        'Bestätigt',
      ],
      [
        '17:00–17:30',
        'Familie Zeller\nTel. 0170 1',
        'Hauptstraße 1, 86899 Landsberg',
        '2',
        'Ja',
        'Bestätigt\nÜberbucht',
      ],
    ]);
    assert.deepEqual(second.lines, ['1 Anmeldung · 1 Kind · 0 mit Krampus']);
    assert.equal(second.rows?.[0][5], 'Ausstehend');
  });

  test('leaves out the filter note without filters', () => {
    const empty = anmeldungenPdfReport({ bookings: [], problems: {}, filters: [], fileName: 'x' });
    assert.deepEqual(empty.notes, []);
    assert.deepEqual(empty.sections, []);
  });
});
