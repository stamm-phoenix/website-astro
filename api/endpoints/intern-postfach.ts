import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import {
  METHOD_NOT_ALLOWED,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { errorResponse, encodeContentDisposition, withErrorHandling } from '../lib/response-utils';
import { findPostfach, type PostfachEintrag } from '../lib/postfach-liste';
import {
  eigenerLogin,
  inbox,
  ladeAnsicht,
  ladeKonversation,
  ladePersonen,
  ladeStart,
  sichtbarePostfaecher,
} from '../lib/postfach';
import { AnhangNichtLadbarError, PostfachZugriffError, readAnhang } from '../lib/postfach-graph';
import { konversationenAus, type KonversationZeile } from '../lib/postfach-model';
import {
  alleGelesen,
  markiereNachrichten,
  setzeZustaendigkeit,
  ZustaendigkeitKonfliktError,
} from '../lib/postfach-stand';
import { postfachBenachrichtigung } from '../lib/postfach-mails';
import {
  getPrincipalFirstName,
  isPreviewDeployment,
  type ClientPrincipal,
} from '../lib/staff-auth';
import { getSiteUrl } from '../lib/site-url';
import {
  validateAnhang,
  validateGelesen,
  validateKonversationId,
  validateZustaendig,
} from '../lib/validation/postfach';

/**
 * Routes of the module „E-Mail“ under `/api/intern/postfach` (`docs/postfaecher.md`). Each
 * mailbox is only for the teams in `api/lib/postfach-liste.ts`.
 */

const KEIN_ZUGRIFF = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Dieses Postfach ist nur für bestimmte Teams freigegeben. Bist du gerade erst ins Team gekommen, melde dich ab und wieder an.'
);

const UNBEKANNT = errorResponse(404, 'NOT_FOUND', 'Dieses Postfach gibt es nicht.');

const KONVERSATION_FEHLT = errorResponse(
  404,
  'NOT_FOUND',
  'Diese E-Mail ist nicht mehr im Postfach. Vielleicht wurde sie in Outlook gelöscht.'
);

const GESPERRT = errorResponse(
  503,
  'POSTFACH_GESPERRT',
  'Die Website darf dieses Postfach gerade nicht lesen. Nichts wurde geändert. Bitte melde das an admin@stamm-phoenix.de.'
);

const ANHANG_NUR_OUTLOOK = errorResponse(
  422,
  'ANHANG_NUR_OUTLOOK',
  'Diesen Anhang kannst du nur in Outlook öffnen.'
);

const PERSON_OHNE_ZUGRIFF = errorResponse(
  400,
  'INVALID',
  'Diese Person hat keinen Zugriff auf das Postfach. Wähle jemanden aus der Liste.'
);

type Handler = (
  request: HttpRequest,
  postfach: PostfachEintrag,
  principal: ClientPrincipal,
  context: InvocationContext
) => Promise<HttpResponseInit>;

/** Resolves the mailbox of `{postfach}`, checks the teams and maps the errors of the module. */
export function postfachRoute(handler: Handler) {
  return withErrorHandling(
    pflegeHandler(
      'postfach',
      async (request, context, principal) => {
        const postfach = findPostfach(request.params.postfach ?? '');
        if (!postfach) return UNBEKANNT;
        if (!sichtbarePostfaecher(principal).includes(postfach)) return KEIN_ZUGRIFF;
        try {
          return await handler(request, postfach, principal, context);
        } catch (error: unknown) {
          if (error instanceof PostfachZugriffError) {
            context.error(`[postfach] Graph verweigert ${error.address}`);
            return GESPERRT;
          }
          if (error instanceof AnhangNichtLadbarError) return ANHANG_NUR_OUTLOOK;
          throw error;
        }
      },
      { quiet: true }
    )
  );
}

/** `GET /api/intern/postfach`: the mailboxes of the person and what waits for them. */
export const PostfachStartRoute = withErrorHandling(
  pflegeHandler('postfach', async (request, _context, principal) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    return ok(await ladeStart(principal));
  })
);

/** `GET /api/intern/postfach/{postfach}`: the conversations of the inbox; `?frisch=1` skips the cache. */
export const PostfachListeRoute = postfachRoute(async (request, postfach, principal) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  return ok(await ladeAnsicht(postfach, principal, request.query.get('frisch') === '1'));
});

/** `GET /api/intern/postfach/{postfach}/konversation?id=`: the messages with their bodies. */
export const PostfachKonversationRoute = postfachRoute(async (request, postfach, principal) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const id = validateKonversationId(request.query.get('id'));
  const detail = await ladeKonversation(postfach, principal, id);
  return detail ? ok(detail) : KONVERSATION_FEHLT;
});

