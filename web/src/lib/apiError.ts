import { PERMISSION_HELP } from './helpContacts';

interface ApiErrorDetails {
  code?: string;
  /** Validation messages per form field, if the API rejected the input. */
  fields?: Record<string, string>;
  /** The server sent no usable message, e.g. a crash (5xx) or an unknown status. */
  unexplained?: boolean;
}

export class ApiError extends Error {
  readonly code?: string;
  readonly fields?: Record<string, string>;
  readonly unexplained: boolean;

  constructor(
    public status: number,
    message: string,
    { code, fields, unexplained = false }: ApiErrorDetails = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
    this.unexplained = unexplained;
  }
}

/** Shown for every request whose login has expired; dialogs offer to log in again next to it. */
export const SESSION_EXPIRED_MESSAGE =
  'Deine Anmeldung ist abgelaufen. Deine Eingaben sind noch da.';

/**
 * Builds an ApiError, using `code` and `message` from a JSON error body when available. A 401 of
 * an internal request means the login expired, whatever the body says.
 */
export async function toApiError(response: Response, internal: boolean): Promise<ApiError> {
  const { status } = response;
  if (internal && status === 401) return new ApiError(401, SESSION_EXPIRED_MESSAGE);
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const { code, message, fields } = body as {
        code?: unknown;
        message?: unknown;
        fields?: unknown;
      };
      // A server error without a code is an unhandled crash with a technical message
      if (typeof message === 'string' && (status < 500 || typeof code === 'string')) {
        return new ApiError(status, message, {
          code: typeof code === 'string' ? code : undefined,
          fields:
            fields && typeof fields === 'object' ? (fields as Record<string, string>) : undefined,
        });
      }
    }
  } catch (error: unknown) {
    // The caller gave up while the error body arrived: that is no API error
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // Not a JSON body, fall back to the status text
  }
  if (status === 403) {
    return new ApiError(403, `Du hast für diese Aktion keine Berechtigung. ${PERMISSION_HELP}`);
  }
  if (status === 409 || status === 412) {
    return new ApiError(
      status,
      'Die Daten wurden inzwischen geändert. Bitte lade die aktuelle Fassung.'
    );
  }
  return new ApiError(status, 'Die Anfrage konnte nicht verarbeitet werden.', {
    unexplained: true,
  });
}
