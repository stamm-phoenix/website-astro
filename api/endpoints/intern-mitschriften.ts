import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { AzureOpenAiError } from '../lib/azure-openai';
import { CONFIG } from '../lib/config';
import { parseId } from '../lib/db';
import { EnvironmentVariable, findEnvironment } from '../lib/environment';
import {
  appendLiveAbschnitte,
  checkAuftraege,
  cleanupStaleAuftraege,
  createAuftrag,
  createMitschrift,
  deleteAbschnitte,
  deleteMitschrift,
  deleteOldMitschriften,
  finishMitschrift,
  getMitschrift,
  getMitschriftenOverview,
  mergeSprecher,
  removeAuftrag,
  renameSprecher,
  requireMitschrift,
  saveNotizen,
  startAuftrag,
  updateAbschnitt,
  updateMitschrift,
} from '../lib/mitschriften';
import type { SpeechTokenResponse } from '../lib/mitschriften-model';
import { emptyNotizen } from '../lib/mitschriften-model';
import { generateNotizen, isNotizenConfigured, transcriptText } from '../lib/mitschriften-notizen';
import { SPEECH_TOKEN_MINUTES, SpeechError, issueSpeechToken } from '../lib/mitschriften-speech';
import type { PflegeHandler } from '../lib/pflege-api';
import {
  NOT_FOUND,
  NO_CONTENT,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import {
  ValidationError,
  validateAbschnitt,
  validateAbschnittIds,
  validateAuftrag,
  validateLiveAbschnitte,
  validateMitschrift,
  validateNotizen,
  validateNotizenRequest,
  validateSprecherMerge,
  validateSprecherName,
} from '../lib/pflege-validation';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/**
 * Mitschriften (#266, `docs/mitschriften.md`): every logged-in leader may see, create, edit and
 * delete all of them. Logs name only IDs and actions, never transcript or notes.
 */

const AREA = 'mitschriften';

const SPEECH_UNAVAILABLE = errorResponse(
  502,
  'SPEECH_UNAVAILABLE',
  'Azure Speech ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.'
);

const SPEECH_NOT_CONFIGURED = errorResponse(
  503,
  'SPEECH_NOT_CONFIGURED',
  'Die Spracherkennung ist nicht eingerichtet.'
);

const NOTES_UNAVAILABLE = errorResponse(
  502,
  'NOTES_UNAVAILABLE',
  'Die Notizen konnten gerade nicht erzeugt werden. Bitte später erneut versuchen.'
);

const NOTES_EDITED = errorResponse(
  409,
  'NOTES_EDITED',
  'Die Notizen wurden von Hand geändert. Beim Neu-Erzeugen gehen diese Änderungen verloren.'
);

const STALE_VERSION = errorResponse(
  409,
  'CONFLICT',
  'Die Mitschrift wurde inzwischen geändert. Bitte neu laden.'
);

/** Answers errors of Azure Speech and Azure OpenAI with a message instead of a 500. */
async function withAzureErrors(work: () => Promise<HttpResponseInit>): Promise<HttpResponseInit> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof SpeechError) return SPEECH_UNAVAILABLE;
    if (error instanceof AzureOpenAiError) return NOTES_UNAVAILABLE;
    throw error;
  }
}

/** A write endpoint of one Mitschrift: 404 for an invalid ID. */
function mitschriftHandler(
  work: (id: number, ...rest: Parameters<PflegeHandler>) => Promise<HttpResponseInit>
) {
  return pflegeHandler(AREA, async (request, context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    return withAzureErrors(() => work(id, request, context, principal));
  });
}

function childId(request: HttpRequest, name: string): number | undefined {
  return parseId(request.params[name] ?? '');
}

/** GET: all Mitschriften, newest first. Removes jobs that never finished first. */
export async function GetMitschriftenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  await cleanupStaleAuftraege();
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await getMitschriftenOverview() };
}

/** GET: a Mitschrift with transcript, speakers, notes and open jobs. */
export async function GetMitschriftEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  await cleanupStaleAuftraege();
  const detail = await getMitschrift(id);
  return detail ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: detail } : NOT_FOUND;
}

/**
 * GET: a token for the live transcription in the browser, valid for ten minutes. The browser
 * renews it while recording; the key never leaves the API.
 */
