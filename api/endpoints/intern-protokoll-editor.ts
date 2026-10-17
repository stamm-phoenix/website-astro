import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { CampflowError } from '../lib/campflow';
import { CONFIG } from '../lib/config';
import { RecordNotFoundError, parseId } from '../lib/db';
import { getLeitende } from '../lib/leitende-list';
import type { PflegeHandler } from '../lib/pflege-api';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readEtag,
  readJsonBody,
} from '../lib/pflege-api';
import {
  ValidationError,
  validateProtokollEditorCreate,
  validateProtokollEditorSave,
  validateProtokollSperre,
} from '../lib/pflege-validation';
import type { EditorPerson } from '../lib/protokoll-editor';
import {
  NotEditableError,
  SperreError,
  createEditorProtokoll,
  deleteEditorProtokoll,
  getEditorLive,
  getEditorOverview,
  getEditorProtokoll,
  getRevision,
  listRevisions,
  releaseSperre,
  saveEditorProtokoll,
  takeSperre,
} from '../lib/protokoll-editor';
import type {
  PersonOption,
  ProtokollEditorPersonen,
  ProtokollPerson,
} from '../lib/protokoll-editor-model';
import { MAX_SITZUNGSLEITUNG, PERSON_GRUPPEN } from '../lib/protokoll-editor-model';
import {
  AblageNotConfiguredError,
  VersandUncertainError,
  approveEditorProtokoll,
  editorProtokollPdf,
  finishEditorVersand,
  loadEditorVersand,
  rejectEditorReview,
  reserveEditorVersand,
  submitEditorReview,
} from '../lib/protokoll-editor-review';
import {
  assertProtokollAttachmentSize,
  sendProtokollMail,
  sendProtokollRejectedMail,
} from '../lib/protokoll-mails';
import type { ProtokollRecipient } from '../lib/protokolle';
import {
  audienceVersion,
  loadProtokollRecipients,
  protokollDeliveryAddresses,
} from '../lib/protokolle';
import { getGraphStatus, getSharePointDriveFileContent } from '../lib/sharepoint-data-access';
import { getSiteUrl } from '../lib/site-url';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getClaim, isStaffError, requireStaff } from '../lib/staff-auth';
import { getTaskDirectoryUsers } from '../lib/task-directory';
import { getWeiterePersonen } from '../lib/weitere-personen';

/**
 * Protokoll-Editor (#277, `docs/protokoll-editor.md`): every logged-in leader may read all
 * minutes and write a draft while holding its lock. Logs name only IDs and actions, never
 * the text of the minutes; autosave and lock renewals are not logged at all.
 */

const AREA = 'protokoll-editor';
const TAB_HEADER = 'x-protokoll-tab';

const NOT_EDITABLE = errorResponse(
  409,
  'NOT_EDITABLE',
  'Das Protokoll ist nicht mehr im Entwurf und kann nicht mehr bearbeitet werden.'
);

const SENDING_NOT_CONFIGURED = errorResponse(
  503,
  'NOT_CONFIGURED',
  'Für den Versand ist noch kein Absender eingerichtet.'
);

const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden. Bitte versuche es später erneut.'
);

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The token of the reading or writing tab. Reads send it in a header, never in the URL, so it
 * stays out of logs and the browser history.
 */
function readToken(request: HttpRequest): string | null {
  const token = request.headers.get(TAB_HEADER) ?? '';
  return TOKEN.test(token) ? token : null;
}

/** The name of the directory entry with this login, ignoring case. */
async function directoryName(login: string): Promise<string | undefined> {
  try {
    const users = await getTaskDirectoryUsers();
    return users.find((user) => user.login.toLowerCase() === login.toLowerCase())?.name;
  } catch {
    return undefined;
  }
}

/** Name shown to the others: from the login's claims, the directory or the login itself. */
async function editorPerson(principal: ClientPrincipal): Promise<EditorPerson> {
  const login = principal.userDetails;
  const name =
    getClaim(principal, ['name'])?.trim() ||
    (await directoryName(login)) ||
    login.split('@')[0] ||
    login;
  return { login, name };
}

