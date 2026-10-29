// Shared parts of the PDFs built in the browser (`abrechnungPdf.ts`, `essensplanungPdf.ts`).
// jsPDF is loaded only when a PDF is created, so it does not weigh on the page itself. DIN A4.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn } from 'jspdf-autotable';

export const BRAND: [number, number, number] = [0, 48, 86]; // DPSG blue #003056
export const RED: [number, number, number] = [129, 10, 26]; // DPSG red #810a1a
export const GREY: [number, number, number] = [90, 90, 90];
export const MARGIN = 14;
/** Portrait; landscape pages read their size from the document. */
export const PAGE_WIDTH = 210;
export const PAGE_HEIGHT = 297;
export const FOOTER_SPACE = 16;

export const today = (): string =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(
    new Date()
  );

/** A file name of the parts, without characters Windows does not allow; `fallback` when empty. */
export function dateiName(fallback: string, ...parts: string[]): string {
  const name = parts
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name || fallback}.pdf`;
}

/** A new document and the table plugin; landscape for wide tables. */
export async function loadPdf(orientation: 'portrait' | 'landscape' = 'portrait'): Promise<{
  doc: JsPdf;
  autoTable: typeof AutoTableFn;
}> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return {
    doc: new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true }),
    autoTable,
  };
}

/** The title and the lines below it; returns where the content starts. */
export function drawTitle(doc: JsPdf, title: string, lines: string[]): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text(title, MARGIN, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  let y = 25;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, doc.internal.pageSize.getWidth() - 2 * MARGIN);
    doc.text(wrapped, MARGIN, y);
    y += 5 * wrapped.length;
  }
  return y;
}

/** Page numbers and the creation date on every page. */
export function drawPageFooters(doc: JsPdf): void {
  const created = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date());
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`DPSG Stamm Phoenix · erstellt am ${created}`, MARGIN, height - 8);
    doc.text(`Seite ${page} von ${pages}`, width - MARGIN, height - 8, {
      align: 'right',
    });
  }
}
