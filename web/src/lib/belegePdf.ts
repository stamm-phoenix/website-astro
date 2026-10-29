// PDF of the receipts as listed on the page, with its filters, e.g. for the Kasse or a
// Kassenprüfung: one row per receipt and the sums below, without the images.
import { formatIsoDate } from './belege';
import type { BelegEintrag, BelegFilter } from './belegEintraege';
import { BELEG_QUELLEN, BELEG_STAENDE } from './belegEintraege';
import { formatEuro, todayIso } from './format';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport } from './pdfTabelle';

/** Names of the chosen Kostenstelle and Kategorie, as the filter shows them. */
export interface BelegFilterNamen {
  kostenstelle?: string;
  kategorie?: string;
}

/** The active filters in words, e.g. „Stand: Bezahlt · Kostenstelle: Sommerlager“. */
export function belegFilterText(filter: BelegFilter, namen: BelegFilterNamen = {}): string {
  const parts = [
    filter.quelle && `Quelle: ${BELEG_QUELLEN.find((q) => q.value === filter.quelle)?.label}`,
    filter.stand && `Stand: ${BELEG_STAENDE.find((s) => s.value === filter.stand)?.label}`,
    filter.costUnitId && `Kostenstelle: ${namen.kostenstelle ?? filter.costUnitId}`,
    filter.categoryId && `Kategorie: ${namen.kategorie ?? filter.categoryId}`,
    filter.search.trim() && `Suche: „${filter.search.trim()}“`,
    filter.onlyMine && 'Nur meine Belege',
  ];
  return parts.filter(Boolean).join(' · ');
}

function betrag(eintrag: BelegEintrag): string {
  if (!eintrag.hasAmount) return '–';
  return eintrag.income ? `+ ${formatEuro(eintrag.amountCent)}` : formatEuro(eintrag.amountCent);
}

function beschreibung(eintrag: BelegEintrag): string {
  const nummer = eintrag.campflow?.number ?? eintrag.beleg?.campflow?.number;
  const note = eintrag.beleg?.note.trim();
  return [eintrag.title, note, nummer && `Beleg ${nummer}`].filter(Boolean).join('\n');
}

const count = (n: number): string => (n === 1 ? '1 Beleg' : `${n} Belege`);
const sum = (eintraege: readonly BelegEintrag[]): number =>
  eintraege.reduce((total, e) => total + e.amountCent, 0);

/** The listed receipts as a report with one table; pure, so it can be tested without a browser. */
export function belegePdfReport(
  eintraege: readonly BelegEintrag[],
  filter: BelegFilter,
  namen: BelegFilterNamen = {}
): PdfReport {
  const ausgaben = eintraege.filter((e) => e.hasAmount && !e.income);
  const einnahmen = eintraege.filter((e) => e.hasAmount && e.income);
  const ohne = eintraege.length - ausgaben.length - einnahmen.length;
  const foot = [
    ['', `Ausgaben · ${count(ausgaben.length)}`, '', '', formatEuro(sum(ausgaben)), ''],
  ];
  if (einnahmen.length > 0) {
    foot.push([
      '',
      `Einnahmen · ${count(einnahmen.length)}`,
      '',
      '',
      `+ ${formatEuro(sum(einnahmen))}`,
      '',
    ]);
  }
  const filterText = belegFilterText(filter, namen);
  return {
    title: 'Belege',
    subtitle: [count(eintraege.length), ohne > 0 ? `davon ${ohne} ohne Betrag` : '']
      .filter(Boolean)
      .join(', '),
    notes: filterText ? [`Filter: ${filterText}`] : [],
    sections: [
      {
        columns: [
          'Datum',
          'Beschreibung',
          'Bezahlt von',
          'Kostenstelle / Aktion',
          'Betrag',
          'Stand',
        ],
        rows: eintraege.map((eintrag) => [
          eintrag.date ? formatIsoDate(eintrag.date) : '',
          beschreibung(eintrag),
          eintrag.paidBy ?? '',
          eintrag.where,
          betrag(eintrag),
          eintrag.label,
        ]),
        foot,
        alignRight: [4],
        widths: { 0: 19, 1: 44, 2: 26, 4: 22, 5: 30 },
      },
    ],
    fileName: pdfFileName('Belege', filterText ? 'Auswahl' : '', todayIso()),
  };
}

export async function downloadBelegePdf(
  eintraege: readonly BelegEintrag[],
  filter: BelegFilter,
  namen: BelegFilterNamen = {}
): Promise<void> {
  await downloadReportPdf(belegePdfReport(eintraege, filter, namen));
}
