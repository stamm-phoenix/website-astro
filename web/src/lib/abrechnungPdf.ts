// PDF exports of the Abrechnung: lists, the receipts for printing, the Deckblatt and the
// Materialleihgebühren. jsPDF is loaded only when a PDF is created, so it does not weigh on
// the page itself. All PDFs are DIN A4 portrait.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn } from 'jspdf-autotable';
import { saveFile } from './api';
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

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
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

/** The letter „Leihgebühren für Zelte und Material“ with letterhead and footer. */
async function drawLeihgebuehren(
  doc: JsPdf,
  autoTable: typeof AutoTableFn,
  data: PdfLeihgebuehren
): Promise<void> {
  const [logo, dpsg] = await Promise.all([
    loadImage('/stammeslilie.png').catch(() => null),
    loadImage('/abrechnung/dpsg-stamm-phoenix.png').catch(() => null),
  ]);

  // Letterhead: logo and Stamm on the left, Stammesvorsitzende on the right
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
  for (const vorstand of data.vorstaende) {
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
  doc.text(today(), right, y);

  // Letter
  let top = Math.max(y + 12, 62);
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
      euro.format(p.priceCent / 100),
      String(p.days),
      euro.format(p.cent / 100),
    ]),
    foot: [['', '', '', 'Summe', euro.format(data.totalCent / 100)]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.6, lineColor: [210, 214, 220] },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 238, 242], textColor: BRAND, fontStyle: 'bold' },
    didParseCell: (cell) => {
      if ([0, 2, 3, 4].includes(cell.column.index)) cell.cell.styles.halign = 'right';
    },
  });

  // Footer of the letter
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
  if (dpsg) drawImage(doc, dpsg, PAGE_WIDTH - MARGIN - 40, footerTop + 3, 40, 22, 'PNG');
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
