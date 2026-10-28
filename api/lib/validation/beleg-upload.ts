/** Reading and checking the photos and the PDF of a receipt from a JSON request body. */
import type { HttpResponseInit } from '@azure/functions';
import { z } from 'zod';
import type { BelegPhotos } from '../beleg-list';
import { getJpegSize, isJpeg } from '../jpeg';
import { errorResponse } from '../response-utils';
import { MAX_BELEG_PDF_BYTES, MAX_BELEG_PHOTO_BYTES, MIN_BELEG_PHOTO_EDGE } from './beleg';

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
 * Reads and checks `photo` and the optional `original` of a JSON body, or a `pdf` with its first
 * page drawn by the browser as `photo`.
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
    return checkPdf(pdf) ?? { photo, pdf };
  }
  if (body?.original === undefined || body.original === null) return { photo };
  const original = decodePhoto(body.original);
  return checkPhoto(original) ?? { photo, original };
}

export function isPhotos(value: BelegPhotos | HttpResponseInit): value is BelegPhotos {
  return 'photo' in value;
}
