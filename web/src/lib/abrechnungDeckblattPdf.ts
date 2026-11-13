// PDF of the Deckblatt of an Abrechnungsmappe. Loaded on click with the other PDF modules.
import { saveFile } from './api';
import { BRAND, GREY, PAGE_WIDTH, loadPdf } from './pdfBasis';
import { drawImage, loadImage } from './pdfBild';

export interface PdfDeckblatt {
  title: string;
  zeitraum: string;
  kostenstelle: string;
  leitende: number;
  teilnehmende: number;
  summe: number;
  vorkalkulation: string;
  kalkulation: string;
}

/** The Deckblatt of the Abrechnungsmappe. */
export async function downloadDeckblattPdf(
  deckblatt: PdfDeckblatt,
  fileName: string
): Promise<void> {
  const { doc } = await loadPdf();
  const logo = await loadImage('/stammeslilie.png').catch(() => null);
  if (logo) drawImage(doc, logo, (PAGE_WIDTH - 40) / 2, 30, 40, 52, 'PNG');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...GREY);
  doc.text('Abrechnung', PAGE_WIDTH / 2, 100, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(...BRAND);
  doc.text(doc.splitTextToSize(deckblatt.title, PAGE_WIDTH - 40), PAGE_WIDTH / 2, 113, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text(deckblatt.zeitraum, PAGE_WIDTH / 2, 128, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  doc.text(`Kostenstelle „${deckblatt.kostenstelle}“`, PAGE_WIDTH / 2, 135, { align: 'center' });

  const rows: [string, string][] = [
    ['Leitende (Betreuer*innen):', String(deckblatt.leitende)],
    ['Teilnehmende:', String(deckblatt.teilnehmende)],
    ['Summe:', String(deckblatt.summe)],
    ['Vorkalkulation von:', deckblatt.vorkalkulation || '–'],
    ['Abschließende Kalkulation von:', deckblatt.kalkulation || '–'],
  ];
  let y = 160;
  rows.forEach(([label, value], index) => {
    if (index === 3) y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...BRAND);
    doc.text(label, 45, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    const wrapped = doc.splitTextToSize(value, 70);
    doc.text(wrapped, 115, y);
    y += 6 * Math.max(1, wrapped.length) + 4;
  });
  saveFile(doc.output('blob'), fileName);
}