/** Lock and editability errors as answers the page understands. */
async function withEditorErrors(work: () => Promise<HttpResponseInit>): Promise<HttpResponseInit> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof SperreError) {
      return {
        status: 423,
        headers: NO_STORE_HEADERS,
        jsonBody: { error: 'LOCKED', code: 'LOCKED', message: error.message, sperre: error.sperre },
      };
    }
    if (error instanceof NotEditableError) return NOT_EDITABLE;
    if (error instanceof AblageNotConfiguredError) {
      return errorResponse(503, 'NOT_CONFIGURED', error.message);
    }
    if (error instanceof VersandUncertainError) {
      return errorResponse(409, 'UNCERTAIN', error.message);
    }
    throw error;
  }
}

/** A write endpoint of one set of minutes: 404 for an invalid ID. */
function editorHandler(
  work: (id: number, ...rest: Parameters<PflegeHandler>) => Promise<HttpResponseInit>,
  quiet = false
) {
  return pflegeHandler(
    AREA,
    async (request, context, principal) => {
      const id = parseId(request.params.id ?? '');
      if (id === undefined) return NOT_FOUND;
      return withEditorErrors(() => work(id, request, context, principal));
    },
    { quiet }
  );
}

/** GET: all minutes of the editor, newest first, with who is writing. */
export async function GetEditorOverviewEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await getEditorOverview() };
}

/** GET: one set of minutes. */
export async function GetEditorProtokollEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  const detail = await getEditorProtokoll(id, readToken(request));
  return detail ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: detail } : NOT_FOUND;
}

/**
 * GET `?etag=`: the live check of the readers, every few seconds. Sends the minutes only if
 * they changed since `etag`.
 */
export async function GetEditorLiveEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  const live = await getEditorLive(id, request.query.get('etag') ?? '', readToken(request));
  return live ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: live } : NOT_FOUND;
}

/** GET: the kept versions of one set of minutes, newest first. */
export async function GetEditorRevisionsEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await listRevisions(id) };
}

/** GET: one kept version with its content. */
export async function GetEditorRevisionEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const id = parseId(request.params.id ?? '');
  const revisionId = parseId(request.params.revisionId ?? '');
  if (id === undefined || revisionId === undefined) return NOT_FOUND;
  const revision = await getRevision(id, revisionId);
  return revision ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: revision } : NOT_FOUND;
}

/**
 * GET: the people to pick in the minutes: the leaders from the Entra group and the active
 * Altleitende and others of the list (#301). A source that fails is left out and reported as
 * `unavailable`; names can always be typed.
 */
export async function GetEditorPersonenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const [leitende, weitere] = await Promise.allSettled([
    getTaskDirectoryUsers(),
    getWeiterePersonen(),
  ]);
  const personen = new Map<string, PersonOption>();
  const key = (person: ProtokollPerson): string =>
    person.login ? person.login.toLowerCase() : `name:${person.name.toLowerCase()}`;
  if (leitende.status === 'fulfilled') {
    for (const user of leitende.value) {
      const person: PersonOption = { login: user.login, name: user.name, gruppe: 'leitende' };
      if (!personen.has(key(person))) personen.set(key(person), person);
    }
  }
  if (weitere.status === 'fulfilled') {
    for (const entry of weitere.value.filter((p) => p.aktiv)) {
      const person: PersonOption = { login: entry.login, name: entry.name, gruppe: entry.gruppe };
      // Someone in the Entra group counts as a leader, even if also on the list
      if (!personen.has(key(person))) personen.set(key(person), person);
    }
  }
  const body: ProtokollEditorPersonen = {
    personen: [...personen.values()].sort(
      (a, b) =>
        PERSON_GRUPPEN.indexOf(a.gruppe) - PERSON_GRUPPEN.indexOf(b.gruppe) ||
        a.name.localeCompare(b.name, 'de')
    ),
    unavailable: leitende.status === 'rejected' || weitere.status === 'rejected',
  };
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
}

/**
 * The Vorstand as preset Sitzungsleitung, with the login of the directory entry of the same
 * name; empty if the list cannot be read.
 */
async function vorstand(): Promise<ProtokollPerson[]> {
  try {
    const [leitende, users] = await Promise.all([
      getLeitende(),
      getTaskDirectoryUsers().catch(() => []),
    ]);
    const same = (a: string, b: string): boolean =>
      a.trim().localeCompare(b.trim(), 'de', { sensitivity: 'accent' }) === 0;
    return leitende
      .filter((person) => person.teams.includes('Vorstand'))
      .map((person) => ({
        login: users.find((user) => same(user.name, person.name))?.login ?? '',
        name: person.name,
      }))
      .slice(0, MAX_SITZUNGSLEITUNG);
  } catch {
    return [];
  }
}

