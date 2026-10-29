// PDF of the Nikolaus-Helfende: who can take which post on which day, their wishes, and the
// volunteers per day and post with the names.
import { formatShortDate } from './nikolausAdmin';
import { HELPER_ROLES, KITCHEN } from './nikolausEinteilung';
import { helperCoverage } from './nikolausHelfende';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport } from './pdfTabelle';
import type { StaffNikolausHelfendeData } from './types';

/** From this many days on the table of the helpers is printed on landscape pages. */
const LANDSCAPE_FROM_DAYS = 4;

const collator = new Intl.Collator('de');

export function helfendePdfReport(data: StaffNikolausHelfendeData, fileName: string): PdfReport {
  const persons = [...data.persons].sort((a, b) => collator.compare(a.name, b.name));
  const coverage = helperCoverage(data);
  return {
    title: 'Nikolaus-Helfende',
    subtitle: `${persons.length} ${persons.length === 1 ? 'Person' : 'Personen'} eingetragen`,
    landscape: data.days.length >= LANDSCAPE_FROM_DAYS,
    sections: [
      {
        heading: 'Wer kann wann',
        columns: [
          'Name',
          ...data.days.map((day) => formatShortDate(day.date)),
          'Wünsche zur Einteilung',
          'Bemerkungen',
        ],
        rows: persons.map((person) => [
          person.name,
          ...data.days.map((day) => (person.availability[day.date] ?? []).join(', ') || '–'),
          [
            ...person.positiveTags.map((tag) => `Bevorzugt: ${tag}`),
            ...person.negativeTags.map((tag) => `Nicht zu: ${tag}`),
          ].join('\n'),
          person.notes,
        ]),
        widths: { 0: 34 },
      },
      {
        heading: 'Meldungen pro Tag und Posten',
        columns: ['Tag', ...HELPER_ROLES],
        rows: coverage.map((day) => [
          `${formatShortDate(day.date)}\n${day.teams} ${day.teams === 1 ? 'Team' : 'Teams'}`,
          ...day.counts.map((entry) => {
            const missing = entry.role === KITCHEN ? 0 : Math.max(0, day.teams - entry.count);
            const head =
              entry.role === KITCHEN
                ? String(entry.count)
                : `${entry.count} / ${day.teams}${missing > 0 ? ` – ${missing} ${missing === 1 ? 'fehlt' : 'fehlen'}` : ''}`;
            return [head, ...entry.names].join('\n');
          }),
        ]),
        widths: { 0: 24 },
      },
    ],
    fileName,
  };
}

export async function downloadHelfendePdf(
  data: StaffNikolausHelfendeData,
  fileName: string
): Promise<void> {
  await downloadReportPdf(helfendePdfReport(data, fileName));
}
