// Lists as PDF: one table, or a report with several sections (e.g. one per group or shop), each
// with a heading, a few lines and its table. DIN A4, portrait or landscape for wide tables.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn } from 'jspdf-autotable';
import { saveFile } from './api';
import { BRAND, FOOTER_SPACE, GREY, MARGIN, drawPageFooters, drawTitle, loadPdf } from './pdfBasis';
import { pdfText } from './pdfText';

/** The columns and rows of one table. */
export interface PdfTableBody {
  columns: string[];
  rows: string[][];
  /** Rows below the table, e.g. sums. */
  foot?: string[][];
  /** Column indexes to align right (amounts, numbers). */
  alignRight?: number[];
  /** Fixed widths in mm per column index, e.g. a narrow column to tick off. */
  widths?: Record<number, number>;
  /** For lists filled in by hand: lines around every cell and rows of at least this many mm. */
  handwriting?: { rowHeight: number };
}

/** One table on its own, e.g. the Teilnehmende. */
export interface PdfTable extends PdfTableBody {
  /** Big heading on the first page, e.g. „Teilnehmende“. */
  title: string;
  /** Second line, e.g. the Aktion and its dates. */
  subtitle: string;
  /** Short notes below the subtitle, e.g. the active filter. */
  notes?: string[];
  fileName: string;
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
/** Line height of the lines of a section in mm. */
const LINE_HEIGHT = 4.5;
/** Line height of a section heading in mm. */
const HEADING_LINE = 5.5;

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
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 1.5,
      overflow: 'linebreak',
      ...(table.handwriting
        ? { minCellHeight: table.handwriting.rowHeight, lineWidth: 0.2, lineColor: [150, 150, 150] }
        : {}),
    },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold', minCellHeight: 0 },
    footStyles: {
      fillColor: [235, 238, 242],
      textColor: BRAND,
      fontStyle: 'bold',
      minCellHeight: 0,
    },
    alternateRowStyles: { fillColor: table.handwriting ? 255 : [247, 248, 250] },
    columnStyles: Object.fromEntries(
      Object.entries(table.widths ?? {}).map(([index, width]) => [index, { cellWidth: width }])
    ),
    didParseCell: (data) => {
      data.cell.text = data.cell.text.map(pdfText);
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
      const heading: string[] = doc.splitTextToSize(pdfText(section.heading), width - 2 * MARGIN);
      doc.text(heading, MARGIN, y + 4);
      y += 8 + HEADING_LINE * (heading.length - 1);
    }
    if (section.lines?.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...GREY);
      // Long lines, e.g. the names of many voters, go on on the next page above the footer
      for (const line of section.lines) {
        const wrapped: string[] = doc.splitTextToSize(pdfText(line), width - 2 * MARGIN);
        for (const part of wrapped) {
          if (y > height - FOOTER_SPACE) {
            doc.addPage();
            y = 18;
          }
          doc.text(part, MARGIN, y);
          y += LINE_HEIGHT;
        }
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