export async function GetSpeechTokenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (!findEnvironment(EnvironmentVariable.AZURE_SPEECH_KEY)) return SPEECH_NOT_CONFIGURED;
  return withAzureErrors(async () => {
    const body: SpeechTokenResponse = {
      token: await issueSpeechToken(),
      region: CONFIG.mitschriften.speech.region,
      locale: CONFIG.mitschriften.locale,
      phrases: CONFIG.mitschriften.phrases,
      expiresInSeconds: SPEECH_TOKEN_MINUTES * 60,
    };
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
  });
}

/** POST: a new Mitschrift, recorded live or from an uploaded file; needs the consent. */
export const MitschriftenCollectionEndpoint = pflegeHandler(
  AREA,
  async (request, _c, principal) => {
    const input = validateMitschrift(await readJsonBody(request), true);
    const id = await createMitschrift(
      { title: input.title, date: input.date, status: input.mode },
      principal.userDetails
    );
    return ok(await requireMitschrift(id), 201);
  }
);

/** PATCH: title and date. DELETE: the whole Mitschrift, for good. */
export const MitschriftItemEndpoint = mitschriftHandler(async (id, request, _c, principal) => {
  if (request.method === 'DELETE') {
    return (await deleteMitschrift(id)) ? NO_CONTENT : NOT_FOUND;
  }
  const input = validateMitschrift(await readJsonBody(request), false);
  return ok({ etag: await updateMitschrift(id, input, input.etag, principal.userDetails) });
});

/** POST: ends the live recording. */
export const MitschriftFinishEndpoint = mitschriftHandler(async (id, _r, _c, principal) => {
  await finishMitschrift(id, principal.userDetails);
  return ok(await requireMitschrift(id));
});

/** POST: finished sentences of the live recording; sending them again changes nothing. */
export const MitschriftLiveEndpoint = mitschriftHandler(async (id, request, _c, principal) => {
  const abschnitte = validateLiveAbschnitte(await readJsonBody(request));
  return ok(await appendLiveAbschnitte(id, abschnitte, principal.userDetails));
});

/** PATCH: text and speaker of one sentence. */
export const MitschriftAbschnittEndpoint = mitschriftHandler(async (id, request, _c, principal) => {
  const abschnittId = childId(request, 'abschnittId');
  if (abschnittId === undefined) return NOT_FOUND;
  const input = validateAbschnitt(await readJsonBody(request));
  return ok({
    etag: await updateAbschnitt(id, abschnittId, input, input.etag, principal.userDetails),
  });
});

/**
 * POST: deletes sentences for good. The notes go with them in the same step, so nothing of
 * the deleted sentences survives there; the page generates them again right after.
 */
export const MitschriftAbschnitteDeleteEndpoint = mitschriftHandler(
  async (id, request, _c, principal) => {
    const ids = validateAbschnittIds(await readJsonBody(request));
    return ok({ deleted: await deleteAbschnitte(id, ids, principal.userDetails) });
  }
);

/** PATCH: the name of a speaker (empty: the default label). */
export const MitschriftSprecherEndpoint = mitschriftHandler(async (id, request, _c, principal) => {
  const sprecherId = childId(request, 'sprecherId');
  if (sprecherId === undefined) return NOT_FOUND;
  const input = validateSprecherName(await readJsonBody(request));
  return ok({
    etag: await renameSprecher(id, sprecherId, input.name, input.etag, principal.userDetails),
  });
});

/** POST: merges a speaker into another one (`into`). */
export const MitschriftSprecherMergeEndpoint = mitschriftHandler(
  async (id, request, _c, principal) => {
    const sprecherId = childId(request, 'sprecherId');
    if (sprecherId === undefined) return NOT_FOUND;
    const into = validateSprecherMerge(await readJsonBody(request));
    await mergeSprecher(id, sprecherId, into, principal.userDetails);
    return NO_CONTENT;
  }
);

/**
 * PUT: notes changed by hand. POST: lets the model write the notes from the transcript;
 * running notes during the meeting are only returned, not stored. Notes changed by hand are
 * only replaced with `overwrite`.
 */