/**
 * POST: new minutes with the standard agenda, the Vorstand and the writer preset, and the start
 * of the meeting if the browser sent it.
 */
export const EditorCollectionEndpoint = pflegeHandler(AREA, async (request, _c, principal) => {
  const input = validateProtokollEditorCreate(await readJsonBody(request));
  const [person, sitzungsleitung] = await Promise.all([editorPerson(principal), vorstand()]);
  const id = await createEditorProtokoll(
    input,
    {
      sitzungsleitung,
      protokollant: [{ login: person.login, name: person.name }],
      beginn: input.beginn,
    },
    principal.userDetails
  );
  return ok({ id }, 201);
});

/** PUT: autosave of the whole document. DELETE: a draft with its versions. */
export const EditorItemEndpoint = editorHandler(async (id, request, context, principal) => {
  if (request.method === 'DELETE') {
    const deleted = await deleteEditorProtokoll(id);
    if (deleted) context.log(`[pflege] ${principal.userDetails} DELETE ${AREA} ${id}`);
    return deleted ? NO_CONTENT : NOT_FOUND;
  }
  const input = validateProtokollEditorSave(await readJsonBody(request));
  const saved = await saveEditorProtokoll(id, input, await editorPerson(principal));
  if (input.sicherung) {
    context.log(`[pflege] ${principal.userDetails} PUT ${AREA} ${id} (${input.sicherung})`);
  }
  return ok(saved);
}, true);

/**
 * POST: takes or renews the lock of the writing tab (every few seconds); `uebernehmen` takes
 * it from another tab. DELETE: gives it up when the page is left.
 */
export const EditorSperreEndpoint = editorHandler(async (id, request, context, principal) => {
  const input = validateProtokollSperre(await readJsonBody(request));
  if (request.method === 'DELETE') {
    await releaseSperre(id, input.token);
    return NO_CONTENT;
  }
  const result = await takeSperre(id, input, await editorPerson(principal));
  if (input.uebernehmen)
    context.log(`[pflege] ${principal.userDetails} POST ${AREA} ${id} (übernommen)`);
  return ok(result);
}, true);

/** The page of the minutes, linked from the mails. */
function editorUrl(request: HttpRequest, id: number): string {
  return `${getSiteUrl(request)}/leitendenbereich/protokolle/protokoll?id=${id}`;
}

/**
 * GET: the PDF of the minutes. Approved minutes get the PDF filed in SharePoint, drafts and
 * minutes in review a fresh one marked as draft.
 */
export async function GetEditorPdfEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  let pdf: { fileName: string; content: Uint8Array };
  try {
    pdf = await editorProtokollPdf(id);
  } catch (error: unknown) {
    if (error instanceof RecordNotFoundError) return NOT_FOUND;
    throw error;
  }
  return {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': encodeContentDisposition(pdf.fileName),
    },
    body: pdf.content,
  };
}

/**
 * POST: a step of the review. `review` gives a draft to the review and `approve` files the PDF
 * and approves a draft or minutes in review (a draft only from the writing tab or while nobody
 * writes; one's own minutes only with `ownConfirmed`). `reject` sends minutes in review back
 * with a note that goes to the author by mail.
 */
export const EditorReviewEndpoint = editorHandler(async (id, request, context, principal) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  const action = body?.action;
  const etag = readEtag(body);
  const token = typeof body?.token === 'string' && TOKEN.test(body.token) ? body.token : null;
  let result: HttpResponseInit;
  if (action === 'review') {
    await submitEditorReview(id, { etag, token }, principal.userDetails);
    result = ok({});
  } else if (action === 'approve') {
    const ownConfirmed = body?.ownConfirmed === true;
    result = ok(await approveEditorProtokoll(id, { etag, token, ownConfirmed }, principal));
  } else if (action === 'reject') {
    const note = typeof body?.note === 'string' ? body.note : '';
    const rejected = await rejectEditorReview(id, { etag, note });
    let mailSent = false;
    if (CONFIG.protokolle.sender && rejected.createdBy.includes('@')) {
      try {
        await sendProtokollRejectedMail({
          to: rejected.createdBy,
          title: rejected.title,
          date: rejected.date,
          note: note.trim(),
          reviewer: principal.userDetails,
          url: editorUrl(request, id),
        });
        mailSent = true;
      } catch (error: unknown) {
        context.warn(`[protokoll-editor] Mail to the author of ${id} failed`, error);
      }
    }
    result = ok({ mailSent });
  } else {
    throw new ValidationError({ form: 'Unbekannte Aktion.' });
  }
  context.log(`[pflege] ${principal.userDetails} POST ${AREA} ${id} (${action})`);
  return result;
}, true);

