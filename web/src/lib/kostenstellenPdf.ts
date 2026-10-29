// PDF of the Kostenstellen as the page shows them: an overview of all, then each one with its
// Kategorien, e.g. for the Kassenprüfung or the Vorstand.
import { formatDateTime, formatEuro } from './format';
import { buchungen, gesamt, kategorien, SORTIERUNGEN, SPHAEREN } from './kostenstellen';
import type { KostenstellenAnsicht, KostenstellenSortierung } from './kostenstellen';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport, PdfSection } from './pdfTabelle';
import type { KostenstelleStatistik, KostenstellenSummen } from './types';

const ANSICHT: Record<KostenstellenAnsicht, string> = {
  aktuell: 'Aktuelle Kostenstellen',
  archiviert: 'Archivierte Kostenstellen',
  alle: 'Alle Kostenstellen',
};

const AMOUNT_COLUMNS = [
  'Buchungen',
  'Einnahmen',
  'Ausgaben',
  'Saldo',
  'Offene Einnahmen',
  'Offene Ausgaben',
];

/** An open amount stays empty when there is none, so the open ones stand out. */
const offen = (cent: number): string => (cent === 0 ? '' : formatEuro(cent));

function amounts(summen: KostenstellenSummen): string[] {
  return [
    summen.bookings.toLocaleString('de-DE'),
    formatEuro(summen.incomeCent),
    formatEuro(summen.expensesCent),
    formatEuro(summen.balanceCent),
    offen(summen.openIncomeCent),
    offen(summen.openExpensesCent),
  ];
}

export interface KostenstellenPdfInput {
  /** The Kostenstellen as shown: filtered, sorted and with the sums of the chosen year. */
  kostenstellen: KostenstelleStatistik[];
  ansicht: KostenstellenAnsicht;
  jahr: number | null;
  suche: string;
  sortierung: KostenstellenSortierung;
  loadedAt: string;
}

export function kostenstellenPdf(input: KostenstellenPdfInput): PdfReport {
  const summe = gesamt(input.kostenstellen);
  const notes = [
    [
      ANSICHT[input.ansicht],
      input.jahr === null ? 'alle Jahre' : `nur Buchungen aus ${input.jahr}`,
      input.suche.trim() ? `Suche: „${input.suche.trim()}“` : '',
      `Sortierung: ${SORTIERUNGEN.find((s) => s.value === input.sortierung)?.label ?? 'Name'}`,
    ]
      .filter(Boolean)
      .join(' · '),
  ];
  const count = input.kostenstellen.length;
  const overview: PdfSection = {
    heading: 'Übersicht',
    columns: ['Kostenstelle', ...AMOUNT_COLUMNS],
    rows: input.kostenstellen.map((k) => [
      `${k.name}${k.archived ? ' (archiviert)' : ''}`,
      ...amounts(k),
    ]),
    foot: [
      [`Summe aus ${count} ${count === 1 ? 'Kostenstelle' : 'Kostenstellen'}`, ...amounts(summe)],
    ],
    alignRight: [1, 2, 3, 4, 5, 6],
    widths: { 1: 22, 2: 30, 3: 30, 4: 30, 5: 30, 6: 30 },
  };
  const details = input.kostenstellen.map((k): PdfSection => {
    const lines = [
      [
        buchungen(k.bookings),
        `${k.categories.length} ${k.categories.length === 1 ? 'Kategorie' : 'Kategorien'}`,
        k.archived ? 'Archiviert' : '',
        k.id === null ? 'nicht mehr in CampFlow' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ];
    if (k.categories.length === 0)
      return { heading: k.name, lines: [...lines, 'Keine Kategorien.'] };
    return {
      heading: k.name,
      lines,
      columns: ['Kategorie', 'Bereich', ...AMOUNT_COLUMNS],
      rows: kategorien(k, input.sortierung).map((kategorie) => [
        kategorie.name,
        kategorie.sphere ? SPHAEREN[kategorie.sphere] : '',
        ...amounts(kategorie),
      ]),
      foot: [['Summe', '', ...amounts(k)]],
      alignRight: [2, 3, 4, 5, 6, 7],
      widths: { 1: 36, 2: 20, 3: 26, 4: 26, 5: 26, 6: 30, 7: 30 },
    };
  });
  return {
    title: input.jahr === null ? 'Kostenstellen' : `Kostenstellen ${input.jahr}`,
    subtitle: `${count} ${count === 1 ? 'Kostenstelle' : 'Kostenstellen'} · Saldo ${formatEuro(summe.balanceCent)} · Stand aus CampFlow: ${formatDateTime(input.loadedAt)} Uhr`,
    notes,
    landscape: true,
    sections: [
      overview,
      ...details.map((section, index) => ({ ...section, newPage: index === 0 })),
    ],
    fileName: pdfFileName('Kostenstellen', input.jahr === null ? '' : String(input.jahr)),
  };
}

export async function downloadKostenstellen(input: KostenstellenPdfInput): Promise<void> {
  await downloadReportPdf(kostenstellenPdf(input));
}
