// PDF of an Eigenbeleg on the Stamm's letter paper. Loaded on click with the other PDF modules.
import { saveFile } from './api';
import {
  BRIEF_FUSS_SPACE,
  FOLGESEITE_TOP,
  drawBriefkopf,
  drawBriefseiten,
  loadBriefBilder,
} from './abrechnungBriefPdf';
import { formatEuro } from './format';
import { BRAND, GREY, MARGIN, PAGE_HEIGHT, PAGE_WIDTH, loadPdf } from './pdfBasis';
import type { Vorstand } from './types';

/** An Eigenbeleg as printed, with dates already formatted. */
export interface PdfEigenbeleg {
  aussteller: string;
  empfaenger: string;
  zahlungsdatum: string;
  zahlungsart: string;
  anlass: string;
  positionen: { beschreibung: string; cent: number }[];
  totalCent: number;
  grund: string;
  ort: string;
  datum: string;
  vorstaende: Vorstand[];
}

/** The Eigenbeleg on the Stamm's letter paper, to sign and upload or hand in as receipt. */
export async function downloadEigenbelegPdf(data: PdfEigenbeleg, fileName: string): Promise<void> {
  const [{ doc, autoTable }, bilder] = await Promise.all([loadPdf(), loadBriefBilder()]);
  let top = drawBriefkopf(doc, bilder, data.vorstaende, data.datum);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text('Eigenbeleg', MARGIN, top);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text('Ersatzbeleg für eine Ausgabe ohne Originalbeleg', MARGIN, top + 5.5);
  top += 10;

  /** Bottom of the last table drawn by jspdf-autotable. */
  const tableEnd = (): number =>
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? top;
  const cellStyles = {
    font: 'helvetica',
    fontSize: 9.5,
    cellPadding: 1.8,
    lineColor: [210, 214, 220] as [number, number, number],
    textColor: [30, 30, 30] as [number, number, number],
  };

  autoTable(doc, {
    startY: top,
    margin: { left: MARGIN, right: MARGIN, top: FOLGESEITE_TOP, bottom: BRIEF_FUSS_SPACE },
    body: [
      ['Ausgelegt von', data.aussteller],
      ['Bezahlt an', data.empfaenger],
      ['Datum der Zahlung', data.zahlungsdatum],
      ['Zahlungsart', data.zahlungsart],
      ['Aktion / Zweck', data.anlass],
    ],
    theme: 'grid',
    styles: cellStyles,
    columnStyles: {
      0: { cellWidth: 45, fontStyle: 'bold', textColor: BRAND, fillColor: [235, 238, 242] },
    },
  });

  autoTable(doc, {
    startY: tableEnd() + 6,
    margin: { left: MARGIN, right: MARGIN, top: FOLGESEITE_TOP, bottom: BRIEF_FUSS_SPACE },
    head: [['Pos.', 'Was wurde bezahlt?', 'Betrag']],
    body: data.positionen.map((p, index) => [
      String(index + 1),
      p.beschreibung,
      formatEuro(p.cent),
    ]),
    foot: [['', 'Summe', formatEuro(data.totalCent)]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: cellStyles,
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 238, 242], textColor: BRAND, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 14 }, 2: { cellWidth: 32 } },
    didParseCell: (cell) => {
      if (cell.column.index !== 1) cell.cell.styles.halign = 'right';
    },
  });

  // Reason, declaration and signatures stay together, on a new page if needed
  const width = PAGE_WIDTH - 2 * MARGIN;
  doc.setFontSize(9.5);
  const grund = doc.splitTextToSize(data.grund, width);
  const erklaerung = doc.splitTextToSize(
    `Ich bestätige, dass ich den Betrag von ${formatEuro(data.totalCent)} für den DPSG Stamm Phoenix bezahlt habe, dass es dafür keinen anderen Beleg gibt und dass ich ihn nicht anderweitig zur Erstattung eingereicht habe.`,
    width
  );
  const blockHeight = 8 + 4.5 * grund.length + 6 + 4.5 * erklaerung.length + 40;
  let y = tableEnd() + 9;
  if (y + blockHeight > PAGE_HEIGHT - BRIEF_FUSS_SPACE) {
    doc.addPage();
    y = FOLGESEITE_TOP + 4;
  }

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND);
  doc.text('Warum gibt es keinen Originalbeleg?', MARGIN, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text(grund, MARGIN, y);
  y += 4.5 * grund.length + 6;
  doc.text(erklaerung, MARGIN, y);
  y += 4.5 * erklaerung.length + 4;
  doc.text(`${data.ort}, ${data.datum}`, MARGIN, y);
  y += 20;

  // Signatures with room above the lines: who paid, and the Kasse or Vorstand who checked it
  const columnWidth = (width - 12) / 2;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  for (const [index, label] of [
    `Unterschrift ${data.aussteller}`,
    'Sachlich richtig: Datum, Unterschrift Kasse oder Vorstand',
  ].entries()) {
    const x = MARGIN + index * (columnWidth + 12);
    doc.line(x, y, x + columnWidth, y);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(doc.splitTextToSize(label, columnWidth), x, y + 4);
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 30);
  }

  drawBriefseiten(doc, bilder, `Eigenbeleg vom ${data.datum}`);
  saveFile(doc.output('blob'), fileName);
}