export const MitschriftNotizenEndpoint = mitschriftHandler(async (id, request, _c, principal) => {
  if (request.method === 'PUT') {
    const input = validateNotizen(await readJsonBody(request));
    const detail = await requireMitschrift(id);
    if (detail.status === 'live') {
      throw new ValidationError({
        notes: 'Die Notizen lassen sich erst nach dem Ende der Aufnahme bearbeiten.',
      });
    }
    return ok({
      etag: await saveNotizen(id, input.notes, input.etag, true, principal.userDetails),
    });
  }

  const input = validateNotizenRequest(await readJsonBody(request));
  if (!isNotizenConfigured()) {
    return errorResponse(503, 'NOTES_NOT_CONFIGURED', 'Die KI-Notizen sind nicht eingerichtet.');
  }
  const detail = await requireMitschrift(id);
  if (input.save) {
    if (input.etag !== detail.etag) return STALE_VERSION;
    if (detail.notesEdited && !input.overwrite) return NOTES_EDITED;
  }
  const notes =
    detail.abschnitte.length === 0
      ? emptyNotizen()
      : await generateNotizen(
          { title: detail.title, date: detail.date },
          transcriptText(detail.abschnitte, detail.sprecher),
          input.pass
        );
  if (!input.save) return ok({ notes });
  return ok({
    notes,
    etag: await saveNotizen(id, notes, detail.etag, false, principal.userDetails),
  });
});

/**
 * POST: a transcription job for an uploaded file or a gap of the live recording, with a
 * short-lived, write-only link the browser uploads the audio to.
 */
export const MitschriftAuftraegeEndpoint = mitschriftHandler(async (id, request, _c, principal) => {
  const input = validateAuftrag(await readJsonBody(request));
  const detail = await requireMitschrift(id);
  if (input.source === 'datei' && detail.status !== 'datei') {
    throw new ValidationError({ datei: 'Diese Mitschrift erwartet keine Datei.' });
  }
  return ok(await createAuftrag(id, input, principal.userDetails), 201);
});

/** POST: the upload is complete; starts the transcription. DELETE: cancels or dismisses a job. */
export const MitschriftAuftragEndpoint = mitschriftHandler(async (id, request) => {
  const auftragId = childId(request, 'auftragId');
  if (auftragId === undefined) return NOT_FOUND;
  if (request.method === 'DELETE') await removeAuftrag(id, auftragId);
  else await startAuftrag(id, auftragId);
  return ok(await requireMitschrift(id));
});

/**
 * POST: asks Azure Speech about the running jobs; stores finished results and deletes their
 * audio right away. `stored` tells the page to generate the notes.
 */
export const MitschriftCheckEndpoint = mitschriftHandler(async (id) => {
  const stored = await checkAuftraege(id);
  return ok({ stored, mitschrift: await requireMitschrift(id) });
});

/** POST: deletes all Mitschriften older than the warning period, for good. */
export const MitschriftenCleanupEndpoint = pflegeHandler(AREA, async () =>
  withAzureErrors(async () => ok({ deleted: await deleteOldMitschriften() }))
);

export const GetMitschriften = withErrorHandling(GetMitschriftenEndpoint);
export const GetMitschrift = withErrorHandling(GetMitschriftEndpoint);
export const GetSpeechToken = withErrorHandling(GetSpeechTokenEndpoint);
export const MitschriftenCollection = withErrorHandling(MitschriftenCollectionEndpoint);
export const MitschriftItem = withErrorHandling(MitschriftItemEndpoint);
export const MitschriftFinish = withErrorHandling(MitschriftFinishEndpoint);
export const MitschriftLive = withErrorHandling(MitschriftLiveEndpoint);
export const MitschriftAbschnitt = withErrorHandling(MitschriftAbschnittEndpoint);
export const MitschriftAbschnitteDelete = withErrorHandling(MitschriftAbschnitteDeleteEndpoint);
export const MitschriftSprecher = withErrorHandling(MitschriftSprecherEndpoint);
export const MitschriftSprecherMerge = withErrorHandling(MitschriftSprecherMergeEndpoint);
export const MitschriftNotizen = withErrorHandling(MitschriftNotizenEndpoint);
export const MitschriftAuftraege = withErrorHandling(MitschriftAuftraegeEndpoint);
export const MitschriftAuftrag = withErrorHandling(MitschriftAuftragEndpoint);
export const MitschriftCheck = withErrorHandling(MitschriftCheckEndpoint);
export const MitschriftenCleanup = withErrorHandling(MitschriftenCleanupEndpoint);
