import type { BelegStatus } from './types';

/** Review states in the order of the workflow; mirrors `BELEG_STATUSES` in the API. */
export const BELEG_STATUSES: BelegStatus[] = ['Eingereicht', 'Rückfrage', 'Geprüft'];

/** Longest edge of the uploaded photo; enough to read small print on a receipt. */
export const BELEG_PHOTO_EDGE = 2000;
/** Shorter photos are rejected by the API as unreadable. */
export const MIN_BELEG_PHOTO_EDGE = 800;
const JPEG_QUALITY = 0.85;
/** Edge of the grayscale copy used for the quality hints. */
const ANALYSIS_EDGE = 400;

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatEuro(cent: number): string {
  return EURO.format(cent / 100);
}

/**
 * Parses an amount such as `12,34`, `12.34`, `1.234,50` or `12 €` into cents.
 * Returns `null` for anything that is not a positive amount with at most two decimals.
 */
export function parseEuroToCent(value: string): number | null {
  const cleaned = value.replace(/\s|€|eur/gi, '');
  if (!cleaned) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+([.,]\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replace(',', '.');
  } else {
    return null;
  }
  const cent = Math.round(Number(normalized) * 100);
  return Number.isFinite(cent) && cent > 0 ? cent : null;
}

/** Amount in cents as it is typed into the form, e.g. `12,30`. */
export function centToInput(cent: number): string {
  return cent > 0 ? (cent / 100).toFixed(2).replace('.', ',') : '';
}

/** Today in local time as `YYYY-MM-DD`, the format of date inputs. */
export function todayIso(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

export interface PhotoQuality {
  /** Mean brightness from 0 (black) to 255 (white). */
  brightness: number;
  /** Variance of the Laplacian; low values mean few sharp edges, i.e. a blurry photo. */
  sharpness: number;
}

/** Below these values the photo is probably too dark or too blurry to read. */
export const MIN_BRIGHTNESS = 70;
export const MIN_SHARPNESS = 60;

/** Brightness and sharpness of a grayscale image with values from 0 to 255. */
export function measureQuality(
  gray: ArrayLike<number>,
  width: number,
  height: number
): PhotoQuality {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = gray.length ? sum / gray.length : 0;

  let count = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      // Welford's online variance
      count++;
      const delta = laplacian - mean;
      mean += delta / count;
      m2 += delta * (laplacian - mean);
    }
  }
  return { brightness, sharpness: count ? m2 / count : 0 };
}

/** Hints about a photo that is likely hard to read; empty if it looks fine. */
export function qualityWarnings(
  quality: PhotoQuality,
  size: { width: number; height: number }
): string[] {
  const warnings: string[] = [];
  if (Math.max(size.width, size.height) < MIN_BELEG_PHOTO_EDGE) {
    warnings.push(
      'Das Foto ist sehr klein. Bitte näher heran oder mit höherer Auflösung fotografieren.'
    );
  }
  if (quality.brightness < MIN_BRIGHTNESS) {
    warnings.push('Das Foto wirkt sehr dunkel. Bitte bei mehr Licht fotografieren.');
  }
  if (quality.sharpness < MIN_SHARPNESS) {
    warnings.push('Das Foto wirkt unscharf. Bitte ruhig halten und auf den Beleg scharf stellen.');
  }
  return warnings;
}

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  warnings: string[];
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      JPEG_QUALITY
    )
  );
}

/**
 * Loads a photo scaled to a canvas of at most BELEG_PHOTO_EDGE px. The orientation from the
 * EXIF data is applied by `createImageBitmap`.
 */
export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, BELEG_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas not available');
    // White background, in case of a transparent PNG
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** Hints whether the photo on the canvas is hard to read (dark, blurry, too small). */
export function photoWarnings(canvas: HTMLCanvasElement): string[] {
  const { width, height } = canvas;
  const analysisScale = Math.min(1, ANALYSIS_EDGE / Math.max(width, height));
  const aw = Math.max(3, Math.round(width * analysisScale));
  const ah = Math.max(3, Math.round(height * analysisScale));
  const small = document.createElement('canvas');
  small.width = aw;
  small.height = ah;
  const smallContext = small.getContext('2d', { willReadFrequently: true });
  if (!smallContext) throw new Error('Canvas not available');
  smallContext.drawImage(canvas, 0, 0, aw, ah);
  const rgba = smallContext.getImageData(0, 0, aw, ah).data;
  const gray = new Float32Array(aw * ah);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return qualityWarnings(measureQuality(gray, aw, ah), { width, height });
}

/** JPEG of a canvas, as uploaded to the API. */
export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return toJpeg(canvas);
}

/** Scales a photo of a receipt to a JPEG and checks whether it is readable. */
export async function prepareBelegPhoto(file: Blob): Promise<PreparedPhoto> {
  const canvas = await loadPhoto(file);
  return {
    blob: await toJpeg(canvas),
    width: canvas.width,
    height: canvas.height,
    warnings: photoWarnings(canvas),
  };
}

/** Base64 content of a blob, without the `data:` prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
