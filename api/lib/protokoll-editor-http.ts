import { type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { parseId } from './db';
import { NOT_FOUND } from './pflege-api';
import type { EditorPerson } from './protokoll-editor';
import { NotEditableError, SperreError } from './protokoll-editor';
import { AblageNotConfiguredError, VersandUncertainError } from './protokoll-editor-review';
import { errorResponse, NO_STORE_HEADERS } from './response-utils';
import type { ClientPrincipal } from './staff-auth';
import { getClaim } from './staff-auth';
import { getTaskDirectoryUsers } from './task-directory';
import { staffHandler, type StaffRequestHandler } from './handler';

export const AREA = 'protokoll-editor';
const TAB_HEADER = 'x-protokoll-tab';

const NOT_EDITABLE = errorResponse(
  409,
  'NOT_EDITABLE',
  'Das Protokoll ist nicht mehr im Entwurf und kann nicht mehr bearbeitet werden.'
);

export const SENDING_NOT_CONFIGURED = errorResponse(
  503,
  'NOT_CONFIGURED',
  'Für den Versand ist noch kein Absender eingerichtet.'
);

export const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden. Bitte versuche es später erneut.'
);

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The token of the reading or writing tab. Reads send it in a header, never in the URL, so it
 * stays out of logs and the browser history.
 */
export function readToken(request: HttpRequest): string | null {
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
export async function editorPerson(principal: ClientPrincipal): Promise<EditorPerson> {
  const login = principal.userDetails;
  const name =
    getClaim(principal, ['name'])?.trim() ||
    (await directoryName(login)) ||
    login.split('@')[0] ||
    login;
  return { login, name };
}

/** Lock and editability errors as answers the page understands. */
export async function withEditorErrors(
  work: () => Promise<HttpResponseInit>
): Promise<HttpResponseInit> {
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
export function editorHandler(
  work: (id: number, ...rest: Parameters<StaffRequestHandler>) => Promise<HttpResponseInit>,
  quiet = false
) {
  return staffHandler(
    AREA,
    async (request, context, principal) => {
      const id = parseId(request.params.id ?? '');
      if (id === undefined) return NOT_FOUND;
      return withEditorErrors(() => work(id, request, context, principal));
    },
    { quiet }
  );
}
