import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { abstimmungPdfReport } from '../src/lib/abstimmungPdf';
import type { AbstimmungDetail, AbstimmungTeilnahme } from '../../api/lib/abstimmung-model';

function teilnahme(id: number, name: string, email: string, geantwortet: boolean) {
  return {
    id,
    name,
    email,
    geantwortet,
    eingeladenAm: null,
    erinnertAm: null,
    mailStatus: 'gesendet',
  } satisfies AbstimmungTeilnahme;
}

function abstimmung(extra: Partial<AbstimmungDetail> = {}): AbstimmungDetail {
  return {
    id: 1,
    titel: 'Wann ist die Leiterrunde?',
    beschreibung: '',
    maxAuswahl: null,
    vielleichtErlaubt: true,
    sichtbarkeit: 'offen',
    einsicht: 'alles',
    geschlossen: true,
    erstelltVonName: 'Eva',
    optionen: [
      { id: 1, text: 'Sa', stimmen: 2, vielleicht: 1 },
      { id: 2, text: 'So', stimmen: 1, vielleicht: 0 },
    ],
    antworten: [
      { name: 'Anna', gewaehlt: [1], vielleicht: [2] },
      { name: 'Ben', gewaehlt: [1, 2], vielleicht: [] },
      { name: 'Cem', gewaehlt: [], vielleicht: [] },
    ],
    zahlenVerborgen: false,
    anzahlAntworten: 3,
    ich: null,
    etag: 'e',
    erstelltAm: '2026-10-01T10:00:00Z',
    eigene: true,
    link: null,
    teilnahmen: [
      teilnahme(1, 'Dora', 'dora@example.org', false),
      teilnahme(2, '', 'emil@example.org', false),
      teilnahme(3, 'Anna', '', true),
    ],
    ...extra,
  };
}

describe('abstimmungPdfReport', () => {
  test('lists the votes, who chose what and who did not answer', () => {
    const report = abstimmungPdfReport(abstimmung());
    assert.equal(report.title, 'Wann ist die Leiterrunde?');
    assert.equal(report.subtitle, 'Abstimmung von Eva · erstellt am 01.10.2026, 12:00 · beendet');
    assert.equal(report.fileName, 'Abstimmung Wann ist die Leiterrunde.pdf');
    const [ergebnis, wahl, offen] = report.sections;
    assert.equal(ergebnis.heading, 'Ergebnis · 3 Antworten');
    assert.deepEqual(ergebnis.rows, [
      ['Sa', '2', '1', 'Meiste Stimmen'],
      ['So', '1', '0', ''],
    ]);
    assert.deepEqual(wahl.columns, ['Name', 'Sa', 'So']);
    assert.deepEqual(wahl.rows, [
      ['Anna', 'Ja', 'Vielleicht'],
      ['Ben', 'Ja', 'Ja'],
      ['Cem', '–', '–'],
    ]);
    assert.deepEqual(wahl.foot, [
      ['Ja', '2', '1'],
      ['Vielleicht', '1', '0'],
    ]);
    assert.equal(offen.heading, 'Nicht abgestimmt · 2');
    assert.deepEqual(offen.lines, ['Dora, emil@example.org']);
    assert.equal(report.landscape, false);
  });

  test('an anonymous Abstimmung shows who answered, not what and not the open invitations, also for its organizer', () => {
    const report = abstimmungPdfReport(abstimmung({ sichtbarkeit: 'anonym' }));
    assert.deepEqual(
      report.sections.map((s) => s.heading),
      ['Ergebnis · 3 Antworten', 'Abgestimmt']
    );
    assert.ok(report.sections.every((s) => !s.lines?.some((line) => line.includes('@'))));
    assert.deepEqual(report.sections[1].lines, ['Anna, Ben, Cem']);
    assert.ok(report.notes?.some((note) => note.startsWith('Anonyme Abstimmung')));
  });

  test('a secret Abstimmung shows only the votes per option', () => {
    const report = abstimmungPdfReport(abstimmung({ sichtbarkeit: 'geheim' }));
    assert.deepEqual(
      report.sections.map((s) => s.heading),
      ['Ergebnis · 3 Antworten']
    );
    assert.ok(report.notes?.some((note) => note.startsWith('Geheime Abstimmung')));
  });

  test('holds the votes back with too few answers when not everyone sees who chose what', () => {
    const report = abstimmungPdfReport(
      abstimmung({ sichtbarkeit: 'geheim', anzahlAntworten: 2, antworten: [] })
    );
    assert.equal(report.sections[0].rows, undefined);
    assert.match(report.sections[0].lines?.[0] ?? '', /erst ab 3 Antworten/);
  });

  test('many options list the choices in words, a few more turn the page', () => {
    const optionen = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      text: `Option ${i + 1}`,
      stimmen: 0,
      vielleicht: 0,
    }));
    const viele = abstimmungPdfReport(abstimmung({ optionen }));
    assert.deepEqual(viele.sections[1].columns, ['Name', 'Ja', 'Vielleicht']);
    assert.deepEqual(viele.sections[1].rows?.[1], ['Ben', 'Option 1\nOption 2', '']);
    assert.deepEqual(viele.sections[1].rows?.[2], ['Cem', 'Keine Option passt', '']);
    assert.equal(viele.landscape, false);
    const sechs = abstimmungPdfReport(abstimmung({ optionen: optionen.slice(0, 6) }));
    assert.equal(sechs.landscape, true);
  });

  test('without answers it says so', () => {
    const report = abstimmungPdfReport(
      abstimmung({ anzahlAntworten: 0, antworten: [], teilnahmen: null, geschlossen: false })
    );
    assert.match(report.subtitle, /läuft noch$/);
    assert.deepEqual(report.sections, [
      { heading: 'Ergebnis · 0 Antworten', lines: ['Niemand hat abgestimmt.'] },
    ]);
  });
});
