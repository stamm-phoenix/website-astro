// PDF of the participant list of an Aktion: the columns, filters and order shown on the page,
// with an empty column to tick off who is there.
import { PERSON_STATUS_LABEL } from './campflowFields';
import type { PersonColumn, PersonStatus } from './campflowFields';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport } from './pdfTabelle';
import { pdfText } from './pdfText';
import type { CampflowPerson } from './types';

export interface TeilnehmendePdf {
  title: string;
  /** Dates of the Aktion, e.g. „12.06.2026 – 14.06.2026“. */
  range: string;
  /** Columns in the order of the table. */
  columns: PersonColumn[];
  /** People as shown: filtered and sorted. */
  persons: CampflowPerson[];
  statuses: PersonStatus[];
  search: string;
  /** Label of the column the list is sorted by. */
  sortLabel: string;
  sortAsc: boolean;
}

/** From this many columns of the page on, the PDF is landscape. */
const LANDSCAPE_FROM = 6;
const CHECK_WIDTH = 9;
/** Columns that need room for their usual text in one or two lines, in mm. */
const COLUMN_WIDTHS: Record<string, number> = { name: 34, beitrag: 32 };
const STATUS_ORDER: PersonStatus[] = ['confirmed', 'registered', 'cancelled'];

export function teilnehmendePdfReport(list: TeilnehmendePdf): PdfReport {
  const count = list.persons.length;
  const status = STATUS_ORDER.filter((s) => list.statuses.includes(s))
    .map((s) => PERSON_STATUS_LABEL[s])
    .join(', ');
  const search = list.search.trim();
  return {
    title: 'Teilnehmende',
    subtitle: pdfText(`${list.title} · ${list.range}`),
    notes: [
      `${count} ${count === 1 ? 'Person' : 'Personen'} · Status: ${status || 'keiner'}`,
      ...(search ? [`Suche: „${pdfText(search)}“`] : []),
      `Sortiert nach ${pdfText(list.sortLabel)}${list.sortAsc ? '' : ', absteigend'}`,
    ],
    landscape: list.columns.length >= LANDSCAPE_FROM,
    sections: [
      {
        columns: ['Da', ...list.columns.map((column) => pdfText(column.label))],
        rows: list.persons.map((person) => [
          '',
          ...list.columns.map((column) => pdfText(column.text(person))),
        ]),
        widths: {
          0: CHECK_WIDTH,
          ...Object.fromEntries(
            list.columns.flatMap((column, index) =>
              column.key in COLUMN_WIDTHS ? [[index + 1, COLUMN_WIDTHS[column.key]]] : []
            )
          ),
        },
      },
    ],
    fileName: pdfFileName('Teilnehmende', list.title),
  };
}

export async function downloadTeilnehmendePdf(list: TeilnehmendePdf): Promise<void> {
  await downloadReportPdf(teilnehmendePdfReport(list));
}
