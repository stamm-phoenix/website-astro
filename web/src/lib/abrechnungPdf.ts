// PDF exports of the Abrechnung: lists, the receipts for printing, the Deckblatt, the
// Materialleihgebühren, Eigenbelege and the Kurzbeschreibung for the KJR. jsPDF is loaded only
// when a PDF is created, so it does not weigh on the page itself. All PDFs are DIN A4 portrait.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn } from 'jspdf-autotable';
import { saveFile } from './api';
import { formatEuro } from './format';
import type { LeihgebuehrPosition } from './abrechnungRechnung';
import type { Vorstand } from './types';

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

/** A receipt to print on its own page below its booking. */
export interface PdfBeleg {
  receiptNumber: string;
  /** Label–value pairs shown above the image, e.g. Datum, Beschreibung, Betrag. */
  details: [string, string][];
}

export interface PdfLeihgebuehren {
  aktion: string;
  von: string;
  bis: string;
  positions: LeihgebuehrPosition[];
  totalCent: number;
  vorstaende: Vorstand[];
  beschluss: string;
}

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

const BRAND: [number, number, number] = [0, 48, 86]; // DPSG blue #003056
const RED: [number, number, number] = [129, 10, 26]; // DPSG red #810a1a
const GREY: [number, number, number] = [90, 90, 90];
const MARGIN = 14;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const FOOTER_SPACE = 16;
/** Long edge of receipt images in the PDF; enough for print, keeps the file small. */
const RECEIPT_MAX_PIXELS = 2000;
/** The Playwright API exports at most three pages at the same time. */
const RECEIPT_CONCURRENCY = 3;

const today = (): string =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(
    new Date()
  );

/** Characters Windows does not allow in file names. */
export function pdfFileName(...parts: string[]): string {
  const name = parts
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name || 'Abrechnung'}.pdf`;
}

async function loadPdf(): Promise<{
  doc: JsPdf;
  autoTable: typeof AutoTableFn;
}> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return {
    doc: new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true }),
    autoTable,
  };
}

interface PdfImage {
  data: string;
  width: number;
  height: number;
}

/** An image as data URL, scaled down to `maxPixels` on its long edge. */
async function toImage(blob: Blob, format: 'png' | 'jpeg', maxPixels: number): Promise<PdfImage> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxPixels / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not available');
  if (format === 'jpeg') {
    // Receipts with transparency would otherwise turn black
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    data: canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.85),
    width: canvas.width,
    height: canvas.height,
  };
}

async function loadImage(url: string): Promise<PdfImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return toImage(await response.blob(), 'png', 800);
}

/** Fits an image into a box, keeping its aspect ratio; returns the drawn size. */
function drawImage(
  doc: JsPdf,
  image: PdfImage,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  format: 'PNG' | 'JPEG'
): { width: number; height: number } {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  doc.addImage(image.data, format, x, y, width, height, undefined, 'FAST');
  return { width, height };
}

function drawTitle(doc: JsPdf, title: string, lines: string[]): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text(title, MARGIN, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  let y = 25;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, PAGE_WIDTH - 2 * MARGIN);
    doc.text(wrapped, MARGIN, y);
    y += 5 * wrapped.length;
  }
  return y;
}

function drawTable(
  doc: JsPdf,
  autoTable: typeof AutoTableFn,
  table: PdfTable,
  startY: number
): void {
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
    didParseCell: (data) => {
      if (alignRight.has(data.column.index)) data.cell.styles.halign = 'right';
    },
  });
}

/** Page numbers and the creation date on every page. */
function drawPageFooters(doc: JsPdf): void {
  const created = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date());
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`DPSG Stamm Phoenix · erstellt am ${created}`, MARGIN, PAGE_HEIGHT - 8);
    doc.text(`Seite ${page} von ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, {
      align: 'right',
    });
  }
}

/** A list as a table, e.g. the Teilnehmende or the Einzelnachweise. */
export async function downloadTablePdf(table: PdfTable): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  const y = drawTitle(doc, table.title, [table.subtitle, ...(table.notes ?? [])]);
  drawTable(doc, autoTable, table, y + 2);
  drawPageFooters(doc);
  saveFile(doc.output('blob'), table.fileName);
}

interface LoadedBeleg {
  pages: PdfImage[];
  error?: string;
}

