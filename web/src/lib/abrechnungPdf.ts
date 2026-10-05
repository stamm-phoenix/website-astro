// PDF export of the lists of an Abrechnung. jsPDF is loaded only when a list is exported, so
// it does not weigh on the page itself.

export interface PdfTable {
  /** Big heading on the first page, e.g. „Teilnehmende“. */
  title: string;
  /** Second line, e.g. the Aktion and its dates. */
  subtitle: string;
  /** Short notes below the subtitle, e.g. the active filter. */
  notes?: string[];
  columns: string[];
  rows: string[][];
  /** Rows below the table, e.g. sums. */
  foot?: string[][];
  /** Column indexes to align right (amounts, numbers). */
  alignRight?: number[];
  landscape?: boolean;
  fileName: string;
}

const BRAND: [number, number, number] = [0, 48, 86]; // DPSG blue #003056
const GREY: [number, number, number] = [90, 90, 90];
const MARGIN = 14;

/** Characters Windows does not allow in file names. */
export function pdfFileName(...parts: string[]): string {
  const name = parts
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name || 'Abrechnung'}.pdf`;
}

/** Builds the PDF in the browser and offers it as a download. */
export async function downloadTablePdf(table: PdfTable): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: table.landscape ? 'landscape' : 'portrait', unit: 'mm' });
  const created = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date());

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text(table.title, MARGIN, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  let y = 25;
  for (const line of [table.subtitle, ...(table.notes ?? [])]) {
    const wrapped = doc.splitTextToSize(line, doc.internal.pageSize.getWidth() - 2 * MARGIN);
    doc.text(wrapped, MARGIN, y);
    y += 5 * wrapped.length;
  }

  const alignRight = new Set(table.alignRight ?? []);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    head: [table.columns],
    body: table.rows,
    foot: table.foot,
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, overflow: 'linebreak' },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 238, 242], textColor: BRAND, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: Object.fromEntries(
      [...alignRight].map((index) => [index, { halign: 'right' as const }])
    ),
    didParseCell: (data) => {
      if (alignRight.has(data.column.index)) data.cell.styles.halign = 'right';
    },
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    const height = doc.internal.pageSize.getHeight();
    const width = doc.internal.pageSize.getWidth();
    doc.text(`DPSG Stamm Phoenix · erstellt am ${created}`, MARGIN, height - 8);
    doc.text(`Seite ${page} von ${pages}`, width - MARGIN, height - 8, { align: 'right' });
  }

  doc.save(table.fileName);
}
