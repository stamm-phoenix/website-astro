import { CONFIG } from './config';
import {
  nachrichtOutlookUrl,
  postfachOutlookUrl,
  postfachRoles,
  POSTFAECHER,
  type PostfachEintrag,
} from './postfach-liste';
import {
  PostfachZugriffError,
  readInbox,
  readKonversation,
  readRestId,
  resetSentItemsCache,
  type Posteingang,
} from './postfach-graph';
import {
  fuerMich,
  istMirZugewiesen,
  konversationenAus,
  type InboxNachricht,
  type KonversationDetail,
  type MailNachricht,
  type KonversationZeile,
  type PostfachAnsicht,
  type PostfachInfo,
  type PostfachPerson,
  type PostfachStart,
} from './postfach-model';
import { resetKategorienCache } from './postfach-schreiben';
import { isPreviewDeployment, isPreviewOnlyLogin, type ClientPrincipal } from './staff-auth';
import { readTaskDirectory } from './task-directory';

/**
 * The module „E-Mail“: the inbox from Graph, with the status and the responsible person taken
 * from the flags and categories in Outlook (`docs/postfaecher.md`).
 */

/** The inbox of a mailbox is read at most this often per Function instance. */
const INBOX_CACHE_MS = 30_000;
const PERSONEN_CACHE_MS = 300_000;

/**
 * The mailboxes the person may see, by the roles of their teams. The test accounts of the
 * previews get every role there without being in the teams (`getTeamRoles`), and previews read
 * the real mailboxes: so they see only the mailbox of the Leitende, never those of the Vorstand,
 * the Förderverein or the admins.
 */
export function sichtbarePostfaecher(
  principal: Pick<ClientPrincipal, 'userRoles' | 'userDetails'>
): PostfachEintrag[] {
  const testkonto = isPreviewOnlyLogin(principal.userDetails);
  return POSTFAECHER.filter((postfach) => {
    const rollen = postfachRoles(postfach);
    if (testkonto) return rollen.includes(CONFIG.staff.teams.leitende.role);
    return rollen.some((role) => principal.userRoles.includes(role));
  });
}

export function postfachInfo(postfach: PostfachEintrag): PostfachInfo {
  return {
    id: postfach.id,
    name: postfach.name,
    address: postfach.address,
    outlookUrl: postfachOutlookUrl(postfach.address),
  };
}

/** The login of the person, as the directory and the responsibilities store it. */
export function eigenerLogin(principal: Pick<ClientPrincipal, 'userDetails'>): string {
  return principal.userDetails.trim().toLowerCase();
}

const inboxCache = new Map<string, { at: number; promise: Promise<Posteingang> }>();

/** The inbox, shared by the requests of the next seconds; `frisch` reads it again. */
export async function inbox(address: string, frisch = false): Promise<Posteingang> {
  const cached = inboxCache.get(address);
  if (cached && !frisch && Date.now() - cached.at < INBOX_CACHE_MS) return cached.promise;
  const promise = readInbox(address);
  inboxCache.set(address, { at: Date.now(), promise });
  // A failure is not kept, so the next request tries again
  promise.catch(() => {
    if (inboxCache.get(address)?.promise === promise) inboxCache.delete(address);
  });
  return promise;
}

/** After a change: the next request reads the inbox anew. */
export function inboxVergessen(address: string): void {
  inboxCache.delete(address);
}

/** For the tests. */
export function resetPostfachCaches(): void {
  resetSentItemsCache();
  resetKategorienCache();
  inboxCache.clear();
  personenCache.clear();
}

/**
 * The people of the mailbox to match the categories against. Without them the names still show,
 * only „Dir zugewiesen“ is not recognised.
 */
export async function personenFuerKategorien(postfach: PostfachEintrag): Promise<PostfachPerson[]> {
  return ladePersonen(postfach).catch((error: unknown) => {
    console.error(`[postfach] Personen von ${postfach.id} nicht lesbar`, error);
    return [];
  });
}

/** The list of a mailbox. */
export async function ladeKonversationen(
  postfach: PostfachEintrag,
  frisch = false
): Promise<KonversationZeile[]> {
  const [{ nachrichten }, personen] = await Promise.all([
    inbox(postfach.address, frisch),
    personenFuerKategorien(postfach),
  ]);
  return konversationenAus(postfach.id, nachrichten, personen);
}

export async function ladeAnsicht(
  postfach: PostfachEintrag,
  principal: Pick<ClientPrincipal, 'userDetails'>,
  frisch = false
): Promise<PostfachAnsicht> {
  const konversationen = await ladeKonversationen(postfach, frisch);
  return {
    postfach: postfachInfo(postfach),
    konversationen,
    // Read once above; the second call takes the same answer from the cache
    begrenzt: (await inbox(postfach.address)).begrenzt,
    ich: eigenerLogin(principal),
    // Previews read the real mailboxes, so they must not change them
    nurLesen: isPreviewDeployment(),
  };
}

