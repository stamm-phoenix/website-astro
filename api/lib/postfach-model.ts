/**
 * Types and pure rules of the module „E-Mail“ (`docs/postfaecher.md`), shared by the API, the
 * mock API and the web frontend. Free of zod and of Node APIs.
 */

export interface MailAdresse {
  name: string;
  adresse: string;
}

/** Who is responsible for a conversation. */
export interface Zustaendigkeit {
  login: string;
  name: string;
  /** Who chose the person; the same login when someone took it over. */
  vonLogin: string;
  vonName: string;
  /** ISO time of the assignment. */
  am: string;
}

/** A conversation in the list of a mailbox: its newest message in the inbox and its state. */
export interface KonversationZeile {
  /** `conversationId` of Exchange. */
  id: string;
  postfach: string;
  betreff: string;
  /** Sender of the newest message. */
  von: MailAdresse;
  /** ISO time of the newest message. */
  am: string;
  vorschau: string;
  /** Messages of the conversation in the inbox, as far as the list reaches. */
  anzahl: number;
  /** Of them, the ones the logged-in person has not read in the Leitendenbereich. */
  ungelesen: number;
  hatAnhang: boolean;
  wichtig: boolean;
  zustaendig: Zustaendigkeit | null;
}

export interface MailAnhang {
  id: string;
  name: string;
  groesse: number;
  typ: string;
  /** false: an attached message or too large; it opens only in Outlook. */
  herunterladbar: boolean;
}

/** A message of a conversation, with its body, as the reading view shows it. */
export interface MailNachricht {
  /** Immutable ID of Exchange: stays the same when the message is moved in Outlook. */
  id: string;
  von: MailAdresse;
  an: MailAdresse[];
  cc: MailAdresse[];
  am: string;
  betreff: string;
  /** Start of the text, for a folded message. */
  vorschau: string;
  /** HTML body with inline images as `data:` URLs; rendered in a sandboxed frame without scripts. */
  html: string | null;
  /** Plain text body when the message has no HTML. */
  text: string | null;
  anhaenge: MailAnhang[];
  /** The mailbox itself sent it (Sent Items), e.g. an answer from Outlook. */
  gesendet: boolean;
  gelesen: boolean;
}

export interface PostfachInfo {
  id: string;
  name: string;
  address: string;
  outlookUrl: string;
}

/** A person who can be made responsible: a member of one of the mailbox's teams. */
export interface PostfachPerson {
  login: string;
  name: string;
}

/** `GET /api/intern/postfach/{id}`. */
export interface PostfachAnsicht {
  postfach: PostfachInfo;
  konversationen: KonversationZeile[];
  /** Login of the logged-in person, to recognise own assignments. */
  ich: string;
}

/** `GET /api/intern/postfach/{id}/konversation?id=`. */
export interface KonversationDetail {
  konversation: KonversationZeile;
  nachrichten: MailNachricht[];
  /** false: the conversation has more messages than the view reads; the rest is in Outlook. */
  vollstaendig: boolean;
  /** Outlook on the web with the newest message of the conversation; null if none is in the inbox. */
  outlookUrl: string | null;
}

/** A mailbox on the start page with its counters for the logged-in person. */
export interface PostfachUebersicht extends PostfachInfo {
  ungelesen: number;
  mirZugewiesen: number;
  /** The mailbox could not be read; the others still show. */
  fehler: boolean;
}

/** `GET /api/intern/postfach`: the mailboxes the person sees and what is waiting for them. */
export interface PostfachStart {
  postfaecher: PostfachUebersicht[];
  /** Login of the logged-in person, to recognise own assignments. */
  ich: string;
  /** Conversations with unread messages or assigned to the person, newest first. */
  fuerMich: KonversationZeile[];
}

/** A message of the inbox as the list needs it. */
export interface InboxNachricht {
  id: string;
  konversation: string;
  betreff: string;
  von: MailAdresse;
  am: string;
  vorschau: string;
  hatAnhang: boolean;
  wichtig: boolean;
}

/** What the person has read in a mailbox: marked messages, and everything before `gelesenBis`. */
export interface LeseStand {
  /** Messages marked as read (true) or unread (false); a mark wins over `gelesenBis`. */
  marken: ReadonlyMap<string, boolean>;
  /** ISO time; messages received up to then count as read. */
  gelesenBis: string | null;
}

export function istGelesen(
  nachricht: Pick<InboxNachricht, 'id' | 'am'>,
  stand: LeseStand
): boolean {
  const marke = stand.marken.get(nachricht.id);
  if (marke !== undefined) return marke;
  return stand.gelesenBis !== null && nachricht.am <= stand.gelesenBis;
}

/**
 * Groups the messages of the inbox into conversations, newest first. Each conversation takes
 * subject, sender and preview of its newest message.
 */
export function konversationenAus(
  postfach: string,
  nachrichten: readonly InboxNachricht[],
  stand: LeseStand,
  zustaendig: ReadonlyMap<string, Zustaendigkeit>
): KonversationZeile[] {
  const byId = new Map<string, KonversationZeile>();
  const sorted = [...nachrichten].sort((a, b) => b.am.localeCompare(a.am));
  for (const nachricht of sorted) {
    const ungelesen = istGelesen(nachricht, stand) ? 0 : 1;
    const zeile = byId.get(nachricht.konversation);
    if (zeile) {
      zeile.anzahl++;
      zeile.ungelesen += ungelesen;
      zeile.hatAnhang ||= nachricht.hatAnhang;
      zeile.wichtig ||= nachricht.wichtig;
      continue;
    }
    byId.set(nachricht.konversation, {
      id: nachricht.konversation,
      postfach,
      betreff: nachricht.betreff,
      von: nachricht.von,
      am: nachricht.am,
      vorschau: nachricht.vorschau,
      anzahl: 1,
      ungelesen,
      hatAnhang: nachricht.hatAnhang,
      wichtig: nachricht.wichtig,
      zustaendig: zustaendig.get(nachricht.konversation) ?? null,
    });
  }
  return [...byId.values()];
}

/** The conversation is assigned to the login (compared without case). */
export function istMirZugewiesen(zeile: KonversationZeile, login: string): boolean {
  return zeile.zustaendig?.login.toLowerCase() === login.toLowerCase();
}

/** What the start page shows: unread or assigned to the person. */
export function fuerMich(zeilen: readonly KonversationZeile[], login: string): KonversationZeile[] {
  return zeilen.filter((zeile) => zeile.ungelesen > 0 || istMirZugewiesen(zeile, login));
}

/** Messages of a conversation the reading view reads and marks at most. */
export const KONVERSATION_MAX = 200;

/** Conversation IDs of Exchange are base64; anything else is refused before Graph is asked. */
export const KONVERSATION_ID = /^[A-Za-z0-9+/=_-]{8,256}$/;

/** Immutable message IDs of Exchange, also base64. */
export const NACHRICHT_ID = /^[A-Za-z0-9+/=_-]{8,256}$/;

/** Attachment IDs of Exchange, also base64. */
export const ANHANG_ID = /^[A-Za-z0-9+/=_-]{8,512}$/;
