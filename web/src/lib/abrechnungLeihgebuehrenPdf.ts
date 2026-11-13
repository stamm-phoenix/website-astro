// PDF of the Materialleihgebühren of an Aktion (letter with a table), also the last page of the
// Nachweise. Loaded on click with the other PDF modules.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn } from 'jspdf-autotable';
import { saveFile } from './api';
import { drawBriefFuss, drawBriefkopf, loadBriefBilder } from './abrechnungBriefPdf';
import type { LeihgebuehrPosition } from './abrechnungRechnung';
import { formatEuro } from './format';
import { BRAND, MARGIN, PAGE_WIDTH, loadPdf } from './pdfBasis';
import type { Vorstand } from './types';

export interface PdfLeihgebuehren {
  aktion: string;
  von: string;
  bis: string;
  positions: LeihgebuehrPosition[];
  totalCent: number;
  vorstaende: Vorstand[];
  beschluss: string;
}

/** The letter „Leihgebühren für Zelte und Material“ with letterhead and footer. */
export async function drawLeihgebuehren(
  doc: JsPdf,
  autoTable: typeof AutoTableFn,
  data: PdfLeihgebuehren
): Promise<void> {
  const bilder = await loadBriefBilder();
  let top = drawBriefkopf(doc, bilder, data.vorstaende);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text('Leihgebühren für Zelte und Material', MARGIN, top);
  top += 9;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  for (const line of [
    `Die Leihgebühren der folgenden Tabelle wurden in der ${data.beschluss} festgelegt.`,
    `Für die Aktion „${data.aktion}“ vom ${data.von} bis ${data.bis} wurden entliehen:`,
  ]) {
    const wrapped = doc.splitTextToSize(line, PAGE_WIDTH - 2 * MARGIN);
    doc.text(wrapped, MARGIN, top);
    top += 5 * wrapped.length + 1;
  }

  autoTable(doc, {
    startY: top + 2,
    margin: { left: MARGIN, right: MARGIN, bottom: 45 },
    head: [['Anzahl', 'Material', 'Gebühr pro Tag', 'Tage', 'Betrag']],
    body: data.positions.map((p) => [
      String(p.count),
      p.name,
      formatEuro(p.priceCent),
      String(p.days),
      formatEuro(p.cent),
    ]),
    foot: [['', '', '', 'Summe', formatEuro(data.totalCent)]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.6, lineColor: [210, 214, 220] },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 238, 242], textColor: BRAND, fontStyle: 'bold' },
    didParseCell: (cell) => {
      if ([0, 2, 3, 4].includes(cell.column.index)) cell.cell.styles.halign = 'right';
    },
  });

  drawBriefFuss(doc, bilder);
}

/** The Materialleihgebühren as a PDF to upload to CampFlow as receipt. */
export async function downloadLeihgebuehrenPdf(
  data: PdfLeihgebuehren,
  fileName: string
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  await drawLeihgebuehren(doc, autoTable, data);
  saveFile(doc.output('blob'), fileName);
}