/** Each mailbox on its own: one that fails shows as such, the others still count. */
export async function ladeStart(
  principal: Pick<ClientPrincipal, 'userDetails' | 'userRoles'>
): Promise<PostfachStart> {
  const login = eigenerLogin(principal);
  const ergebnisse = await Promise.all(
    sichtbarePostfaecher(principal).map(async (postfach) => {
      try {
        return {
          postfach,
          zeilen: await ladeKonversationen(postfach),
          gesperrt: false,
        };
      } catch (error: unknown) {
        console.error(`[postfach] ${postfach.address} konnte nicht gelesen werden`, error);
        return { postfach, zeilen: null, gesperrt: error instanceof PostfachZugriffError };
      }
    })
  );
  return {
    ich: login,
    postfaecher: ergebnisse.map(({ postfach, zeilen, gesperrt }) => ({
      ...postfachInfo(postfach),
      neu: zeilen?.filter((zeile) => zeile.status === 'neu').length ?? 0,
      mirZugewiesen:
        zeilen?.filter((zeile) => zeile.status !== 'erledigt' && istMirZugewiesen(zeile, login))
          .length ?? 0,
      fehler: zeilen === null,
      gesperrt,
    })),
    fuerMich: ergebnisse
      .flatMap(({ zeilen }) => fuerMich(zeilen ?? [], login))
      .sort((a, b) => b.am.localeCompare(a.am)),
  };
}

/**
 * The messages of a conversation. The line of the list is built from the received messages, so
 * it also exists when the conversation has left the inbox.
 */
export async function ladeKonversation(
  postfach: PostfachEintrag,
  konversationId: string
): Promise<KonversationDetail | null> {
  const [{ nachrichten, eingegangen, vollstaendig }, personen] = await Promise.all([
    readKonversation(postfach.address, konversationId),
    personenFuerKategorien(postfach),
  ]);
  if (!nachrichten.length) return null;
  const konversation = zeileAus(konversationId, eingegangen, nachrichten);
  const neueste = (eingegangen.length ? eingegangen : nachrichten).at(-1);
  const restId = neueste ? await readRestId(postfach.address, neueste.id) : null;
  return {
    konversation: konversationenAus(postfach.id, konversation, personen)[0],
    nachrichten,
    vollstaendig,
    outlookUrl: restId ? nachrichtOutlookUrl(postfach.address, restId) : null,
  };
}

/** The received messages for the line; with none (only sent ones) the sent ones, without marks. */
function zeileAus(
  konversationId: string,
  eingegangen: InboxNachricht[],
  nachrichten: MailNachricht[]
): InboxNachricht[] {
  if (eingegangen.length) return eingegangen;
  return nachrichten.map((nachricht) => ({
    id: nachricht.id,
    konversation: konversationId,
    betreff: nachricht.betreff,
    von: nachricht.von,
    am: nachricht.am,
    vorschau: nachricht.vorschau,
    hatAnhang: nachricht.anhaenge.length > 0,
    wichtig: false,
    flag: 'notFlagged',
    erledigtAm: null,
    kategorien: [],
  }));
}

/** The directory of the teams; a seam for the tests. */
export const postfachVerzeichnis = { lesen: readTaskDirectory };

const personenCache = new Map<string, { at: number; promise: Promise<PostfachPerson[]> }>();

/**
 * Who can be made responsible: the members of the mailbox's teams who are also in the team
 * „Leitende“, because only they can open the Leitendenbereich the note links to.
 */
export async function ladePersonen(postfach: PostfachEintrag): Promise<PostfachPerson[]> {
  const cached = personenCache.get(postfach.id);
  if (cached && Date.now() - cached.at < PERSONEN_CACHE_MS) return cached.promise;
  const lesen = (team: keyof typeof CONFIG.staff.teams) =>
    postfachVerzeichnis.lesen(AbortSignal.timeout(5000), CONFIG.staff.teams[team].groupId);
  const promise = Promise.all([
    lesen('leitende'),
    ...postfach.teams.filter((team) => team !== 'leitende').map(lesen),
  ]).then(([leitende, ...teams]) => {
    const imLeitendenbereich = new Set(leitende.map((user) => user.login));
    // Mailboxes of the Leitende take all of them; others only their members among them
    const kandidaten = postfach.teams.includes('leitende') ? leitende : teams.flat();
    const byLogin = new Map<string, PostfachPerson>();
    for (const user of kandidaten)
      if (imLeitendenbereich.has(user.login))
        byLogin.set(user.login, { login: user.login, name: user.name });
    return [...byLogin.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });
  personenCache.set(postfach.id, { at: Date.now(), promise });
  promise.catch(() => {
    if (personenCache.get(postfach.id)?.promise === promise) personenCache.delete(postfach.id);
  });
  return promise;
}