/** `POST /api/intern/postfach/{postfach}/gelesen`: `{ nachrichten, gelesen }` or `{ alle: true }`. */
export const PostfachGelesenRoute = postfachRoute(async (request, postfach, principal) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const eingabe = validateGelesen(await readJsonBody(request));
  if ('alle' in eingabe) {
    await alleGelesen(postfach.id, principal.userId, eigenerLogin(principal));
  } else {
    await markiereNachrichten(postfach.id, principal.userId, eingabe.nachrichten, eingabe.gelesen);
  }
  return { status: 204, headers: NO_STORE_HEADERS };
});

/** `GET /api/intern/postfach/{postfach}/personen`: who can be made responsible. */
export const PostfachPersonenRoute = postfachRoute(async (request, postfach) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  return ok({ personen: await ladePersonen(postfach) });
});

/** The line of the conversation for the note, from the inbox or, if it left it, from all folders. */
async function zeileFuer(
  postfach: PostfachEintrag,
  principal: ClientPrincipal,
  konversation: string
): Promise<KonversationZeile | null> {
  const nachrichten = (await inbox(postfach.address)).nachrichten.filter(
    (nachricht) => nachricht.konversation === konversation
  );
  if (nachrichten.length) {
    const leer = { marken: new Map<string, boolean>(), gelesenBis: null };
    return konversationenAus(postfach.id, nachrichten, leer, new Map())[0] ?? null;
  }
  return (await ladeKonversation(postfach, principal, konversation))?.konversation ?? null;
}

/**
 * `PUT /api/intern/postfach/{postfach}/zustaendig` `{ konversation, login, vorher }`: makes a
 * member of the mailbox's teams responsible (null: nobody) and sends them a note, unless they
 * chose themselves. Answers `{ zustaendig, benachrichtigt }`; 409 names who is responsible now.
 */
export const PostfachZustaendigRoute = postfachRoute(
  async (request, postfach, principal, context) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const eingabe = validateZustaendig(await readJsonBody(request));
    const ich = eigenerLogin(principal);
    const personen = await ladePersonen(postfach);
    const neu = eingabe.login ? personen.find((person) => person.login === eingabe.login) : null;
    if (eingabe.login && !neu) return PERSON_OHNE_ZUGRIFF;
    const zeile = await zeileFuer(postfach, principal, eingabe.konversation);
    if (!zeile) return KONVERSATION_FEHLT;
    const von = {
      login: ich,
      name:
        personen.find((person) => person.login === ich)?.name ?? getPrincipalFirstName(principal),
    };
    let zustaendig;
    try {
      zustaendig = await setzeZustaendigkeit(
        postfach.id,
        eingabe.konversation,
        neu ?? null,
        eingabe.vorher,
        von,
        zeile.betreff
      );
    } catch (error: unknown) {
      if (!(error instanceof ZustaendigkeitKonfliktError)) throw error;
      const wer = error.aktuell ? `${error.aktuell.name} ist` : 'Niemand ist';
      return {
        status: 409,
        headers: NO_STORE_HEADERS,
        jsonBody: {
          error: 'CONFLICT',
          code: 'CONFLICT',
          message: `Jemand hat die Zuständigkeit inzwischen geändert: ${wer} jetzt zuständig. Nichts wurde gespeichert.`,
          zustaendig: error.aktuell,
        },
      };
    }
    context.log(
      `[postfach] ${ich} ${postfach.id} zuständig: ${zustaendig?.login ?? 'niemand'} (vorher ${eingabe.vorher ?? 'niemand'})`
    );
    let benachrichtigt = false;
    // Previews share the mail sending with production, so they send no notes
    if (zustaendig && zustaendig.login !== ich && !isPreviewDeployment()) {
      try {
        await postfachBenachrichtigung.senden(
          zustaendig.login,
          postfach,
          zeile,
          von.name,
          getSiteUrl(request)
        );
        benachrichtigt = true;
      } catch (error: unknown) {
        context.error(`[postfach] Mail an ${zustaendig.login} fehlgeschlagen`, error);
      }
    }
    return ok({ zustaendig, benachrichtigt });
  }
);

const SICHERE_TYPEN = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/** `GET /api/intern/postfach/{postfach}/anhang?nachricht=&anhang=`: one attachment as a file. */
export const PostfachAnhangRoute = postfachRoute(async (request, postfach) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const { nachricht, anhang } = validateAnhang(
    request.query.get('nachricht'),
    request.query.get('anhang')
  );
  const datei = await readAnhang(postfach.address, nachricht, anhang);
  return {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      // Only types a browser shows harmlessly keep their type; the file always downloads
      'Content-Type': SICHERE_TYPEN.has(datei.contentType.toLowerCase())
        ? datei.contentType
        : 'application/octet-stream',
      'Content-Disposition': encodeContentDisposition(datei.name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
    body: datei.content,
  };
});
