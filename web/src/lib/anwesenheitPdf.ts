// PDFs of the Anwesenheit: the statistics of a Stufe per month (for grants and the Jahresbericht)
// and a list of the children to fill in by hand at a Gruppenstunde.
import { averageMembers, monthlyStats, type MonthStats } from './anwesenheit';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf, type PdfReport, type PdfSection } from './pdfTabelle';
import { pdfText } from './pdfText';
import type { AnwesenheitChild, AnwesenheitMeeting } from './types';

const MONTH_LABEL = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const DATE_LABEL = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const LONG_DATE_LABEL = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Empty rows for guests on the list to fill in. */
const GUEST_ROWS = 6;

function monthLabel(month: string): string {
  return MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));
}

function number(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function statsRow(label: string, stats: MonthStats): string[] {
  return [
    label,
    String(stats.termine),
    stats.termine === 0 ? '–' : number(averageMembers(stats)),
    String(stats.members),
    String(stats.excused),
    String(stats.guests),
    String(stats.cancelled),
  ];
}

function sum(month: string, stats: MonthStats[]): MonthStats {
  return stats.reduce(
    (total, entry) => ({
      month,
      termine: total.termine + entry.termine,
      cancelled: total.cancelled + entry.cancelled,
      members: total.members + entry.members,
      excused: total.excused + entry.excused,
      guests: total.guests + entry.guests,
    }),
    { month, termine: 0, cancelled: 0, members: 0, excused: 0, guests: 0 }
  );
}

const STATS_COLUMNS = [
  'Monat',
  'Gruppenstunden',
  'Kinder im Schnitt',
  'Kinder gesamt',
  'Entschuldigt',
  'Gäste',
  'Ausgefallen',
];

/**
 * The statistics of one Stufe as on the page, newest first: one table per year with its sums,
 * then every Gruppenstunde with what the group did.
 */
export function anwesenheitReport(stufe: string, meetings: AnwesenheitMeeting[]): PdfReport {
  const stats = monthlyStats(meetings, stufe);
  const rows = meetings
    .filter((meeting) => meeting.stufe === stufe)
    .toSorted((a, b) => b.date.localeCompare(a.date));
  const years = [...new Set(stats.map((entry) => entry.month.slice(0, 4)))];
  const sections: PdfSection[] = years.map((year) => {
    const months = stats.filter((entry) => entry.month.startsWith(year));
    return {
      heading: year,
      columns: STATS_COLUMNS,
      rows: months.map((entry) => statsRow(monthLabel(entry.month), entry)),
      foot: [statsRow(`Summe ${year}`, sum(year, months))],
      alignRight: [1, 2, 3, 4, 5, 6],
    };
  });
  if (years.length > 1) {
    sections.push({
      heading: 'Gesamt',
      columns: STATS_COLUMNS.with(0, 'Zeitraum'),
      rows: [],
      foot: [statsRow(`${years.at(-1)} bis ${years[0]}`, sum('', stats))],
      alignRight: [1, 2, 3, 4, 5, 6],
    });
  }
  sections.push({
    heading: 'Gruppenstunden',
    columns: ['Datum', 'Kinder', 'Entschuldigt', 'Gäste', 'Was habt ihr gemacht?'],
    rows: rows.map((meeting) => [
      DATE_LABEL.format(new Date(`${meeting.date}T00:00:00Z`)),
      meeting.cancelled ? '–' : String(meeting.members),
      meeting.cancelled ? '–' : String(meeting.excused),
      meeting.cancelled ? '–' : String(meeting.guests),
      pdfText(
        meeting.cancelled
          ? ['Ausgefallen', meeting.notes].filter(Boolean).join(': ')
          : meeting.notes
      ),
    ]),
    alignRight: [1, 2, 3],
    widths: { 0: 28, 1: 16, 2: 22, 3: 14 },
  });
  return {
    title: pdfText(`Anwesenheit ${stufe}`),
    subtitle:
      stats.length > 0
        ? `Gruppenstunden von ${monthLabel(stats.at(-1)!.month)} bis ${monthLabel(stats[0].month)}`
        : 'Noch keine Gruppenstunden erfasst',
    sections,
    fileName: pdfFileName(
      'Anwesenheit',
      pdfText(stufe),
      years.length > 1 ? `${years.at(-1)}-${years[0]}` : (years[0] ?? '')
    ),
  };
}

/**
 * The children of the Stufe in the order of the page, so the ticks are quick to enter afterwards,
 * with empty boxes, and empty rows for guests.
 */
export function anwesenheitListe(
  stufe: string,
  date: string,
  children: AnwesenheitChild[]
): PdfReport {
  const names = children.flatMap((child) =>
    child.kind === 'unbekannt' ? [] : [pdfText(`${child.firstName} ${child.lastName}`)]
  );
  return {
    title: pdfText(`Anwesenheit ${stufe}`),
    subtitle: `Gruppenstunde am ${LONG_DATE_LABEL.format(new Date(`${date}T00:00:00Z`))}`,
    sections: [
      {
        columns: ['Nr.', 'Name', 'Da', 'Entschuldigt'],
        rows: names.map((name, index) => [String(index + 1), name, '', '']),
        alignRight: [0],
        widths: { 0: 12, 2: 18, 3: 26 },
        handwriting: { rowHeight: 8 },
      },
      {
        heading: 'Gäste',
        columns: ['Name'],
        rows: Array.from({ length: GUEST_ROWS }, () => ['']),
        // Room for a name written by hand
        handwriting: { rowHeight: 10 },
      },
    ],
    fileName: pdfFileName('Anwesenheitsliste', pdfText(stufe), date),
  };
}

export async function downloadAnwesenheitReport(
  stufe: string,
  meetings: AnwesenheitMeeting[]
): Promise<void> {
  await downloadReportPdf(anwesenheitReport(stufe, meetings));
}

export async function downloadAnwesenheitListe(
  stufe: string,
  date: string,
  children: AnwesenheitChild[]
): Promise<void> {
  await downloadReportPdf(anwesenheitListe(stufe, date, children));
}
