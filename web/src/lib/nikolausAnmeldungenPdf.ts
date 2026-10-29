// PDF of the Nikolaus-Anmeldungen as the list shows them: one section per day, one row per
// booking in the order of the slots.
import { formatDay } from './format';
import { PROBLEM_LABEL, STATUS_LABEL } from './nikolausAdmin';
import type { BookingProblem } from './nikolausAdmin';
import { slotLabel } from './nikolausMaps';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport } from './pdfTabelle';
import type { StaffNikolausBooking } from './types';

export interface AnmeldungenPdfInput {
  bookings: StaffNikolausBooking[];
  problems: Record<string, BookingProblem>;
  /** The active filters in words, e.g. `Bestätigt, Ausstehend`. */
  filters: string[];
  fileName: string;
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function summary(bookings: StaffNikolausBooking[]): string {
  const children = bookings.reduce((sum, b) => sum + b.childrenCount, 0);
  const krampus = bookings.filter((b) => b.withKrampus).length;
  return `${count(bookings.length, 'Anmeldung', 'Anmeldungen')} · ${count(children, 'Kind', 'Kinder')} · ${krampus} mit Krampus`;
}

const collator = new Intl.Collator('de');

export function anmeldungenPdfReport({
  bookings,
  problems,
  filters,
  fileName,
}: AnmeldungenPdfInput): PdfReport {
  const sorted = [...bookings].sort(
    (a, b) => a.slotKey.localeCompare(b.slotKey) || collator.compare(a.familyName, b.familyName)
  );
  const dates = [...new Set(sorted.map((b) => b.slotKey.split('T')[0]))];
  return {
    title: 'Nikolaus-Anmeldungen',
    subtitle: summary(sorted),
    notes: filters.length > 0 ? [`Filter: ${filters.join(' · ')}`] : [],
    sections: dates.map((date) => {
      const day = sorted.filter((b) => b.slotKey.startsWith(`${date}T`));
      return {
        heading: formatDay(date, { weekday: 'long', day: 'numeric', month: 'long' }),
        lines: [summary(day)],
        columns: ['Termin', 'Familie', 'Adresse', 'Kinder', 'Krampus', 'Status'],
        rows: day.map((b) => [
          slotLabel(b.slotKey),
          [`Familie ${b.familyName}`, b.phone ? `Tel. ${b.phone}` : ''].filter(Boolean).join('\n'),
          [`${b.street}, ${b.postalCode} ${b.city}`, b.addressNotes].filter(Boolean).join('\n'),
          String(b.childrenCount),
          b.withKrampus ? 'Ja' : 'Nein',
          [STATUS_LABEL[b.status], problems[b.id] ? PROBLEM_LABEL[problems[b.id]] : '']
            .filter(Boolean)
            .join('\n'),
        ]),
        alignRight: [3],
        widths: { 0: 22, 1: 42, 3: 14, 4: 17, 5: 28 },
      };
    }),
    fileName,
  };
}

export async function downloadAnmeldungenPdf(input: AnmeldungenPdfInput): Promise<void> {
  await downloadReportPdf(anmeldungenPdfReport(input));
}
