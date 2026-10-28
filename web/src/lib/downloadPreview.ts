/**
 * Preview images of the downloads: the browser draws the first page of a PDF or the image
 * itself when the file is uploaded, and sends it along as a JPEG; the API scales it to the stored
 * previews. Other files (Word, Excel, ZIP …) get no preview; the list shows their extension.
 */

/** Width of the preview sent to the API; it stores at most 400 px. */
const PREVIEW_WIDTH = 600;
/** Larger files are read completely into memory for the preview, which phones cannot afford. */
const MAX_PREVIEW_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Draws the first `maxPages` pages of a PDF, each `width` pixels wide on a white background.
 * Also used to send the pages of a Zeitplan as images (`zeitplanDatei.ts`).
 */
export async function drawPdfPages(
  data: Uint8Array,
  width: number,
  maxPages: number
): Promise<HTMLCanvasElement[]> {
  // The legacy build runs in older browsers too (the current one needs very new JavaScript)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data });
  try {
    const document = await task.promise;
    const canvases: HTMLCanvasElement[] = [];
    for (let number = 1; number <= Math.min(maxPages, document.numPages); number++) {
      const page = await document.getPage(number);
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / unscaled.width });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      // PDFs without a background would turn black as a JPEG
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await task.destroy();
  }
}

async function drawPdf(file: File): Promise<HTMLCanvasElement> {
  const [canvas] = await drawPdfPages(new Uint8Array(await file.arrayBuffer()), PREVIEW_WIDTH, 1);
  if (!canvas) throw new Error('No page');
  return canvas;
}

async function drawImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PREVIEW_WIDTH / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function toBase64Jpeg(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // The API takes at most 2 MB; without a preview the file is still uploaded
        if (!blob || blob.size > MAX_PREVIEW_BYTES) {
          reject(new Error('No JPEG'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      0.85
    );
  });
}

/**
 * A preview of the file as a base64 JPEG, or undefined if there is none. Never fails: without a
 * preview the file is still uploaded.
 */
export async function makeDownloadPreview(file: File): Promise<string | undefined> {
  if (file.size > MAX_PREVIEW_SOURCE_BYTES) return undefined;
  try {
    if (isPdf(file)) return await toBase64Jpeg(await drawPdf(file));
    if (IMAGE_TYPES.has(file.type)) return await toBase64Jpeg(await drawImage(file));
  } catch {
    // Damaged, encrypted or unsupported: upload without a preview
  }
  return undefined;
}
