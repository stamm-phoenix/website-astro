import type { HttpRequest } from '@azure/functions';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler } from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import {
  BelegCheckLimitError,
  checkBelegPhoto,
  checkBelegRotation,
  isBelegCheckConfigured,
} from '../lib/beleg-check';
import { readCheckRequest } from '../lib/validation/beleg-upload';

/**
 * POST: checks the JPEG in the body before it is submitted, to show problems right away and
 * prefill the form; for a PDF the JSON `{ pages }` with its pages as base64 JPEGs. With
 * `?nur=drehung` it answers only how to turn the photo upright (`rotation`), which the form does
 * before the check. `available` is false without a model.
 */
export const BelegPruefungEndpoint = pflegeHandler(
  'belege-pruefung',
  async (request: HttpRequest) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const onlyRotation = request.query.get('nur') === 'drehung';
    if (!isBelegCheckConfigured()) {
      return ok(
        onlyRotation ? { available: false, rotation: 0 } : { available: false, check: null }
      );
    }

    // A photo comes as it is, the pages of a PDF as `{ pages }` in JSON
    const pages = await readCheckRequest(request, onlyRotation);
    if (!Array.isArray(pages)) return pages;
    try {
      if (onlyRotation) {
        return ok({ available: true, rotation: (await checkBelegRotation(pages[0])) ?? 0 });
      }
      return ok({ available: true, check: await checkBelegPhoto(pages) });
    } catch (error: unknown) {
      if (error instanceof BelegCheckLimitError) {
        return errorResponse(
          429,
          'CHECK_LIMIT',
          'Die KI-Prüfung hat ihr Tageslimit erreicht. Du kannst den Beleg trotzdem einreichen.'
        );
      }
      return errorResponse(
        502,
        'CHECK_UNAVAILABLE',
        'Die KI-Prüfung ist gerade nicht erreichbar. Du kannst den Beleg trotzdem einreichen.'
      );
    }
  }
);

export const BelegPruefung = withErrorHandling(BelegPruefungEndpoint);
