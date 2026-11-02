// „Belege als PDF“ of a Planung (`docs/essensplanung.md`, Belege): who paid how much and what
// is still to pay back, the table of all receipts and the photos, two per page. The rows come
// from `essensplanungBelege.ts`; this file only lays them out.
import { saveFile } from './api';
import { datumKurz } from './essensplanung';
import {
  belegDruckZeile,
  belegStatistik,
  belegTitel,
  euro,
  statistikDruck,
} from './essensplanungBelege';
import {
  BRAND,
  FOOTER_SPACE,
  GREY,
  MARGIN,
  dateiName,
  drawPageFooters,
  drawTitle,
  loadPdf,
} from './pdfBasis';
import { pdfText } from './pdfText';
import type { PlanungAnsicht, PlanungBeleg } from './types';

const TABLE_STYLES = {
  styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.5, overflow: 'linebreak' as const },
  headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' as const },
  alternateRowStyles: { fillColor: [247, 248, 250] as [number, number, number] },
};

/** Long edge of a photo in the PDF; enough to read a receipt, small enough to mail the file. */
const FOTO_PIXEL = 1400;

interface PdfBild {
  data: string;
  width: number;
  height: number;
}

async function verkleinern(blob: Blob): Promise<PdfBild> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, FOTO_PIXEL / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not available');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { data: canvas.toDataURL('image/jpeg', 0.8), width: canvas.width, height: canvas.height };
}

function untertitel(ansicht: PlanungAnsicht): string[] {
  const erster = ansicht.tage[0];
  const letzter = ansicht.tage.at(-1);
  const zeit =
    erster && letzter
      ? erster === letzter
        ? datumKurz(erster.datum)
        : `${datumKurz(erster.datum)} bis ${datumKurz(letzter.datum)}`
      : '';
  return [[ansicht.name, zeit].filter(Boolean).join(' · ')];
}

const endeTabelle = (doc: unknown, sonst: number): number =>
  (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? sonst;

/**
 * Builds and downloads the PDF. `bild` loads the picture of a receipt (for a PDF its first
 * page); a picture that fails is named instead.
 */
export async function downloadBelegePdf(
  ansicht: PlanungAnsicht,
  belege: PlanungBeleg[],
  bild: (beleg: PlanungBeleg) => Promise<Blob>
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  const margin = { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE };
  let y = drawTitle(doc, 'Belege', untertitel(ansicht)) + 2;
  const statistik = belegStatistik(belege);
  if (!belege.length) {
    doc.setFontSize(10);
    doc.setTextColor(...GREY);
    doc.text('Noch keine Belege eingetragen.', MARGIN, y + 4);
  } else {
    autoTable(doc, {
      ...TABLE_STYLES,
      startY: y,
      margin,
      head: [['Bezahlt von', 'Belege', 'Bezahlt', 'Noch zu erstatten']],
      body: statistikDruck(statistik),
      columnStyles: {
        1: { halign: 'right', cellWidth: 18 },
        2: { halign: 'right', cellWidth: 32 },
        3: { halign: 'right', cellWidth: 36 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === statistik.personen.length)
          data.cell.styles.fontStyle = 'bold';
      },
    });
    y = endeTabelle(doc, y) + 4;
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text(pdfText(`Davon erstattet: ${euro(statistik.erstattetCent)}`), MARGIN, y + 2);
    y += 6;
    autoTable(doc, {
      ...TABLE_STYLES,
      startY: y,
      margin,
      head: [['Nr.', 'Datum', 'Händler / Was', 'Bezahlt von', 'Betrag', 'Status']],
      body: belege.map((beleg, index) => {
        const zeile = belegDruckZeile(beleg);
        return [
          String(index + 1),
          zeile.datum,
          zeile.notiz ? `${zeile.haendler}\n${zeile.notiz}` : zeile.haendler,
          zeile.bezahltVon,
          zeile.betrag,
          `${zeile.status}${beleg.foto ? '' : ' · ohne Foto'}`,
        ];
      }),
      columnStyles: {
        0: { cellWidth: 10, halign: 'right' },
        1: { cellWidth: 22 },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 30 },
      },
    });
  }

  // The photos, two per page, each with the number of its row
  const mitFoto = belege
    .map((beleg, index) => ({ beleg, nummer: index + 1 }))
    .filter(({ beleg }) => beleg.foto);
  const breite = doc.internal.pageSize.getWidth() - 2 * MARGIN;
  const hoehe = (doc.internal.pageSize.getHeight() - FOOTER_SPACE - 18 - 2 * 10) / 2;
  for (const [index, { beleg, nummer }] of mitFoto.entries()) {
    if (index % 2 === 0) doc.addPage();
    const oben = 14 + (index % 2) * (hoehe + 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND);
    doc.text(pdfText(`Nr. ${nummer} · ${belegTitel(beleg)}`), MARGIN, oben);
    try {
      const geladen = await verkleinern(await bild(beleg));
      const scale = Math.min(breite / geladen.width, (hoehe - 4) / geladen.height);
      doc.addImage(
        geladen.data,
        'JPEG',
        MARGIN,
        oben + 3,
        geladen.width * scale,
        geladen.height * scale,
        undefined,
        'FAST'
      );
    } catch {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GREY);
      doc.text('Das Foto konnte nicht geladen werden.', MARGIN, oben + 8);
    }
  }
  drawPageFooters(doc);
  saveFile(doc.output('blob'), dateiName('Belege', 'Belege', ansicht.name));
}
