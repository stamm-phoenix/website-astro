// Reads the Zeitplan of the Kurzbeschreibung from a file or a description: photos and PDF pages
// go to the API as JPEGs (scans and handwriting included), Excel and CSV files and descriptions
// as they are. The API asks the
// model of the receipt check and answers with days and blocks, nothing is stored.
import { sendApi } from './api';
import { drawPdfPages } from './downloadPreview';
import type { NeuerBlock } from './kurzbeschreibung';

/** Pages of a PDF the API reads at most; a Zeitplan rarely has more. */
export const MAX_ZEITPLAN_SEITEN = 4;
/** Long edge of the images, enough to read small print in a table. */
const MAX_PIXELS = 2000;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_TABLE_BYTES = 2 * 1024 * 1024;

export const ZEITPLAN_DATEITYPEN =
  '.pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,.xlsx,.csv';

export interface GelesenerZeitplan {
  einleitung: string | null;
  tage: { datum: string; bloecke: NeuerBlock[] }[];
  /** Blocks found but left out, beyond 30 a day or 31 days. */
  ausgelassen?: number;
}

interface ZeitplanAntwort {
  available: boolean;
  zeitplan: GelesenerZeitplan | null;
}

/** A file the page cannot send; the message says what to do instead. */
export class ZeitplanDateiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZeitplanDateiError';
  }
}

function toJpeg(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
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

async function drawPhoto(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
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

function base64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** The body for the API; throws `ZeitplanDateiError` for files it cannot read. */
async function requestBody(file: File): Promise<object> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_SOURCE_BYTES)
    throw new ZeitplanDateiError('Die Datei ist zu groß (höchstens 30 MB).');
  if (name.endsWith('.xlsx') || name.endsWith('.csv')) {
    if (file.size > MAX_TABLE_BYTES)
      throw new ZeitplanDateiError(
        'Die Tabelle ist zu groß (höchstens 2 MB). Speichere nur das Blatt mit dem Zeitplan.'
      );
    return { tabelle: { name: file.name, data: base64(await file.arrayBuffer()) } };
  }
  if (name.endsWith('.xls') || name.endsWith('.ods') || name.endsWith('.numbers'))
    throw new ZeitplanDateiError(
      'Bitte die Tabelle als Excel-Datei (.xlsx) speichern und erneut wählen.'
    );
  try {
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
      const pages = await drawPdfPages(
        new Uint8Array(await file.arrayBuffer()),
        // A4 portrait: 2000 px on the long edge
        Math.round(MAX_PIXELS / Math.SQRT2),
        MAX_ZEITPLAN_SEITEN
      );
      return { bilder: await Promise.all(pages.map(toJpeg)) };
    }
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name)) {
      return { bilder: [await toJpeg(await drawPhoto(file))] };
    }
  } catch {
    throw new ZeitplanDateiError(
      'Die Datei konnte nicht geöffnet werden. Ist sie beschädigt oder mit einem Passwort geschützt? Wähle eine andere Datei oder trage den Zeitplan selbst ein.'
    );
  }
  throw new ZeitplanDateiError('Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.');
}

/** Reads the Zeitplan of `file` for the Aktion; null when reading files is not set up. */
export async function leseZeitplan(
  eventId: string,
  file: File,
  signal?: AbortSignal
): Promise<GelesenerZeitplan | null> {
  const body = await requestBody(file);
  const antwort = await sendApi<ZeitplanAntwort>(
    'POST',
    `/intern/abrechnung/${encodeURIComponent(eventId)}/zeitplan`,
    body,
    { signal }
  );
  return antwort.available ? antwort.zeitplan : null;
}

/**
 * Brings a description of the Zeitplan written on the page into days and blocks, once and
 * without questions back; null when reading is not set up.
 */
export async function beschreibeZeitplan(
  eventId: string,
  freitext: string,
  signal?: AbortSignal
): Promise<GelesenerZeitplan | null> {
  const antwort = await sendApi<ZeitplanAntwort>(
    'POST',
    `/intern/abrechnung/${encodeURIComponent(eventId)}/zeitplan`,
    { freitext },
    { signal }
  );
  return antwort.available ? antwort.zeitplan : null;
}
