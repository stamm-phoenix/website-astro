// PDF of a QR code: a DIN A4 Aushang with the code large in the middle and a text and the link
// below, or a sheet of small codes to cut out and stick on.
import { BRAND, GREY, PAGE_HEIGHT, PAGE_WIDTH, loadPdf } from './pdfBasis';
import { saveFile } from './api';

export type QrPdfArt = 'aushang' | 'aufkleber';

export const QR_PDF_ARTEN: { value: QrPdfArt; label: string }[] = [
  { value: 'aushang', label: 'Aushang' },
  { value: 'aufkleber', label: 'Aufkleber' },
];

/** Columns and rows of the sheet of small codes. */
export const AUFKLEBER_SPALTEN = 4;
export const AUFKLEBER_ZEILEN = 5;
const BOGEN_RAND = 10;
/** Space below a small code for two lines of text. */
const AUFKLEBER_TEXT = 9;
const AUFKLEBER_ABSTAND = 4;

const POSTER_CODE = 150;
const POSTER_TEXT_ZEILE = 12;
const POSTER_LINK_ZEILE = 6.5;

/** The link as people read it, without „https://“ and a closing slash; `''` for other text. */
export function qrLinkText(text: string): string {
  const value = text.trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return '';
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export interface QrFeld {
  x: number;
  y: number;
  size: number;
}

/** Where the code of each sticker sits, row by row; all fit on one DIN A4 page. */
export function qrAufkleberRaster(): QrFeld[] {
  const width = (PAGE_WIDTH - 2 * BOGEN_RAND) / AUFKLEBER_SPALTEN;
  const height = (PAGE_HEIGHT - 2 * BOGEN_RAND) / AUFKLEBER_ZEILEN;
  const size = Math.min(width, height - AUFKLEBER_TEXT) - 2 * AUFKLEBER_ABSTAND;
  const felder: QrFeld[] = [];
  for (let row = 0; row < AUFKLEBER_ZEILEN; row++) {
    for (let column = 0; column < AUFKLEBER_SPALTEN; column++) {
      felder.push({
        x: BOGEN_RAND + column * width + (width - size) / 2,
        y: BOGEN_RAND + row * height + AUFKLEBER_ABSTAND,
        size,
      });
    }
  }
  return felder;
}

/** Top of the code on the Aushang, so code, text and link sit together in the middle. */
export function qrAushangOben(textZeilen: number, linkZeilen: number): number {
  const block =
    POSTER_CODE +
    (textZeilen ? 10 + textZeilen * POSTER_TEXT_ZEILE : 0) +
    (linkZeilen ? 6 + linkZeilen * POSTER_LINK_ZEILE : 0);
  return Math.max(20, (PAGE_HEIGHT - block) / 2);
}

export interface QrPdf {
  art: QrPdfArt;
  /** The code as a PNG data URL, drawn with the chosen colours, form and logo. */
  bild: string;
  /** What the code holds; a link is printed below it on the Aushang. */
  text: string;
  /** Optional line below the code, e.g. „Zur Anmeldung“. */
  beschriftung: string;
  fileName: string;
}

export async function downloadQrPdf(pdf: QrPdf): Promise<void> {
  const { doc } = await loadPdf();
  const beschriftung = pdf.beschriftung.trim();
  const center = PAGE_WIDTH / 2;
  if (pdf.art === 'aushang') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    const textZeilen: string[] = beschriftung
      ? doc.splitTextToSize(beschriftung, PAGE_WIDTH - 40).slice(0, 4)
      : [];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    const link = qrLinkText(pdf.text);
    const linkZeilen: string[] = link ? doc.splitTextToSize(link, PAGE_WIDTH - 40).slice(0, 3) : [];
    let y = qrAushangOben(textZeilen.length, linkZeilen.length);
    doc.addImage(pdf.bild, 'PNG', center - POSTER_CODE / 2, y, POSTER_CODE, POSTER_CODE);
    y += POSTER_CODE;
    if (textZeilen.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(30);
      doc.setTextColor(...BRAND);
      y += 10;
      textZeilen.forEach((line, index) => {
        doc.text(line, center, y + 8 + index * POSTER_TEXT_ZEILE, { align: 'center' });
      });
      y += textZeilen.length * POSTER_TEXT_ZEILE;
    }
    if (linkZeilen.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(14);
      doc.setTextColor(...GREY);
      y += 6;
      linkZeilen.forEach((line, index) => {
        doc.text(line, center, y + 4 + index * POSTER_LINK_ZEILE, { align: 'center' });
      });
    }
  } else {
    doc.setDrawColor(200, 200, 200);
    doc.setLineDashPattern([1, 1.5], 0);
    const width = (PAGE_WIDTH - 2 * BOGEN_RAND) / AUFKLEBER_SPALTEN;
    const height = (PAGE_HEIGHT - 2 * BOGEN_RAND) / AUFKLEBER_ZEILEN;
    // Lines to cut along
    for (let column = 0; column <= AUFKLEBER_SPALTEN; column++) {
      const x = BOGEN_RAND + column * width;
      doc.line(x, BOGEN_RAND, x, PAGE_HEIGHT - BOGEN_RAND);
    }
    for (let row = 0; row <= AUFKLEBER_ZEILEN; row++) {
      const y = BOGEN_RAND + row * height;
      doc.line(BOGEN_RAND, y, PAGE_WIDTH - BOGEN_RAND, y);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND);
    for (const feld of qrAufkleberRaster()) {
      // The same alias embeds the image once for all stickers
      doc.addImage(pdf.bild, 'PNG', feld.x, feld.y, feld.size, feld.size, 'qr');
      if (beschriftung) {
        const lines: string[] = doc.splitTextToSize(beschriftung, width - 4).slice(0, 2);
        doc.text(lines, feld.x + feld.size / 2, feld.y + feld.size + 3.5, { align: 'center' });
      }
    }
  }
  saveFile(doc.output('blob'), pdf.fileName);
}
