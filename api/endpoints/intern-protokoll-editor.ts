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
import type {
  PersonOption,
  ProtokollEditorPersonen,
  ProtokollPerson,
} from '../lib/protokoll-editor-model';
import { MAX_SITZUNGSLEITUNG, PERSON_GRUPPEN } from '../lib/protokoll-editor-model';
import { isProtokollReviewer } from '../lib/protokolle';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
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

/**
 * The token of the reading or writing tab. Reads send it in a header, never in the URL, so it
 * stays out of logs and the browser history.
 */
function readToken(request: HttpRequest): string | null {
  const token = request.headers.get(TAB_HEADER) ?? '';
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

/** POST: new minutes with the standard agenda, the Vorstand and the writer preset. */
export const EditorCollectionEndpoint = pflegeHandler(AREA, async (request, _c, principal) => {
  const input = validateProtokollEditorCreate(await readJsonBody(request));
  const [person, sitzungsleitung] = await Promise.all([editorPerson(principal), vorstand()]);
  const id = await createEditorProtokoll(
    input,
    { sitzungsleitung, protokollant: [{ login: person.login, name: person.name }] },
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
