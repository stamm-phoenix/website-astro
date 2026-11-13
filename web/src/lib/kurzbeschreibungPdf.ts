// PDF of the Kurzbeschreibung of an Aktion for the KJR on the Stamm's letter paper. Loaded on
// click with the other PDF modules.
import type { jsPDF as JsPdf } from 'jspdf';
import { saveFile } from './api';
import {
  BRIEF_FUSS_SPACE,
  FOLGESEITE_TOP,
  drawBriefkopf,
  drawBriefseiten,
  loadBriefBilder,
} from './abrechnungBriefPdf';
import {
  ZEITPLAN_FONT,
  ZEITPLAN_GAP,
  ZEITPLAN_HEADER,
  ZEITPLAN_LINE,
  ZEITPLAN_ROW_GAP,
  placeZeitplan,
} from './kurzbeschreibungZeitplan';
import type { PlacedItem, ZeitplanItem } from './kurzbeschreibungZeitplan';
import { BRAND, GREY, MARGIN, PAGE_HEIGHT, PAGE_WIDTH, loadPdf } from './pdfBasis';
import type { Vorstand } from './types/oeffentlich';

/** The Kurzbeschreibung for the KJR, with dates and times already formatted. */
export interface PdfKurzbeschreibung {
  aktion: string;
  zeitraum: string;
  einleitung: string;
  /** Days with at least one block, e.g. „Montag, 25.05.2026“. */
  tage: { titel: string; bloecke: { zeit: string; text: string }[] }[];
  vorstaende: Vorstand[];
}

function drawZeitplanHeader(doc: JsPdf, titel: string, x: number, y: number, width: number): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...BRAND);
  doc.text(titel, x, y + 4);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.3);
  doc.line(x, y + 5.3, x + width, y + 5.3);
}

/**
 * The Kurzbeschreibung of an Aktion for the KJR's grant on the Stamm's letter paper: the Aktion
 * and its dates, the sentence about its aim and the Zeitplan. The blocks are short, so the
 * Zeitplan goes into two or three columns, balanced so that a short Aktion fits on one page.
 */
export async function downloadKurzbeschreibungPdf(
  data: PdfKurzbeschreibung,
  fileName: string
): Promise<void> {
  const [{ doc }, bilder] = await Promise.all([loadPdf(), loadBriefBilder()]);
  let top = drawBriefkopf(doc, bilder, data.vorstaende);
  const width = PAGE_WIDTH - 2 * MARGIN;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text('Kurzbeschreibung', MARGIN, top - 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  const title = doc.splitTextToSize(data.aktion, width);
  doc.text(title, MARGIN, top);
  top += 6.5 * (title.length - 1) + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(30, 30, 30);
  doc.text(data.zeitraum, MARGIN, top);
  top += 9;

  // A long Zielsetzung or Zeitplan goes on below the short header of a follow page
  const bottom = PAGE_HEIGHT - BRIEF_FUSS_SPACE - 2;
  const room = (height: number): void => {
    if (top + height <= bottom) return;
    doc.addPage('a4', 'portrait');
    top = FOLGESEITE_TOP + 4;
  };
  const section = (heading: string, keepWith: number): void => {
    room(5.5 + keepWith);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND);
    doc.text(heading, MARGIN, top);
    top += 5.5;
  };
  if (data.einleitung.trim()) {
    section('Zielsetzung', 4.6);
    for (const paragraph of data.einleitung.trim().split(/\n\s*\n/)) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines: string[] = doc.splitTextToSize(paragraph.replace(/\s*\n\s*/g, ' '), width);
      for (const line of lines) {
        room(4.6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(30, 30, 30);
        doc.text(line, MARGIN, top);
        top += 4.6;
      }
      top += 2;
    }
    top += 4;
  }

  const tage = data.tage.filter((tag) => tag.bloecke.length > 0);
  if (tage.length > 0) {
    const columns = tage.length === 2 ? 2 : 3;
    const columnWidth = (width - ZEITPLAN_GAP * (columns - 1)) / columns;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(ZEITPLAN_FONT);
    const zeitWidth = Math.min(
      columnWidth / 2,
      Math.max(0, ...tage.flatMap((t) => t.bloecke.map((b) => doc.getTextWidth(b.zeit)))) + 2.5
    );
    doc.setFont('helvetica', 'normal');
    const items: ZeitplanItem[] = tage.flatMap((tag, index) => [
      { tag: index, header: true, zeit: '', lines: [], height: ZEITPLAN_HEADER },
      ...tag.bloecke.map((block) => {
        const lines: string[] = doc.splitTextToSize(
          block.text || '–',
          columnWidth - (block.zeit ? zeitWidth : 0)
        );
        return {
          tag: index,
          header: false,
          zeit: block.zeit,
          lines,
          height: ZEITPLAN_LINE * lines.length + ZEITPLAN_ROW_GAP,
        };
      }),
    ]);
    // The heading stays with the first day's heading and block
    section('Zeitplan', items[0].height + items[1].height);
    top -= 1.5;
    const zeitplanPage = doc.getNumberOfPages();

    // Up to three days each in a column of their own; otherwise the shortest columns that
    // still fit on the first page; otherwise as many pages as needed
    const available = bottom - top;
    const dayHeights = tage.map((_tag, index) =>
      items.filter((item) => item.tag === index).reduce((sum, item) => sum + item.height, 0)
    );
    let placed: PlacedItem[] | null = null;
    if (tage.length <= columns && Math.max(...dayHeights) <= available) {
      let y = 0;
      placed = items.map((item, index) => {
        if (item.header && index > 0) y = 0;
        const at = { item, continued: false, page: 1, column: item.tag, y: top + y };
        y += item.height;
        return at;
      });
    } else if (placeZeitplan(items, columns, top, available, 1)) {
      let low = Math.max(...items.map((item) => item.height)) + ZEITPLAN_HEADER;
      let high = available;
      while (high - low > 0.5) {
        const middle = (low + high) / 2;
        if (placeZeitplan(items, columns, top, middle, 1)) high = middle;
        else low = middle;
      }
      placed = placeZeitplan(items, columns, top, high, 1);
    }
    placed ??= placeZeitplan(items, columns, top, available) ?? [];

    for (const { item, continued, page, column, y } of placed) {
      const actual = zeitplanPage + page - 1;
      while (doc.getNumberOfPages() < actual) doc.addPage('a4', 'portrait');
      doc.setPage(actual);
      const x = MARGIN + column * (columnWidth + ZEITPLAN_GAP);
      const titel = tage[item.tag].titel;
      if (item.header) {
        drawZeitplanHeader(doc, titel, x, y, columnWidth);
        continue;
      }
      if (continued) {
        drawZeitplanHeader(doc, `${titel} (Fortsetzung)`, x, y - ZEITPLAN_HEADER, columnWidth);
      }
      doc.setFontSize(ZEITPLAN_FONT);
      const baseline = y + ZEITPLAN_LINE - 0.6;
      if (item.zeit) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...GREY);
        doc.text(item.zeit, x, baseline);
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
      doc.text(item.lines, x + (item.zeit ? zeitWidth : 0), baseline, {
        lineHeightFactor: ZEITPLAN_LINE / ((ZEITPLAN_FONT * 25.4) / 72),
      });
    }
  }

  drawBriefseiten(doc, bilder, `Kurzbeschreibung „${data.aktion}“`);
  saveFile(doc.output('blob'), fileName);
}
