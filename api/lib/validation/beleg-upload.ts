/** Reading and checking the photos and the PDF of a receipt from a JSON request body. */
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { z } from 'zod';
import type { BelegPhotos } from '../beleg-list';
import { getJpegSize, isJpeg } from '../jpeg';
import { errorResponse } from '../response-utils';
import {
  MAX_BELEG_CHECK_PAGES,
  MAX_BELEG_PDF_BYTES,
  MAX_BELEG_PHOTO_BYTES,
  MIN_BELEG_PHOTO_EDGE,
} from './beleg';

/** Checks an uploaded photo; returns an error response if it cannot be used. */
export function checkPhoto(bytes: Uint8Array): HttpResponseInit | undefined {
  if (bytes.length === 0) {
    return errorResponse(400, 'INVALID', 'Bitte ein Foto des Belegs hinzufügen.');
  }
  if (bytes.length > MAX_BELEG_PHOTO_BYTES) {
    return errorResponse(413, 'TOO_LARGE', 'Das Foto ist zu groß (höchstens 4 MB).');
  }
  if (!isJpeg(bytes)) {
    return errorResponse(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  }
  const size = getJpegSize(bytes);
  if (!size || Math.max(size.width, size.height) < MIN_BELEG_PHOTO_EDGE) {
    return errorResponse(
      400,
      'INVALID',
      'Das Foto ist zu klein, um den Beleg zu lesen. Bitte näher heran oder mit höherer Auflösung fotografieren.'
    );
  }
  return undefined;
}

/** Whether the bytes start like a PDF. */
function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

/** Checks an uploaded PDF; returns an error response if it cannot be used. */
function checkPdf(bytes: Uint8Array): HttpResponseInit | undefined {
  if (bytes.length > MAX_BELEG_PDF_BYTES) {
    return errorResponse(413, 'TOO_LARGE', 'Das PDF ist zu groß (höchstens 5 MB).');
  }
  if (!isPdf(bytes)) {
    return errorResponse(
      400,
      'INVALID',
      'Die Datei ist kein PDF. Bitte ein PDF oder ein Foto wählen.'
    );
  }
  return undefined;
}

const base64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .transform((value) => new Uint8Array(Buffer.from(value, 'base64')));

/** Decodes the base64 photo of a new receipt; invalid input yields an empty array. */
function decodePhoto(value: unknown): Uint8Array {
  const decoded = base64Schema.safeParse(value);
  return decoded.success ? decoded.data : new Uint8Array();
}

/**
 * Reads and checks a list of page pictures (base64 JPEGs) of at most `max` entries; returns an
 * error response if one of them cannot be used.
 */
function readPages(value: unknown, max: number): Uint8Array[] | HttpResponseInit {
  if (!Array.isArray(value) || value.length > max) {
    return errorResponse(
      400,
      'INVALID',
      `Es werden höchstens ${MAX_BELEG_CHECK_PAGES} Seiten eines PDFs geprüft.`
    );
  }
  const pages: Uint8Array[] = [];
  for (const entry of value) {
    const page = decodePhoto(entry);
    const invalid = checkPhoto(page);
    if (invalid) return invalid;
    pages.push(page);
  }
  return pages;
}

/**
 * Reads the pictures for the check of a receipt not yet submitted: `{ pages }` with the pages of
 * a PDF, the first one first. Returns an error response if they cannot be used.
 */
export function readCheckPages(
  body: Record<string, unknown> | null
): Uint8Array[] | HttpResponseInit {
  const pages = readPages(body?.pages, MAX_BELEG_CHECK_PAGES);
  if (Array.isArray(pages) && pages.length === 0) {
    return errorResponse(400, 'INVALID', 'Bitte ein Foto des Belegs hinzufügen.');
  }
  return pages;
}

/**
 * Reads and checks `photo` and the optional `original` of a JSON body, or a `pdf` with its first
 * page drawn by the browser as `photo` and the further pages the check reads as `pages`.
 */
export function readPhotos(body: Record<string, unknown> | null): BelegPhotos | HttpResponseInit {
  const photo = decodePhoto(body?.photo);
  const invalidPhoto = checkPhoto(photo);
  if (invalidPhoto) return invalidPhoto;
  if (body?.pdf !== undefined && body.pdf !== null) {
    const pdf = decodePhoto(body.pdf);
    if (body.original !== undefined && body.original !== null) {
      return errorResponse(400, 'INVALID', 'Ein PDF hat kein Originalfoto.');
    }
    const invalidPdf = checkPdf(pdf);
    if (invalidPdf) return invalidPdf;
    if (body.pages === undefined || body.pages === null) return { photo, pdf };
    const pages = readPages(body.pages, MAX_BELEG_CHECK_PAGES - 1);
    if (!Array.isArray(pages)) return pages;
    return pages.length > 0 ? { photo, pdf, pages } : { photo, pdf };
  }
  if (body?.pages !== undefined && body.pages !== null) {
    return errorResponse(400, 'INVALID', 'Nur ein PDF hat weitere Seiten.');
  }
  if (body?.original === undefined || body.original === null) return { photo };
  const original = decodePhoto(body.original);
  return checkPhoto(original) ?? { photo, original };
}

/**
 * The pictures the check of a new receipt reads from a request: a JPEG as the body, or the pages
 * of a PDF as JSON `{ pages }`. The question how to turn a photo takes only a JPEG. Returns an
 * error answer if they cannot be used.
 */
export async function readCheckRequest(
  request: HttpRequest,
  onlyRotation: boolean
): Promise<Uint8Array[] | HttpResponseInit> {
  if ((request.headers.get('content-type') ?? '').startsWith('application/json')) {
    if (onlyRotation) return errorResponse(400, 'INVALID', 'Ein PDF wird nicht gedreht.');
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      // An unreadable body has no pages
    }
    return readCheckPages(
      body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  return checkPhoto(bytes) ?? [bytes];
}

export function isPhotos(value: BelegPhotos | HttpResponseInit): value is BelegPhotos {
  return 'photo' in value;
}
