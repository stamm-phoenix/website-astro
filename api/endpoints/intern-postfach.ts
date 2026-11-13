import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { NachrichtGeaendertError, PostfachSchreibError } from '../lib/postfach-graph-basis';
import {
  errorResponse,
  encodeContentDisposition,
  NO_STORE_HEADERS,
  readJsonBody,
} from '../lib/response-utils';
import { findPostfach, type PostfachEintrag } from '../lib/postfach-liste';
import {
  eigenerLogin,
  ladeAnsicht,
  ladeKonversation,
  ladePersonen,
  ladeStart,
  sichtbarePostfaecher,
} from '../lib/postfach';
import { AnhangNichtLadbarError, PostfachZugriffError, readAnhang } from '../lib/postfach-graph';
import {
  KonversationZuLangError,
  setzeZustaendig,
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
  validateKonversationId,
  validateZustaendig,
} from '../lib/validation/postfach';
import { staffHandler } from '../lib/handler';

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

const SCHREIBEN_GESPERRT = errorResponse(
  503,
  'POSTFACH_SCHREIBGESCHUETZT',
  'Die Website darf in diesem Postfach gerade nichts ändern. Nichts wurde gespeichert. Setz Fähnchen und Kategorie solange in Outlook und melde das an admin@stamm-phoenix.de.'
);

const ZU_LANG = errorResponse(
  422,
  'KONVERSATION_ZU_LANG',
  'Diese Unterhaltung ist zu lang, um sie hier zu ändern. Nichts wurde gespeichert. Setz Fähnchen und Kategorie bitte in Outlook.'
);

const GERADE_GEAENDERT = errorResponse(
  409,
  'CONFLICT',
  'Jemand hat diese E-Mail gerade geändert, vielleicht in Outlook. Die Seite zeigt jetzt, was gilt. Versuche es dann noch einmal.'
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

/** The routes that change the mailbox. Previews change the real mailboxes too, to try them. */
export function postfachAenderung(handler: Handler) {
  return postfachRoute(handler);
}

type Handler = (
  request: HttpRequest,
  postfach: PostfachEintrag,
  principal: ClientPrincipal,
  context: InvocationContext
) => Promise<HttpResponseInit>;

/** Resolves the mailbox of `{postfach}`, checks the teams and maps the errors of the module. */
export function postfachRoute(handler: Handler) {
  return staffHandler(
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
        if (error instanceof PostfachSchreibError) {
          context.error(`[postfach] Graph verweigert Änderungen an ${error.address}`);
          return SCHREIBEN_GESPERRT;
        }
        if (error instanceof AnhangNichtLadbarError) return ANHANG_NUR_OUTLOOK;
        if (error instanceof KonversationZuLangError) return ZU_LANG;
        if (error instanceof NachrichtGeaendertError) return GERADE_GEAENDERT;
        throw error;
      }
    },
    { quiet: true }
  );
}

/** `GET /api/intern/postfach`: the mailboxes of the person and what waits for them. */
export const PostfachStartRoute = staffHandler('postfach', async (request, _context, principal) => {
  return ok(await ladeStart(principal));
});

/** `GET /api/intern/postfach/{postfach}`: the conversations of the inbox; `?frisch=1` skips the cache. */
export const PostfachListeRoute = postfachRoute(async (request, postfach, principal) => {
  return ok(await ladeAnsicht(postfach, principal, request.query.get('frisch') === '1'));
});

/** `GET /api/intern/postfach/{postfach}/konversation?id=`: the messages with their bodies. */
export const PostfachKonversationRoute = postfachRoute(async (request, postfach) => {
  const id = validateKonversationId(request.query.get('id'));
  const detail = await ladeKonversation(postfach, id);
  return detail ? ok(detail) : KONVERSATION_FEHLT;
});

/** `GET /api/intern/postfach/{postfach}/personen`: who can be made responsible. */
export const PostfachPersonenRoute = postfachRoute(async (request, postfach) => {
  return ok({ personen: await ladePersonen(postfach) });
});

/** Who acts, with the name of the directory if there is one. */
export async function handelnde(
  postfach: PostfachEintrag,
  principal: ClientPrincipal
): Promise<{ login: string; name: string }> {
  const ich = eigenerLogin(principal);
  const personen = await ladePersonen(postfach).catch(() => []);
  return {
    login: ich,
    name: personen.find((person) => person.login === ich)?.name ?? getPrincipalFirstName(principal),
  };
}

/**
 * `PUT /api/intern/postfach/{postfach}/zustaendig` `{ konversation, login, vorher }`: makes a
 * member of the mailbox's teams responsible (null: nobody) with an Outlook category and sends
 * them a note, unless they chose themselves. `vorher` is the name the page showed. Answers
 * `{ zustaendig, status, benachrichtigt }`; 409 names who is responsible now.
 */
export const PostfachZustaendigRoute = postfachAenderung(
  async (request, postfach, principal, context) => {
    const eingabe = validateZustaendig(await readJsonBody(request));
    const ich = eigenerLogin(principal);
    const personen = await ladePersonen(postfach);
    const neu = eingabe.login ? personen.find((person) => person.login === eingabe.login) : null;
    if (eingabe.login && !neu) return PERSON_OHNE_ZUGRIFF;
    let ergebnis;
    try {
      ergebnis = await setzeZustaendig(postfach, eingabe.konversation, neu ?? null, eingabe.vorher);
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
    if (!ergebnis) return KONVERSATION_FEHLT;
    const { zeile } = ergebnis;
    context.log(
      `[postfach] ${ich} ${postfach.id} zuständig: ${neu?.login ?? 'niemand'} (vorher ${eingabe.vorher ?? 'niemand'})`
    );
    let benachrichtigt = false;
    const neuFuerPerson = !!neu && ergebnis.vorher?.login !== neu.login;
    // Previews share the mail sending with production, so they send no notes
    if (neu && neu.login !== ich && neuFuerPerson && !isPreviewDeployment()) {
      try {
        const von = await handelnde(postfach, principal);
        await postfachBenachrichtigung.senden(
          neu.login,
          postfach,
          [zeile],
          von.name,
          getSiteUrl(request)
        );
        benachrichtigt = true;
      } catch (error: unknown) {
        context.error(`[postfach] Mail an ${neu.login} fehlgeschlagen`, error);
      }
    }
    return ok({
      zustaendig: zeile.zustaendig,
      status: zeile.status,
      benachrichtigt,
    });
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

// Module „E-Mail“: shared mailboxes (docs/postfaecher.md)
app.http('internPostfachStart', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/postfach',
  handler: PostfachStartRoute,
});

app.http('internPostfachListe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/postfach/{postfach}',
  handler: PostfachListeRoute,
});

app.http('internPostfachKonversation', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/postfach/{postfach}/konversation',
  handler: PostfachKonversationRoute,
});

app.http('internPostfachPersonen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/postfach/{postfach}/personen',
  handler: PostfachPersonenRoute,
});

app.http('internPostfachZustaendig', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/postfach/{postfach}/zustaendig',
  handler: PostfachZustaendigRoute,
});

app.http('internPostfachAnhang', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/postfach/{postfach}/anhang',
  handler: PostfachAnhangRoute,
});
