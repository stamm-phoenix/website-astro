// Letter paper of the Stamm for the PDFs of the Abrechnung (Leihgebühren, Eigenbeleg,
// Kurzbeschreibung): letterhead, short header of follow pages and footer.
import type { jsPDF as JsPdf } from 'jspdf';
import { PAGE_HEIGHT, PAGE_WIDTH, MARGIN, BRAND, GREY, RED, today } from './pdfBasis';
import { drawImage, loadImage } from './pdfBild';
import type { PdfImage } from './pdfBild';
import type { Vorstand } from './types/oeffentlich';

const FOOTER_TEXT =
  'Die Deutsche Pfadfinderschaft Sankt Georg (DPSG) ist als anerkannter Träger freier Jugendhilfe Mitglied im Bayerischen Jugendring (BJR) und als Verband katholischer Pfadfinderinnen und Pfadfinder Mitglied im Bund der Deutschen Katholischen Jugend (BDKJ) und der Internationalen Katholischen Konferenz des Pfadfindertums (IKKP). Die DPSG ist Mitglied im Ring deutscher Pfadfinderverbände (RdP) und von der World Organisation of the Scout Movement (WOSM) als Mitgliedsverband der Weltpfadfinderbewegung offiziell anerkannt.';

/** Images of the letterhead and the footer of the Stamm's letters. */
export interface BriefBilder {
  logo: PdfImage | null;
  dpsg: PdfImage | null;
}

/** Loads the images of the letters; a missing one is left out instead of failing the PDF. */
export async function loadBriefBilder(): Promise<BriefBilder> {
  const [logo, dpsg] = await Promise.all([
    loadImage('/stammeslilie.png').catch(() => null),
    loadImage('/abrechnung/dpsg-stamm-phoenix.png').catch(() => null),
  ]);
  return { logo, dpsg };
}

/**
 * Letterhead of the Stamm's letters: logo and Stamm on the left, Stammesvorsitzende and the date
 * on the right. Returns where the letter can start.
 */
export function drawBriefkopf(
  doc: JsPdf,
  bilder: BriefBilder,
  vorstaende: Vorstand[],
  datum = today()
): number {
  const { logo } = bilder;
  if (logo) drawImage(doc, logo, MARGIN, 12, 22, 29, 'PNG');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND);
  doc.text('DPSG Stamm Phoenix', 42, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(['Pfarrei Sankt Laurentius', 'Feldkirchen-Westerham'], 42, 26);

  const right = 140;
  let y = 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND);
  doc.text('Stammesvorsitzende', right, y);
  y += 5;
  doc.setFontSize(8);
  for (const vorstand of vorstaende) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(vorstand.name, right, y);
    y += 3.6;
    doc.setFont('helvetica', 'normal');
    for (const line of [vorstand.telephone, vorstand.street, vorstand.city]) {
      if (!line) continue;
      doc.text(line, right, y);
      y += 3.6;
    }
    y += 2;
  }
  doc.setFont('helvetica', 'normal');
  doc.text(['www.stamm-phoenix.de', 'kontakt@stamm-phoenix.de'], right, y);
  y += 9;
  doc.text(datum, right, y);
  return Math.max(y + 12, 62);
}

/** Footer of the Stamm's letters with the DPSG's text and logo; keep 45 mm free above it. */
export function drawBriefFuss(doc: JsPdf, bilder: BriefBilder): void {
  const footerTop = PAGE_HEIGHT - 40;
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, footerTop, PAGE_WIDTH - MARGIN, footerTop);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 30, 30);
  doc.text('Deutsche Pfadfinderschaft Sankt Georg', MARGIN, footerTop + 5);
  doc.setFont('helvetica', 'normal');
  doc.text('13/19/12 Stamm Phoenix Feldkirchen-Westerham', MARGIN, footerTop + 8.5);
  doc.setFontSize(6);
  doc.setTextColor(...GREY);
  doc.text(doc.splitTextToSize(FOOTER_TEXT, 135), MARGIN, footerTop + 12.5);
  if (bilder.dpsg) {
    drawImage(doc, bilder.dpsg, PAGE_WIDTH - MARGIN - 40, footerTop + 3, 40, 22, 'PNG');
  }
}

/** Space for the footer of the letter, which the content must not reach. */
export const BRIEF_FUSS_SPACE = 45;
/** Where the content of a follow page starts, below its short header. */
export const FOLGESEITE_TOP = 30;

/**
 * Short header of a letter's follow pages, as the full letterhead is only on the first one:
 * small logo, Stamm and subject on the left, page number on the right.
 */
function drawFolgeseitenKopf(
  doc: JsPdf,
  bilder: BriefBilder,
  betreff: string,
  page: number,
  pages: number
): void {
  if (bilder.logo) drawImage(doc, bilder.logo, MARGIN, 9, 9, 12, 'PNG');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND);
  doc.text('DPSG Stamm Phoenix', MARGIN + 12, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  const seite = `Seite ${page} von ${pages}`;
  // A long subject, such as the name of an Aktion, is cut short before the page number
  const room = PAGE_WIDTH - 2 * MARGIN - 12 - doc.getTextWidth(seite) - 6;
  let text = betreff;
  while (text.length > 1 && doc.getTextWidth(text) > room) text = `${text.slice(0, -2)}…`;
  doc.text(text, MARGIN + 12, 19);
  doc.text(seite, PAGE_WIDTH - MARGIN, 19, { align: 'right' });
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, 23, PAGE_WIDTH - MARGIN, 23);
}

/**
 * Finishes a letter of several pages on the Stamm's letter paper: the short header on the follow
 * pages and the footer on every page. Call it after all content is drawn, as it needs the number
 * of pages; the content keeps `FOLGESEITE_TOP` and `BRIEF_FUSS_SPACE` free.
 */
export function drawBriefseiten(doc: JsPdf, bilder: BriefBilder, betreff: string): void {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (page > 1) drawFolgeseitenKopf(doc, bilder, betreff, page, pages);
    drawBriefFuss(doc, bilder);
  }
}
