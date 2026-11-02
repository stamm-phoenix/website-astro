import { BELEG_PHOTO_EDGE, blobToBase64 } from './belege';
import type { PDFDocumentProxy as PdfDocument } from 'pdfjs-dist';
import { canvasToJpeg } from './image';

/**
 * Receipts as PDF, e.g. an invoice by mail: the PDF goes to CampFlow as it is; its pages are
 * drawn as pictures to be shown and read by the check. A PDF can have several pages.
 */

/** Larger PDFs are refused by the API; mirrors `MAX_BELEG_PDF_BYTES`. */
export const MAX_BELEG_PDF_BYTES = 5 * 1024 * 1024;
/** Pages the check reads at most; mirrors `MAX_BELEG_CHECK_PAGES` in the API. */
export const MAX_BELEG_CHECK_PAGES = 5;
/** Pages shown at most; a receipt is rarely longer, and the PDF itself has them all. */
export const MAX_BELEG_SHOWN_PAGES = 20;

/** A page drawn as a JPEG. */
export interface PdfSeite {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Which of `count` drawn pages (from 0) the check reads: all up to `MAX_BELEG_CHECK_PAGES`,
 * otherwise the first ones and the last, where the total of a long invoice usually is.
 */
export function pruefSeiten(count: number): number[] {
  if (count <= MAX_BELEG_CHECK_PAGES) return Array.from({ length: count }, (_, i) => i);
  return [...Array.from({ length: MAX_BELEG_CHECK_PAGES - 1 }, (_, i) => i), count - 1];
}

/** How many pages of a PDF with `count` pages are drawn and shown. */
export function gezeigteSeiten(count: number): number {
  return Math.min(count, MAX_BELEG_SHOWN_PAGES);
}

/** Opens a PDF with pdf.js, loaded only when needed, and gives it to `use`. */
async function withPdf<T>(file: Blob, use: (pdf: PdfDocument) => Promise<T>): Promise<T> {
  // The legacy build runs in older browsers too (the current one needs very new JavaScript)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return await use(await task.promise);
  } finally {
    await task.destroy();
  }
}

/** A page (from 1) as a picture whose longer edge is `BELEG_PHOTO_EDGE`. */
async function drawPage(pdf: PdfDocument, number: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(number);
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: BELEG_PHOTO_EDGE / Math.max(unscaled.width, unscaled.height),
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not available');
  // PDFs without a background would turn black as a JPEG
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

async function toSeite(canvas: HTMLCanvasElement): Promise<PdfSeite> {
  const blob = await canvasToJpeg(canvas);
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

/** The pages from the second on as pictures, at most `MAX_BELEG_SHOWN_PAGES` in all. */
async function drawWeitere(pdf: PdfDocument): Promise<PdfSeite[]> {
  const weitere: PdfSeite[] = [];
  try {
    for (let number = 2; number <= gezeigteSeiten(pdf.numPages); number++) {
      weitere.push(await toSeite(await drawPage(pdf, number)));
    }
    return weitere;
  } catch (error: unknown) {
    freeSeiten(weitere);
    throw error;
  }
}

/**
 * A chosen PDF: its first page as a picture, which is checked like a photo, stored and listed,
 * the further pages to be shown, its last page if it is not among them (the check reads it, as
 * the total is usually there) and the number of its pages.
 */
export function loadPdfBeleg(file: Blob): Promise<{
  erste: HTMLCanvasElement;
  weitere: PdfSeite[];
  letzte: PdfSeite | null;
  seiten: number;
}> {
  return withPdf(file, async (pdf) => {
    const erste = await drawPage(pdf, 1);
    const weitere = await drawWeitere(pdf);
    try {
      const letzte =
        pdf.numPages > gezeigteSeiten(pdf.numPages)
          ? await toSeite(await drawPage(pdf, pdf.numPages))
          : null;
      return { erste, weitere, letzte, seiten: pdf.numPages };
    } catch (error: unknown) {
      freeSeiten(weitere);
      throw error;
    }
  });
}

/** The further pages of a stored PDF, shown below the stored picture of its first page. */
export function loadWeitereSeiten(file: Blob): Promise<{ weitere: PdfSeite[]; seiten: number }> {
  return withPdf(file, async (pdf) => ({ weitere: await drawWeitere(pdf), seiten: pdf.numPages }));
}

/** Releases the pictures of drawn pages. */
export function freeSeiten(seiten: readonly PdfSeite[]): void {
  for (const seite of seiten) URL.revokeObjectURL(seite.url);
}

/**
 * The further pages the check reads, for a PDF whose first page is checked like a photo and
 * whose next pages are `weitere`, followed by its last page `letzte` when that is not among
 * them: the pages chosen by `pruefSeiten` without the first.
 */
export function weiterePruefSeiten<T>(weitere: readonly T[], letzte: T | null = null): T[] {
  const alle = letzte === null ? weitere : [...weitere, letzte];
  return pruefSeiten(alle.length + 1)
    .filter((index) => index > 0)
    .map((index) => alle[index - 1]);
}

/**
 * What the check of a PDF reads: the picture of its first page alone as it is, or with further
 * pages all of them as `{ pages }` in base64.
 */
export async function pdfPruefung(
  erste: Blob,
  weitere: readonly PdfSeite[],
  letzte: PdfSeite | null
): Promise<Blob | { pages: string[] }> {
  const gelesen = weiterePruefSeiten(weitere, letzte);
  if (gelesen.length === 0) return erste;
  return {
    pages: await Promise.all([erste, ...gelesen.map((seite) => seite.blob)].map(blobToBase64)),
  };
}

/** The photos of a PDF for the API: the PDF, its first page `photo` and the pages to check. */
export async function pdfFotos(
  photo: string,
  pdf: Blob,
  weitere: readonly PdfSeite[],
  letzte: PdfSeite | null
): Promise<{ photo: string; pdf: string; pages?: string[] }> {
  const pages = await Promise.all(
    weiterePruefSeiten(weitere, letzte).map((seite) => blobToBase64(seite.blob))
  );
  return { photo, pdf: await blobToBase64(pdf), ...(pages.length > 0 ? { pages } : {}) };
}