async function loadBelegPage(
  receiptNumber: string,
  page: number,
  fetchImage: (receiptNumber: string, page: number) => Promise<{ blob: Blob; pages: number }>
): Promise<{ image: PdfImage; pages: number }> {
  const { blob, pages } = await fetchImage(receiptNumber, page);
  return { image: await toImage(blob, 'jpeg', RECEIPT_MAX_PIXELS), pages };
}

async function loadBeleg(
  beleg: PdfBeleg,
  fetchImage: (receiptNumber: string, page: number) => Promise<{ blob: Blob; pages: number }>
): Promise<LoadedBeleg> {
  try {
    const first = await loadBelegPage(beleg.receiptNumber, 1, fetchImage);
    const rest = [];
    for (let page = 2; page <= first.pages; page++) {
      rest.push((await loadBelegPage(beleg.receiptNumber, page, fetchImage)).image);
    }
    return { pages: [first.image, ...rest] };
  } catch (error: unknown) {
    return {
      pages: [],
      error: error instanceof Error ? error.message : 'Der Beleg konnte nicht geladen werden.',
    };
  }
}

function drawBelegPage(
  doc: JsPdf,
  beleg: PdfBeleg,
  image: PdfImage | null,
  page: number,
  pages: number,
  error?: string
): void {
  doc.addPage('a4', 'portrait');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...BRAND);
  doc.text(
    `Beleg ${beleg.receiptNumber}${pages > 1 ? ` – Seite ${page} von ${pages}` : ''}`,
    MARGIN,
    18
  );
  let y = 25;
  doc.setFontSize(9);
  for (const [label, value] of beleg.details) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREY);
    doc.text(label, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    const wrapped = doc.splitTextToSize(value || '–', PAGE_WIDTH - 2 * MARGIN - 32);
    doc.text(wrapped, MARGIN + 32, y);
    y += 4.5 * wrapped.length;
  }
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 5;

  if (image) {
    const maxWidth = PAGE_WIDTH - 2 * MARGIN;
    const maxHeight = PAGE_HEIGHT - FOOTER_SPACE - y;
    // Narrow receipts (till rolls) centred on the page
    const width = image.width * Math.min(maxWidth / image.width, maxHeight / image.height);
    drawImage(doc, image, MARGIN + (maxWidth - width) / 2, y, maxWidth, maxHeight, 'JPEG');
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text(
      doc.splitTextToSize(
        `Das Bild des Belegs konnte nicht aus CampFlow geladen werden${
          error ? ` (${error})` : ''
        }. Bitte den Beleg in CampFlow öffnen und ausdrucken.`,
        PAGE_WIDTH - 2 * MARGIN
      ),
      MARGIN,
      y + 4
    );
  }
}

/**
 * The Einzelnachweise and, after them, each receipt on its own page: its booking on top and the
 * image below, to staple the original receipt to its printed copy.
 */
