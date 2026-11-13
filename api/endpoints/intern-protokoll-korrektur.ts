import { app } from '@azure/functions';
import { parseId } from '../lib/db';
import { NOT_FOUND, ok } from '../lib/pflege-api';
import { NotEditableError, SperreError, getEditorProtokoll } from '../lib/protokoll-editor';
import { KorrekturFehler, pruefeProtokoll } from '../lib/protokoll-korrektur';
import type { KorrekturPruefung } from '../lib/protokoll-korrektur-model';
import { uebernehmeKorrekturen } from '../lib/protokoll-korrektur-uebernahme';
import { errorResponse, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { ValidationError } from '../lib/validation/errors';
import { validateKorrekturUebernahme } from '../lib/validation/protokoll-korrektur';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

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
const korrekturPruefen: StaffRequestHandler = async (request) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  const detail = await getEditorProtokoll(id, null);
  if (!detail) return NOT_FOUND;
  if (detail.status !== 'entwurf' && detail.status !== 'review') return NICHT_PRUEFBAR;
  try {
    const body: KorrekturPruefung & { etag: string } = {
      etag: detail.etag,
      ...(await pruefeProtokoll(detail.inhalt)),
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
};

export const KorrekturPruefen = staffHandler('protokoll-editor-korrektur', korrekturPruefen, {
  readOnly: true,
});

/**
 * POST `{ etag, vorschlaege }`: takes the proposals over, if the minutes are still the version
 * `etag` (else 409) and nobody writes (else 423). Answers which proposals no longer fit.
 */
export const KorrekturUebernehmen = staffHandler(
  'protokoll-editor',
  async (request, context, principal) => {
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

app.http('internProtokollEditorKorrekturPruefen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/ki/korrekturen',
  handler: KorrekturPruefen,
});

app.http('internPflegeProtokollEditorKorrekturen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/korrekturen',
  handler: KorrekturUebernehmen,
});
