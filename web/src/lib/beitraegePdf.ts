// PDFs of the Beiträge: the list as filtered with its sums, and the state of the Sammlungen.
import { isErledigt, sammlungZahlen, summen } from './beitraege';
import type { BeitragFilter, SammlungZahlen } from './beitraege';
import { formatDate } from './campflowFields';
import { formatDateTime, formatEuro } from './format';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport } from './pdfTabelle';
import type { Beitrag, BeitragSammlung } from './types';

const FILTER_LABEL: Record<Exclude<BeitragFilter, 'alle'>, string> = {
  offen: 'Noch offen',
  bezahlt: 'Bezahlt',
  erstatten: 'Zu erstatten',
  storniert: 'Storniert',
};

const STAND: Record<Beitrag['status'], string> = {
  paid: 'Bezahlt',
  partial: 'Teilweise bezahlt',
  refund: 'Zu viel bezahlt',
  cancelled: 'Storniert',
  unpaid: 'Nicht bezahlt',
};

const anzahl = (count: number): string => `${count} ${count === 1 ? 'Beitrag' : 'Beiträge'}`;

export interface BeitraegeListeInput {
  /** „Alle Beiträge“ or the name of the Sammlung. */
  title: string;
  /** The Beiträge the list shows with its filters. */
  fees: Beitrag[];
  filter: BeitragFilter;
  /** Name of the chosen Kostenstelle; empty for all. */
  kostenstelle: string;
  search: string;
  loadedAt: string;
}

/** The Beiträge as one wide table; the sums of the columns in the foot. */
export function beitraegeListePdf(input: BeitraegeListeInput): PdfReport {
  const sums = summen(input.fees);
  const notes: string[] = [];
  if (input.filter !== 'alle') notes.push(`Zahlungsstand: ${FILTER_LABEL[input.filter]}`);
  if (input.kostenstelle) notes.push(`Kostenstelle: ${input.kostenstelle}`);
  if (input.search.trim()) notes.push(`Suche: „${input.search.trim()}“`);
  return {
    title: input.title === 'Alle Beiträge' ? input.title : `Beiträge – ${input.title}`,
    subtitle: `${anzahl(input.fees.length)} · Stand aus CampFlow: ${formatDateTime(input.loadedAt)} Uhr`,
    notes: notes.length ? [notes.join(' · ')] : [],
    landscape: true,
    sections: [
      {
        columns: [
          'Name',
          'Beitrag',
          'Zahlung am',
          'Fällig',
          'Bezahlt',
          'Offen',
          'Zu erstatten',
          'Stand',
        ],
        rows: input.fees.map((fee) => [
          fee.payer || 'Ohne Namen',
          [
            [fee.costUnit?.name, fee.description].filter(Boolean).join(' · '),
            fee.reference ? `Verwendungszweck ${fee.reference}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          fee.paidAt && fee.status !== 'unpaid' ? formatDate(fee.paidAt) : '',
          formatEuro(fee.dueCent),
          formatEuro(fee.paidCent),
          fee.openCent > 0 ? formatEuro(fee.openCent) : '',
          fee.openCent < 0 ? formatEuro(-fee.openCent) : '',
          fee.status === 'cancelled'
            ? `Storniert (${formatEuro(fee.amountCent)})`
            : STAND[fee.status],
        ]),
        foot: [
          [
            'Summe',
            anzahl(input.fees.length),
            '',
            formatEuro(sums.dueCent),
            formatEuro(sums.paidCent),
            formatEuro(sums.openCent),
            formatEuro(sums.refundCent),
            '',
          ],
        ],
        alignRight: [3, 4, 5, 6],
        widths: { 0: 46, 2: 22, 3: 24, 4: 24, 5: 24, 6: 24, 7: 32 },
      },
    ],
    fileName: pdfFileName('Beiträge', input.title === 'Alle Beiträge' ? '' : input.title),
  };
}

export async function downloadBeitraegeListe(input: BeitraegeListeInput): Promise<void> {
  await downloadReportPdf(beitraegeListePdf(input));
}

export interface SammlungenInput {
  /** The Sammlungen the overview shows with its filters. */
  batches: BeitragSammlung[];
  /** All Beiträge, to count the paid and cancelled ones per Sammlung. */
  fees: Beitrag[];
  search: string;
  hideDone: boolean;
  loadedAt: string;
}

function bezahlt({ paid, due }: SammlungZahlen): string {
  if (due === 0) return '–';
  return `${paid} von ${due} (${Math.floor((paid / due) * 100)} %)`;
}

/** One row per Sammlung with how far it is paid, and the totals in the foot. */
export function sammlungenPdf(input: SammlungenInput): PdfReport {
  const total = { fees: 0, cancelled: 0, paid: 0, due: 0, sum: 0, open: 0, refund: 0 };
  const rows = input.batches.map((batch) => {
    const zahlen = sammlungZahlen(input.fees.filter((fee) => fee.batchId === batch.id));
    total.fees += batch.feeCount;
    total.cancelled += zahlen.cancelled;
    total.paid += zahlen.paid;
    total.due += zahlen.due;
    total.sum += batch.totalCent;
    total.open += batch.openCent;
    total.refund += batch.refundCent;
    return [
      batch.name,
      String(batch.feeCount),
      zahlen.cancelled ? String(zahlen.cancelled) : '',
      bezahlt(zahlen),
      formatEuro(batch.totalCent),
      batch.openCent ? formatEuro(batch.openCent) : '',
      batch.refundCent ? formatEuro(batch.refundCent) : '',
      isErledigt(batch) ? 'Erledigt' : '',
    ];
  });
  const notes: string[] = [];
  if (input.search.trim()) notes.push(`Suche: „${input.search.trim()}“`);
  if (input.hideDone) notes.push('Ohne erledigte Sammlungen');
  const count = input.batches.length;
  return {
    title: 'Beiträge – Stand der Sammlungen',
    subtitle: `${count} ${count === 1 ? 'Sammlung' : 'Sammlungen'} · Stand aus CampFlow: ${formatDateTime(input.loadedAt)} Uhr`,
    notes: notes.length ? [notes.join(' · ')] : [],
    landscape: true,
    sections: [
      {
        columns: [
          'Sammlung',
          'Beiträge',
          'Storniert',
          'Bezahlt',
          'Summe',
          'Offen',
          'Zu erstatten',
          'Stand',
        ],
        rows,
        foot: [
          [
            'Summe',
            String(total.fees),
            total.cancelled ? String(total.cancelled) : '',
            bezahlt(total),
            formatEuro(total.sum),
            formatEuro(total.open),
            formatEuro(total.refund),
            '',
          ],
        ],
        alignRight: [1, 2, 3, 4, 5, 6],
        widths: { 1: 20, 2: 20, 3: 34, 4: 26, 5: 26, 6: 26, 7: 22 },
      },
    ],
    fileName: pdfFileName('Beiträge Sammlungen'),
  };
}

export async function downloadSammlungen(input: SammlungenInput): Promise<void> {
  await downloadReportPdf(sammlungenPdf(input));
}
