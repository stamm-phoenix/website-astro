// Lists as PDF: one table, or a report with several sections (e.g. one per group or shop), each
// with a heading, a few lines and its table. DIN A4, portrait or landscape for wide tables.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn } from 'jspdf-autotable';
import { saveFile } from './api';
import { BRAND, FOOTER_SPACE, GREY, MARGIN, drawPageFooters, drawTitle, loadPdf } from './pdfBasis';

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
  fileName: string;
}

/** The columns and rows of one table; the rest of `PdfTable` describes the page. */
export interface PdfTableBody {
  columns: string[];
  rows: string[][];
  foot?: string[][];
  alignRight?: number[];
  /** Fixed widths in mm per column index, e.g. a narrow column to tick off. */
  widths?: Record<number, number>;
}

export interface PdfSection extends Partial<PdfTableBody> {
  /** Heading of the section, e.g. a group or a shop. */
  heading?: string;
  /** Lines below the heading, e.g. a sum or a contact. */
  lines?: string[];
  /** Starts on a new page, e.g. one page per car. */
  newPage?: boolean;
}

export interface PdfReport {
  title: string;
  subtitle: string;
  notes?: string[];
  sections: PdfSection[];
  landscape?: boolean;
  fileName: string;
}

/** Room a section needs below its heading before it moves to the next page. */
const MIN_SECTION_SPACE = 40;

export function drawTable(
  doc: JsPdf,
  autoTable: typeof AutoTableFn,
  table: PdfTableBody,
  startY: number
): number {
  const alignRight = new Set(table.alignRight ?? []);
  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
    head: [table.columns],
    body: table.rows,
    foot: table.foot,
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 238, 242], textColor: BRAND, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: Object.fromEntries(
      Object.entries(table.widths ?? {}).map(([index, width]) => [index, { cellWidth: width }])
    ),
    didParseCell: (data) => {
      if (alignRight.has(data.column.index)) data.cell.styles.halign = 'right';
    },
  });
  return (
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? startY
  );
}

/** A list as a table, e.g. the Teilnehmende or the Einzelnachweise. */
export async function downloadTablePdf(table: PdfTable): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  const y = drawTitle(doc, table.title, [table.subtitle, ...(table.notes ?? [])]);
  drawTable(doc, autoTable, table, y + 2);
  drawPageFooters(doc);
  saveFile(doc.output('blob'), table.fileName);
}

/** Draws the sections one below the other; a heading never stays alone at the bottom of a page. */
export async function downloadReportPdf(report: PdfReport): Promise<void> {
  const { doc, autoTable } = await loadPdf(report.landscape ? 'landscape' : 'portrait');
  const height = doc.internal.pageSize.getHeight();
  const width = doc.internal.pageSize.getWidth();
  let y = drawTitle(doc, report.title, [report.subtitle, ...(report.notes ?? [])]) + 2;
  let first = true;
  for (const section of report.sections) {
    if ((section.newPage && !first) || y > height - MIN_SECTION_SPACE) {
      doc.addPage();
      y = 18;
    }
    first = false;
    if (section.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...BRAND);
      doc.text(section.heading, MARGIN, y + 4);
      y += 8;
    }
    if (section.lines?.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...GREY);
      for (const line of section.lines) {
        const wrapped = doc.splitTextToSize(line, width - 2 * MARGIN);
        doc.text(wrapped, MARGIN, y);
        y += 4.5 * wrapped.length;
      }
      y += 1;
    }
    if (section.columns && section.rows) {
      y = drawTable(
        doc,
        autoTable,
        { ...section, columns: section.columns, rows: section.rows },
        y
      );
      y += 8;
    } else {
      y += 4;
    }
  }
  drawPageFooters(doc);
  saveFile(doc.output('blob'), report.fileName);
}
