import { app } from '@azure/functions';
import { METHOD_NOT_ALLOWED, NO_STORE_HEADERS, ok, readJsonBody } from '../lib/pflege-api';
import { errorResponse } from '../lib/response-utils';
import { eigenerLogin } from '../lib/postfach';
import {
  KeinArchivError,
  NeueNachrichtError,
  setzeStatus,
  StatusKonfliktError,
} from '../lib/postfach-stand';
import { validateStatus } from '../lib/validation/postfach';
import { postfachAenderung } from './intern-postfach';

const KONVERSATION_FEHLT = errorResponse(
  404,
  'NOT_FOUND',
  'Diese E-Mail ist nicht mehr im Postfach. Vielleicht wurde sie in Outlook gelöscht.'
);

const KEIN_ARCHIV = errorResponse(
  503,
  'KEIN_ARCHIV',
  'Dieses Postfach hat keinen Archivordner, in den erledigte E-Mails kommen. Nichts wurde gespeichert. Bitte melde das an admin@stamm-phoenix.de.'
);

const JETZT = {
  neu: 'Sie ist inzwischen wieder neu, vielleicht durch eine neue Nachricht',
  handlungsbedarf: 'Jemand hat sie inzwischen mit „Handlungsbedarf“ markiert',
  erledigt: 'Jemand hat sie inzwischen erledigt oder archiviert',
} as const;

/**
 * `PUT /api/intern/postfach/{postfach}/status` `{ konversation, status, vorher, bis }`: makes the
 * conversation „Neu“ or „Handlungsbedarf“ in the inbox (with or without a flag) or archives it as
 * „Erledigt“. Anyone who sees the mailbox may do it. Answers `{ status }`; 409 says what applies
 * now.
 */
export const PostfachStatusRoute = postfachAenderung(
  async (request, postfach, principal, context) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const eingabe = validateStatus(await readJsonBody(request));
    try {
      const zeile = await setzeStatus(
        postfach,
        eingabe.konversation,
        eingabe.status,
        eingabe.vorher,
        new Date(eingabe.bis).toISOString()
      );
      if (!zeile) return KONVERSATION_FEHLT;
      context.log(`[postfach] ${eigenerLogin(principal)} ${postfach.id} Stand: ${eingabe.status}`);
      return ok({ status: zeile.status });
    } catch (error: unknown) {
      if (error instanceof KeinArchivError) return KEIN_ARCHIV;
      if (error instanceof NeueNachrichtError) {
        return {
          status: 409,
          headers: NO_STORE_HEADERS,
          jsonBody: {
            error: 'CONFLICT',
            code: 'NEUE_NACHRICHT',
            message:
              'Seit du die Unterhaltung geöffnet hast, ist eine neue Nachricht gekommen. Nichts wurde gespeichert. Lies sie und markiere dann noch einmal.',
          },
        };
      }
      if (!(error instanceof StatusKonfliktError)) throw error;
      return {
        status: 409,
        headers: NO_STORE_HEADERS,
        jsonBody: {
          error: 'CONFLICT',
          code: 'CONFLICT',
          message: `${JETZT[error.aktuell.status]}. Nichts wurde gespeichert.`,
          status: error.aktuell.status,
        },
      };
    }
  }
);

app.http('internPostfachStatus', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/postfach/{postfach}/status',
  handler: PostfachStatusRoute,
});
