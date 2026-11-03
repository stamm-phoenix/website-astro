import { CONFIG } from './config';
import {
  nachrichtOutlookUrl,
  postfachOutlookUrl,
  postfachRoles,
  POSTFAECHER,
  type PostfachEintrag,
} from './postfach-liste';
import { readInbox, readKonversation, readRestId } from './postfach-graph';
import {
  fuerMich,
  istGelesen,
  istMirZugewiesen,
  konversationenAus,
  type InboxNachricht,
  type KonversationDetail,
  type KonversationZeile,
  type PostfachAnsicht,
  type PostfachInfo,
  type PostfachPerson,
  type PostfachStart,
} from './postfach-model';
import { getLeseStand, getZustaendigkeiten } from './postfach-stand';
import type { ClientPrincipal } from './staff-auth';
import { readTaskDirectory } from './task-directory';

/**
 * The module „E-Mail“: combines the inbox from Graph with the responsibilities and the read
 * state of the person from Azure SQL (`docs/postfaecher.md`).
 */

/** The inbox of a mailbox is read at most this often per Function instance. */
const INBOX_CACHE_MS = 30_000;
const PERSONEN_CACHE_MS = 300_000;

/** The mailboxes the person may see, by the roles of their teams. */
export function sichtbarePostfaecher(
  principal: Pick<ClientPrincipal, 'userRoles'>
): PostfachEintrag[] {
  return POSTFAECHER.filter((postfach) =>
    postfachRoles(postfach).some((role) => principal.userRoles.includes(role))
  );
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

const inboxCache = new Map<string, { at: number; promise: Promise<InboxNachricht[]> }>();

/** The inbox, shared by the requests of the next seconds; `frisch` reads it again. */
export async function inbox(address: string, frisch = false): Promise<InboxNachricht[]> {
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

/** For the tests. */
export function resetPostfachCaches(): void {
  inboxCache.clear();
  personenCache.clear();
}

/** The list of a mailbox for the person. */
export async function ladeKonversationen(
  postfach: PostfachEintrag,
  principal: Pick<ClientPrincipal, 'userId' | 'userDetails'>,
  frisch = false
): Promise<KonversationZeile[]> {
  const [nachrichten, stand, zustaendig] = await Promise.all([
    inbox(postfach.address, frisch),
    getLeseStand(postfach.id, principal.userId, eigenerLogin(principal)),
    getZustaendigkeiten(postfach.id),
  ]);
  return konversationenAus(postfach.id, nachrichten, stand, zustaendig);
}

export async function ladeAnsicht(
  postfach: PostfachEintrag,
  principal: Pick<ClientPrincipal, 'userId' | 'userDetails'>,
  frisch = false
): Promise<PostfachAnsicht> {
  return {
    postfach: postfachInfo(postfach),
    konversationen: await ladeKonversationen(postfach, principal, frisch),
    ich: eigenerLogin(principal),
  };
}

/** Each mailbox on its own: one that fails shows as such, the others still count. */
export async function ladeStart(
  principal: Pick<ClientPrincipal, 'userId' | 'userDetails' | 'userRoles'>
): Promise<PostfachStart> {
  const login = eigenerLogin(principal);
  const ergebnisse = await Promise.all(
    sichtbarePostfaecher(principal).map(async (postfach) => {
      try {
        return { postfach, zeilen: await ladeKonversationen(postfach, principal) };
      } catch (error: unknown) {
        console.error(`[postfach] ${postfach.address} konnte nicht gelesen werden`, error);
        return { postfach, zeilen: null };
      }
    })
  );
  return {
    ich: login,
    postfaecher: ergebnisse.map(({ postfach, zeilen }) => ({
      ...postfachInfo(postfach),
      ungelesen: zeilen?.filter((zeile) => zeile.ungelesen > 0).length ?? 0,
      mirZugewiesen: zeilen?.filter((zeile) => istMirZugewiesen(zeile, login)).length ?? 0,
      fehler: zeilen === null,
    })),
    fuerMich: ergebnisse
      .flatMap(({ zeilen }) => fuerMich(zeilen ?? [], login))
      .sort((a, b) => b.am.localeCompare(a.am)),
  };
}

/**
 * The messages of a conversation with their read state. The line of the list is built from the
 * received messages, so it also exists when the conversation has left the inbox.
 */
export async function ladeKonversation(
  postfach: PostfachEintrag,
  principal: Pick<ClientPrincipal, 'userId' | 'userDetails'>,
  konversationId: string
): Promise<KonversationDetail | null> {
  const [{ nachrichten, vollstaendig }, stand, zustaendig] = await Promise.all([
    readKonversation(postfach.address, konversationId),
    getLeseStand(postfach.id, principal.userId, eigenerLogin(principal)),
    getZustaendigkeiten(postfach.id),
  ]);
  if (!nachrichten.length) return null;
  const eingegangen = nachrichten.filter((nachricht) => !nachricht.gesendet);
  const fuerZeile = (eingegangen.length ? eingegangen : nachrichten).map(
    (nachricht): InboxNachricht => ({
      id: nachricht.id,
      konversation: konversationId,
      betreff: nachricht.betreff,
      von: nachricht.von,
      am: nachricht.am,
      vorschau: nachricht.vorschau,
      hatAnhang: nachricht.anhaenge.length > 0,
      wichtig: false,
    })
  );
  const [konversation] = konversationenAus(postfach.id, fuerZeile, stand, zustaendig);
  const neueste = fuerZeile.at(-1);
  const restId = neueste ? await readRestId(postfach.address, neueste.id) : null;
  return {
    konversation,
    nachrichten: nachrichten.map((nachricht) => ({
      ...nachricht,
      // Own answers count as read: the person does not need to read them again
      gelesen: nachricht.gesendet || istGelesen(nachricht, stand),
    })),
    vollstaendig,
    outlookUrl: restId ? nachrichtOutlookUrl(postfach.address, restId) : null,
  };
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
