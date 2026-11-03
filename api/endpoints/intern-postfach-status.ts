import { METHOD_NOT_ALLOWED, NO_STORE_HEADERS, ok, readJsonBody } from '../lib/pflege-api';
import { errorResponse } from '../lib/response-utils';
import { eigenerLogin, ladePersonen } from '../lib/postfach';
import {
  ErledigungKonfliktError,
  NeueNachrichtError,
  setzeErledigung,
} from '../lib/postfach-erledigung';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { validateStatus } from '../lib/validation/postfach';
import { postfachRoute, zeileFuer } from './intern-postfach';

const KONVERSATION_FEHLT = errorResponse(
  404,
  'NOT_FOUND',
  'Diese E-Mail ist nicht mehr im Postfach. Vielleicht wurde sie in Outlook gelöscht.'
);

const STATUS_NAMEN = {
  offen: 'offen',
  erledigt: 'erledigt',
  kein_handlungsbedarf: 'ohne Handlungsbedarf',
} as const;

/**
 * `PUT /api/intern/postfach/{postfach}/status` `{ konversation, status, vorher }`: marks the
 * conversation as done, as needing nothing or as open again. Anyone who sees the mailbox may do
 * it. Answers `{ erledigung }`; 409 says what applies now.
 */
export const PostfachStatusRoute = postfachRoute(async (request, postfach, principal, context) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const eingabe = validateStatus(await readJsonBody(request));
  // Fresh from the mailbox, so a message that just arrived is not closed unseen
  const zeile = await zeileFuer(postfach, principal, eingabe.konversation, true);
  if (!zeile) return KONVERSATION_FEHLT;
  const ich = eigenerLogin(principal);
  const personen = await ladePersonen(postfach).catch(() => []);
  const von = {
    login: ich,
    name: personen.find((person) => person.login === ich)?.name ?? getPrincipalFirstName(principal),
  };
  try {
    const erledigung = await setzeErledigung(
      postfach.id,
      eingabe.konversation,
      eingabe.status,
      eingabe.vorher,
      new Date(eingabe.bis).toISOString(),
      zeile.am,
      von,
      zeile.betreff
    );
    context.log(`[postfach] ${ich} ${postfach.id} Stand: ${eingabe.status}`);
    return ok({ erledigung });
  } catch (error: unknown) {
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
    if (!(error instanceof ErledigungKonfliktError)) throw error;
    const jetzt = error.aktuell
      ? `${error.aktuell.name} hat sie inzwischen als ${STATUS_NAMEN[error.aktuell.status]} markiert`
      : 'Sie ist inzwischen wieder offen';
    return {
      status: 409,
      headers: NO_STORE_HEADERS,
      jsonBody: {
        error: 'CONFLICT',
        code: 'CONFLICT',
        message: `${jetzt}. Nichts wurde gespeichert.`,
        erledigung: error.aktuell,
      },
    };
  }
});
