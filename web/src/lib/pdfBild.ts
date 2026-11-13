// Images in the PDFs of the Abrechnung and the Stamm's letters: loaded as data URLs, scaled down
// and fitted into a box. Only used together with jsPDF, so the module is loaded on click.
import type { jsPDF as JsPdf } from 'jspdf';

export interface PdfImage {
  data: string;
  width: number;
  height: number;
}

/** An image as data URL, scaled down to `maxPixels` on its long edge. */
export async function toImage(
  blob: Blob,
  format: 'png' | 'jpeg',
  maxPixels: number
): Promise<PdfImage> {
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

export async function loadImage(url: string): Promise<PdfImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return toImage(await response.blob(), 'png', 800);
}

/** Fits an image into a box, keeping its aspect ratio; returns the drawn size. */
export function drawImage(
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
