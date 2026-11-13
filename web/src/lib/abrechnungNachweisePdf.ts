// PDF of the Nachweise of an Abrechnung: the list and, after it, each receipt on its own page.
// Loaded on click with the other PDF modules.
import { saveFile } from './api';
import { drawLeihgebuehren } from './abrechnungLeihgebuehrenPdf';
import type { PdfLeihgebuehren } from './abrechnungLeihgebuehrenPdf';
import {
  BRAND,
  FOOTER_SPACE,
  GREY,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  RED,
  drawPageFooters,
  drawTitle,
  loadPdf,
} from './pdfBasis';
import { drawImage, toImage } from './pdfBild';
import type { PdfImage } from './pdfBild';
import { drawTable } from './pdfTabelle';
import type { PdfTable } from './pdfTabelle';
import type { jsPDF as JsPdf } from 'jspdf';

/** A receipt to print on its own page below its booking. */
export interface PdfBeleg {
  receiptNumber: string;
  /** Label–value pairs shown above the image, e.g. Datum, Beschreibung, Betrag. */
  details: [string, string][];
}

/** Long edge of receipt images in the PDF; enough for print, keeps the file small. */
const RECEIPT_MAX_PIXELS = 2000;
/** The Playwright API exports at most three pages at the same time. */
const RECEIPT_CONCURRENCY = 3;

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
