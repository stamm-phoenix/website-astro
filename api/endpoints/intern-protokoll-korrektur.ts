import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { parseId } from '../lib/db';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { NotEditableError, SperreError, getEditorProtokoll } from '../lib/protokoll-editor';
import { KorrekturFehler, pruefeProtokoll } from '../lib/protokoll-korrektur';
import type { KorrekturPruefung } from '../lib/protokoll-korrektur-model';
import { uebernehmeKorrekturen } from '../lib/protokoll-korrektur-uebernahme';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { ValidationError } from '../lib/validation/errors';
import { validateKorrekturUebernahme } from '../lib/validation/protokoll-korrektur';

/**
 * Correction proposals for minutes of the editor (#553, `docs/protokoll-editor.md`): a check on
 * request and taking single proposals over. Logs name only IDs and counts, never the text.
 */

const NICHT_PRUEFBAR = errorResponse(
  409,
  'NOT_EDITABLE',
  'Freigegebene Protokolle bleiben unverändert und werden nicht mehr geprüft.'
);

/** POST: checks the stored minutes and returns the proposals; changes nothing. */
export async function KorrekturPruefenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  const detail = await getEditorProtokoll(id, null);
  if (!detail) return NOT_FOUND;
  if (detail.status !== 'entwurf' && detail.status !== 'review') return NICHT_PRUEFBAR;
  try {
    const body: KorrekturPruefung & { etag: string } = {
      etag: detail.etag,
      vorschlaege: await pruefeProtokoll(detail.inhalt),
    };
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      return errorResponse(400, 'INVALID', error.fields.form ?? error.message);
    }
    if (error instanceof KorrekturFehler) {
      return errorResponse(error.status, 'CHECK_FAILED', error.message);
    }
    throw error;
  }
}

/**
 * POST `{ etag, vorschlaege }`: takes the proposals over, if the minutes are still the version
 * `etag` (else 409) and nobody writes (else 423). Answers which proposals no longer fit.
 */
export const KorrekturUebernehmenEndpoint = pflegeHandler(
  'protokoll-editor',
  async (request, context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const input = validateKorrekturUebernahme(await readJsonBody(request));
    try {
      const result = await uebernehmeKorrekturen(id, input, principal.userDetails);
      context.log(
        `[pflege] ${principal.userDetails} POST protokoll-editor ${id} (${result.uebernommen.length} Korrekturen übernommen)`
      );
      return ok(result);
    } catch (error: unknown) {
      if (error instanceof SperreError) {
        return {
          status: 423,
          headers: NO_STORE_HEADERS,
          jsonBody: {
            error: 'LOCKED',
            code: 'LOCKED',
            message: `${error.sperre.name} schreibt gerade am Protokoll. Es wurde nichts geändert. Übernimm die Vorschläge, wenn die Bearbeitung beendet ist.`,
            sperre: error.sperre,
          },
        };
      }
      if (error instanceof NotEditableError) return NICHT_PRUEFBAR;
      throw error;
    }
  },
  { quiet: true }
);

export const KorrekturPruefen = withErrorHandling(KorrekturPruefenEndpoint);
export const KorrekturUebernehmen = withErrorHandling(KorrekturUebernehmenEndpoint);