export async function downloadNachweisePdf(
  table: PdfTable,
  options: {
    belege?: PdfBeleg[];
    fetchImage?: (receiptNumber: string, page: number) => Promise<{ blob: Blob; pages: number }>;
    leihgebuehren?: PdfLeihgebuehren;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<{ failed: string[] }> {
  const { doc, autoTable } = await loadPdf();
  const y = drawTitle(doc, table.title, [table.subtitle, ...(table.notes ?? [])]);
  drawTable(doc, autoTable, table, y + 2);

  const belege = options.belege ?? [];
  const failed: string[] = [];
  if (belege.length > 0 && options.fetchImage) {
    const fetchImage = options.fetchImage;
    const loaded: LoadedBeleg[] = new Array(belege.length);
    let next = 0;
    let done = 0;
    options.onProgress?.(0, belege.length);
    const worker = async (): Promise<void> => {
      while (next < belege.length) {
        const index = next++;
        loaded[index] = await loadBeleg(belege[index], fetchImage);
        options.onProgress?.(++done, belege.length);
      }
    };
    await Promise.all(Array.from({ length: RECEIPT_CONCURRENCY }, worker));

    belege.forEach((beleg, index) => {
      const { pages, error } = loaded[index];
      if (pages.length === 0) {
        failed.push(beleg.receiptNumber);
        drawBelegPage(doc, beleg, null, 1, 1, error);
      } else {
        pages.forEach((image, page) => drawBelegPage(doc, beleg, image, page + 1, pages.length));
      }
    });
  }

  if (options.leihgebuehren) {
    doc.addPage('a4', 'portrait');
    await drawLeihgebuehren(doc, autoTable, options.leihgebuehren);
  }
  drawPageFooters(doc);
  saveFile(doc.output('blob'), table.fileName);
  return { failed };
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

/** The letter „Leihgebühren für Zelte und Material“ with letterhead and footer. */
async function drawLeihgebuehren(
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

/** Space for the footer of the letter, which the content must not reach. */
const BRIEF_FUSS_SPACE = 45;
/** Where the content of a follow page starts, below its short header. */
const FOLGESEITE_TOP = 30;

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
function drawBriefseiten(doc: JsPdf, bilder: BriefBilder, betreff: string): void {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (page > 1) drawFolgeseitenKopf(doc, bilder, betreff, page, pages);
    drawBriefFuss(doc, bilder);
  }
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

/** The Materialleihgebühren as a PDF to upload to CampFlow as receipt. */
export async function downloadLeihgebuehrenPdf(
  data: PdfLeihgebuehren,
  fileName: string
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  await drawLeihgebuehren(doc, autoTable, data);
  saveFile(doc.output('blob'), fileName);
}

/** The Kurzbeschreibung for the KJR, with dates and times already formatted. */
export interface PdfKurzbeschreibung {
  aktion: string;
  zeitraum: string;
  einleitung: string;
  /** Days with at least one block, e.g. „Montag, 25.05.2026“. */
  tage: { titel: string; bloecke: { zeit: string; text: string }[] }[];
  vorstaende: Vorstand[];
}

const ZEITPLAN_GAP = 6;
const ZEITPLAN_FONT = 8.5;
const ZEITPLAN_LINE = 3.5;
const ZEITPLAN_ROW_GAP = 0.9;
const ZEITPLAN_HEADER = 7;

interface ZeitplanItem {
  /** Index of the day. */
  tag: number;
  /** The day's heading, or a block with its wrapped text. */
  header: boolean;
  zeit: string;
  lines: string[];
  height: number;
}

interface PlacedItem {
  item: ZeitplanItem;
  /** The day's heading again, above a block that continues a day in a new column. */
  continued: boolean;
  /** Counted from the page the Zeitplan starts on, which is 1. */
  page: number;
  column: number;
  y: number;
}

/**
 * Places the items of the Zeitplan in columns, newspaper style: down the first column, then the
 * next, then on to a new page. A day's heading stays with its first block, and a day that goes on
 * in a new column gets its heading again. `limit` caps the height of the first page's columns,
 * to balance them; `null` when anything does not fit within the given pages.
 */
function placeZeitplan(
  items: ZeitplanItem[],
  columns: number,
  firstTop: number,
  limit: number,
  maxPages = Infinity
): PlacedItem[] | null {
  const bottom = PAGE_HEIGHT - BRIEF_FUSS_SPACE - 2;
  const placed: PlacedItem[] = [];
  let page = 1;
  let column = 0;
  let top = firstTop;
  let end = Math.min(bottom, firstTop + limit);
  let y = top;
  const nextColumn = (): boolean => {
    column++;
    if (column >= columns) {
      if (page >= maxPages) return false;
      page++;
      column = 0;
      top = FOLGESEITE_TOP + 4;
      end = bottom;
    }
    y = top;
    return true;
  };
  for (const [index, item] of items.entries()) {
    const next = items[index + 1];
    // A heading needs room for its first block below it
    const needed = item.header && next && !next.header ? item.height + next.height : item.height;
    const continues = (): boolean => !item.header && y === top;
    const height = (): number => needed + (continues() ? ZEITPLAN_HEADER : 0);
    // On to the next column; on the first page, whose columns start lower, on to the next
    // page if need be
    while (y + height() > end && (y > top || page === 1)) {
      if (!nextColumn()) return null;
    }
    // Taller than a whole page: fails a try within limits, otherwise drawn anyway
    if (y + height() > end && maxPages !== Infinity) return null;
    const continued = continues();
    if (continued) y += ZEITPLAN_HEADER;
    placed.push({ item, continued, page, column, y });
    y += item.height;
  }
  return placed;
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
