import { METHOD_NOT_ALLOWED, ok, readJsonBody } from '../lib/pflege-api';
import { errorResponse } from '../lib/response-utils';
import { eigenerLogin, ladePersonen } from '../lib/postfach';
import type { KonversationZeile, Zustaendigkeit } from '../lib/postfach-model';
import { setzeZustaendigkeit, ZustaendigkeitKonfliktError } from '../lib/postfach-stand';
import { postfachBenachrichtigung } from '../lib/postfach-mails';
import { getPrincipalFirstName, isPreviewDeployment } from '../lib/staff-auth';
import { getSiteUrl } from '../lib/site-url';
import { validateZustaendigMehrere } from '../lib/validation/postfach';
import { postfachRoute, zeileFuer } from './intern-postfach';

const PERSON_OHNE_ZUGRIFF = errorResponse(
  400,
  'INVALID',
  'Diese Person hat keinen Zugriff auf das Postfach. Wähle jemanden aus der Liste.'
);

const NICHT_MEHR_DA = 'Diese E-Mail ist nicht mehr im Postfach.';
const NICHT_GESPEICHERT =
  'Nicht gespeichert. Versuche es noch einmal; hilft das nicht, schreib an admin@stamm-phoenix.de.';

/** What happened to one conversation of the choice. */
export interface ZuweisungErgebnis {
  konversation: string;
  /** Saved; otherwise `fehler` says why and `zustaendig` what applies now. */
  ok: boolean;
  /** Missing when it is not known what applies now (an unexpected error). */
  zustaendig?: Zustaendigkeit | null;
  fehler?: string;
}

/**
 * `PUT /api/intern/postfach/{postfach}/zustaendig-mehrere` `{ login, konversationen: [{ konversation,
 * vorher }] }`: one person (null: nobody) for several conversations of the list. Each one is
 * checked on its own like a single assignment, so a conflict keeps only that one as it is. The new
 * person gets one note for all of them, unless it is oneself. Answers `{ ergebnisse,
 * benachrichtigt }`; `benachrichtigt` is null when no note was due (nothing new for another
 * person), false when it was due but not sent.
 */
export const PostfachZustaendigMehrereRoute = postfachRoute(
  async (request, postfach, principal, context) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const eingabe = validateZustaendigMehrere(await readJsonBody(request));
    const ich = eigenerLogin(principal);
    const personen = await ladePersonen(postfach);
    const neu = eingabe.login ? personen.find((person) => person.login === eingabe.login) : null;
    if (eingabe.login && !neu) return PERSON_OHNE_ZUGRIFF;
    const von = {
      login: ich,
      name:
        personen.find((person) => person.login === ich)?.name ?? getPrincipalFirstName(principal),
    };
    const ergebnisse: ZuweisungErgebnis[] = [];
    const zugewiesen: KonversationZeile[] = [];
    for (const { konversation, vorher } of eingabe.konversationen) {
      // Each one is saved on its own, so a failure of one must not hide those already saved
      try {
        const zeile = await zeileFuer(postfach, principal, konversation);
        if (!zeile) {
          ergebnisse.push({ konversation, ok: false, zustaendig: null, fehler: NICHT_MEHR_DA });
          continue;
        }
        const zustaendig = await setzeZustaendigkeit(
          postfach.id,
          konversation,
          neu ?? null,
          vorher,
          von,
          zeile.betreff
        );
        ergebnisse.push({ konversation, ok: true, zustaendig });
        // Only what is new for the person goes into the note
        if (zustaendig && vorher !== zustaendig.login) zugewiesen.push(zeile);
      } catch (error: unknown) {
        if (error instanceof ZustaendigkeitKonfliktError) {
          ergebnisse.push({
            konversation,
            ok: false,
            zustaendig: error.aktuell,
            fehler: error.aktuell
              ? `Inzwischen ist ${error.aktuell.name} zuständig.`
              : 'Inzwischen ist niemand mehr zuständig.',
          });
          continue;
        }
        context.error(`[postfach] Zuständigkeit für ${konversation} nicht gespeichert`, error);
        // Unknown what applies now: the page reads the list again
        ergebnisse.push({ konversation, ok: false, fehler: NICHT_GESPEICHERT });
      }
    }
    context.log(
      `[postfach] ${ich} ${postfach.id} zuständig für ${zugewiesen.length}/${eingabe.konversationen.length}: ${neu?.login ?? 'niemand'}`
    );
    const faellig = !!neu && neu.login !== ich && zugewiesen.length > 0;
    let benachrichtigt: boolean | null = faellig ? false : null;
    // Previews share the mail sending with production, so they send no notes
    if (neu && faellig && !isPreviewDeployment()) {
      try {
        await postfachBenachrichtigung.senden(
          neu.login,
          postfach,
          zugewiesen,
          von.name,
          getSiteUrl(request)
        );
        benachrichtigt = true;
      } catch (error: unknown) {
        context.error(`[postfach] Mail an ${neu.login} fehlgeschlagen`, error);
      }
    }
    return ok({ ergebnisse, benachrichtigt });
  }
);