/**
 * POST `preview`: the recipients from CampFlow (with reasons) and a version of that list. POST
 * `send`: mails the filed PDF to that list, without the addresses in `excluded` and with those in
 * `extra`, if the list still matches the confirmed version.
 */
export const EditorVersandEndpoint = pflegeHandler(
  'protokoll-editor-versand',
  async (request, context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    if (!CONFIG.protokolle.sender) return SENDING_NOT_CONFIGURED;
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const action = body?.action;
    if (action !== 'preview' && action !== 'send') {
      throw new ValidationError({ form: 'Unbekannte Aktion.' });
    }
    const retry = body?.retry === true;

    return withEditorErrors(async () => {
      const quelle = await loadEditorVersand(id, retry);
      let recipients: ProtokollRecipient[];
      try {
        recipients = await loadProtokollRecipients();
      } catch (error: unknown) {
        if (!(error instanceof CampflowError)) throw error;
        context.error(error);
        return CAMPFLOW_UNAVAILABLE;
      }
      const version = audienceVersion(recipients);
      if (action === 'preview') {
        return ok({ recipients: recipients.length, version, list: recipients });
      }

      if (body?.version !== version) {
        throw new ValidationError({
          form: 'Die Empfänger*innen in CampFlow haben sich geändert. Bitte prüf die Liste und bestätige sie erneut.',
        });
      }
      // Taken out or added by hand in the dialog, for this delivery only
      const addresses = protokollDeliveryAddresses(recipients, body?.excluded, body?.extra);
      if (addresses.length === 0) {
        throw new ValidationError({
          form: 'Es ist niemand ausgewählt. Wähle mindestens eine Person aus oder trag eine Adresse ein.',
        });
      }

      // Download before reserving, so a missing file leaves nothing to clean up
      let pdf: Uint8Array;
      try {
        pdf = await getSharePointDriveFileContent(quelle.pdf.driveId, quelle.pdf.itemId);
      } catch (error: unknown) {
        if (getGraphStatus(error) !== 404) throw error;
        throw new ValidationError({
          form: `Das PDF „${quelle.pdf.fileName}“ fehlt im Protokoll-Ordner. Bitte aus dem SharePoint-Papierkorb wiederherstellen.`,
        });
      }
      assertProtokollAttachmentSize(pdf.byteLength);
      const attempt = await reserveEditorVersand(
        id,
        { etag: readEtag(body), retry, recipients: addresses.length },
        principal.userDetails
      );
      try {
        await sendProtokollMail(addresses, {
          title: quelle.title,
          date: quelle.date,
          approvedBy: quelle.approvedBy,
          url: editorUrl(request, id),
          pdf: { name: quelle.pdf.fileName, contentType: 'application/pdf', content: pdf },
        });
      } catch (error: unknown) {
        // Graph refused the mail with a client error, so it did not go out. After a timeout or
        // a server error it may have, so the reservation stays.
        const status = getGraphStatus(error);
        if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
          await finishEditorVersand(id, attempt, 'failed');
        }
        throw error;
      }
      await finishEditorVersand(id, attempt, 'sent');
      return ok({ recipients: addresses.length });
    });
  }
);

export const GetEditorOverview = withErrorHandling(GetEditorOverviewEndpoint);
export const GetEditorProtokoll = withErrorHandling(GetEditorProtokollEndpoint);
export const GetEditorLive = withErrorHandling(GetEditorLiveEndpoint);
export const GetEditorRevisions = withErrorHandling(GetEditorRevisionsEndpoint);
export const GetEditorRevision = withErrorHandling(GetEditorRevisionEndpoint);
export const GetEditorPersonen = withErrorHandling(GetEditorPersonenEndpoint);
export const EditorCollection = withErrorHandling(EditorCollectionEndpoint);
export const EditorItem = withErrorHandling(EditorItemEndpoint);
export const EditorSperre = withErrorHandling(EditorSperreEndpoint);
export const GetEditorPdf = withErrorHandling(GetEditorPdfEndpoint);
export const EditorReview = withErrorHandling(EditorReviewEndpoint);
export const EditorVersand = withErrorHandling(EditorVersandEndpoint);
