import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { parseId } from '../lib/db';
import { getLeitende } from '../lib/leitende-list';
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
import type { ProtokollEditorPersonen } from '../lib/protokoll-editor-model';
import { isProtokollReviewer } from '../lib/protokolle';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getClaim, isStaffError, requireStaff } from '../lib/staff-auth';
import { getTaskDirectoryUsers } from '../lib/task-directory';

/**
 * Protokoll-Editor (#277, `docs/protokoll-editor.md`): every logged-in leader may read all
 * minutes and write a draft while holding its lock. Logs name only IDs and actions, never
 * the text of the minutes; autosave and lock renewals are not logged at all.
 */

const AREA = 'protokoll-editor';

const NOT_EDITABLE = errorResponse(
  409,
  'NOT_EDITABLE',
  'Das Protokoll ist nicht mehr im Entwurf und kann nicht mehr bearbeitet werden.'
);

/** The token of the reading or writing tab, sent as `?token=` by reads. */
function readToken(request: HttpRequest): string | null {
  const token = request.query.get('token') ?? '';
  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
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
  const detail = await getEditorProtokoll(
    id,
    readToken(request),
    principal.userDetails,
    isProtokollReviewer(principal)
  );
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
  const live = await getEditorLive(
    id,
    request.query.get('etag') ?? '',
    readToken(request),
    principal.userDetails,
    isProtokollReviewer(principal)
  );
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

/** GET: the leaders to pick for attendance and tasks; empty if the directory fails. */
export async function GetEditorPersonenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  let body: ProtokollEditorPersonen;
  try {
    const users = await getTaskDirectoryUsers();
    const personen = [
      ...new Map(
        users.map((user) => [user.login, { login: user.login, name: user.name }])
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    body = { personen, unavailable: false };
  } catch {
    body = { personen: [], unavailable: true };
  }
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
}

/** The Vorstand as preset Sitzungsleitung; empty if the list cannot be read. */
async function vorstandNames(): Promise<string> {
  try {
    const leitende = await getLeitende();
    return leitende
      .filter((person) => person.teams.includes('Vorstand'))
      .map((person) => person.name)
      .join(', ');
  } catch {
    return '';
  }
}

/** POST: new minutes with the standard agenda, the Vorstand and the writer preset. */
export const EditorCollectionEndpoint = pflegeHandler(AREA, async (request, _c, principal) => {
  const input = validateProtokollEditorCreate(await readJsonBody(request));
  const [person, sitzungsleitung] = await Promise.all([editorPerson(principal), vorstandNames()]);
  const id = await createEditorProtokoll(
    input,
    { sitzungsleitung, protokollant: person.name },
    principal.userDetails
  );
  return ok({ id }, 201);
});

/** PUT: autosave of the whole document. DELETE: a draft with its versions. */
export const EditorItemEndpoint = editorHandler(async (id, request, context, principal) => {
  if (request.method === 'DELETE') {
    const deleted = await deleteEditorProtokoll(
      id,
      principal.userDetails,
      isProtokollReviewer(principal)
    );
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

export const GetEditorOverview = withErrorHandling(GetEditorOverviewEndpoint);
export const GetEditorProtokoll = withErrorHandling(GetEditorProtokollEndpoint);
export const GetEditorLive = withErrorHandling(GetEditorLiveEndpoint);
export const GetEditorRevisions = withErrorHandling(GetEditorRevisionsEndpoint);
export const GetEditorRevision = withErrorHandling(GetEditorRevisionEndpoint);
export const GetEditorPersonen = withErrorHandling(GetEditorPersonenEndpoint);
export const EditorCollection = withErrorHandling(EditorCollectionEndpoint);
export const EditorItem = withErrorHandling(EditorItemEndpoint);
export const EditorSperre = withErrorHandling(EditorSperreEndpoint);
