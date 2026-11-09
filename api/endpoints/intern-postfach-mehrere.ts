import { METHOD_NOT_ALLOWED, ok, readJsonBody } from '../lib/pflege-api';
import { errorResponse } from '../lib/response-utils';
import { eigenerLogin, ladePersonen } from '../lib/postfach';
import { NachrichtGeaendertError, PostfachSchreibError } from '../lib/postfach-graph-basis';
import type { KonversationZeile, PostfachStatus, Zustaendigkeit } from '../lib/postfach-model';
import {
  KonversationZuLangError,
  setzeZustaendig,
  ZustaendigkeitKonfliktError,
} from '../lib/postfach-stand';
import { postfachBenachrichtigung } from '../lib/postfach-mails';
import { isPreviewDeployment } from '../lib/staff-auth';
import { getSiteUrl } from '../lib/site-url';
import { validateZustaendigMehrere } from '../lib/validation/postfach';
import { handelnde, postfachAenderung } from './intern-postfach';

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
  /** The status afterwards: a new conversation that got a person needs action. */
  status?: PostfachStatus;
  erledigtAm?: string | null;
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
export const PostfachZustaendigMehrereRoute = postfachAenderung(
  async (request, postfach, principal, context) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const eingabe = validateZustaendigMehrere(await readJsonBody(request));
    const ich = eigenerLogin(principal);
    const personen = await ladePersonen(postfach);
    const neu = eingabe.login ? personen.find((person) => person.login === eingabe.login) : null;
    if (eingabe.login && !neu) return PERSON_OHNE_ZUGRIFF;
    const ergebnisse: ZuweisungErgebnis[] = [];
    const zugewiesen: KonversationZeile[] = [];
    for (const { konversation, vorher } of eingabe.konversationen) {
      // Each one is saved on its own, so a failure of one must not hide those already saved
      try {
        const ergebnis = await setzeZustaendig(postfach, konversation, neu ?? null, vorher);
        if (!ergebnis) {
          ergebnisse.push({ konversation, ok: false, zustaendig: null, fehler: NICHT_MEHR_DA });
          continue;
        }
        const { zeile } = ergebnis;
        ergebnisse.push({
          konversation,
          ok: true,
          zustaendig: zeile.zustaendig,
          status: zeile.status,
          erledigtAm: zeile.erledigtAm,
        });
        // Only what is new for the person goes into the note
        if (neu && ergebnis.vorher?.login !== neu.login) zugewiesen.push(zeile);
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
        if (error instanceof NachrichtGeaendertError) {
          // Part of it may be written: the page reads the list again
          ergebnisse.push({
            konversation,
            ok: false,
            fehler:
              'Jemand hat sie gerade geändert, vielleicht in Outlook. Versuche es noch einmal.',
          });
          continue;
        }
        if (error instanceof KonversationZuLangError) {
          ergebnisse.push({
            konversation,
            ok: false,
            fehler: 'Zu lang, um sie hier zu ändern. Setz die Kategorie bitte in Outlook.',
          });
          continue;
        }
        // Without permission to change the mailbox the others fail the same way
        if (error instanceof PostfachSchreibError && !ergebnisse.some((entry) => entry.ok))
          throw error;
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
        const von = await handelnde(postfach, principal);
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
