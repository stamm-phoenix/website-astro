/**
 * Types and pure rules of the module „E-Mail“ (`docs/postfaecher.md`), shared by the API, the
 * mock API and the web frontend. Free of zod and of Node APIs.
 */

export interface MailAdresse {
  name: string;
  adresse: string;
}

/**
 * Who is responsible for a conversation: an Outlook category of the mailbox with
 * `ZUSTAENDIG_PRAEFIX` and the name of the person, so Outlook shows it too.
 */
export interface Zustaendigkeit {
  /** Login of the person, when the name belongs to one of the mailbox's teams. */
  login: string | null;
  name: string;
}

/**
 * Where a conversation stands, from the flags in Outlook: „Neu“ without a flag, „Handlungsbedarf“
 * with a flag, „Erledigt“ with a completed flag.
 */
export type PostfachStatus = 'neu' | 'handlungsbedarf' | 'erledigt';

/** The flag of a message in Outlook (`flag.flagStatus` of Graph). */
export type OutlookFlag = 'notFlagged' | 'flagged' | 'complete';

/** Prefix of the Outlook categories that name the responsible person. */
export const ZUSTAENDIG_PRAEFIX = '👤 ';

/**
 * The Outlook category that makes the person responsible: their name, and the start of their
 * login when another person of the mailbox has the same name.
 */
export function kategorieFuer(
  person: Pick<PostfachPerson, 'login' | 'name'>,
  personen: readonly PostfachPerson[] = []
): string {
  const gleichnamig = personen.some(
    (andere) =>
      andere.login.toLowerCase() !== person.login.toLowerCase() &&
      andere.name.trim().toLowerCase() === person.name.trim().toLowerCase()
  );
  const zusatz = gleichnamig ? ` (${person.login.split('@')[0]})` : '';
  return `${ZUSTAENDIG_PRAEFIX}${person.name.trim()}${zusatz}`;
}

/** The status and responsibility of a conversation, as the list and the reading view show it. */
export interface KonversationStand {
  status: PostfachStatus;
  /** ISO time it was marked done in Outlook; null unless done (or when Outlook does not tell). */
  erledigtAm: string | null;
  zustaendig: Zustaendigkeit | null;
}

/** A conversation in the list of a mailbox: its newest message in the inbox and its state. */
export interface KonversationZeile extends KonversationStand {
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
  hatAnhang: boolean;
  wichtig: boolean;
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
  /** It lies in the inbox, which the list counts; false when moved, e.g. archived. */
  imPosteingang: boolean;
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
  /** The inbox holds older messages than the list reads; they are in Outlook. */
  begrenzt: boolean;
  /** Login of the logged-in person, to recognise own assignments. */
  ich: string;
  /** A preview: it reads the real mailbox, but must not change it. */
  nurLesen: boolean;
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
  /** Conversations nobody has decided on yet. */
  neu: number;
  mirZugewiesen: number;
  /** The mailbox could not be read; the others still show. */
  fehler: boolean;
  /** Graph refuses the mailbox (missing permission): retrying does not help. */
  gesperrt: boolean;
}

/** `GET /api/intern/postfach`: the mailboxes the person sees and what is waiting for them. */
export interface PostfachStart {
  postfaecher: PostfachUebersicht[];
  /** Login of the logged-in person, to recognise own assignments. */
  ich: string;
  /** What waits for the person (`fuerMich`), newest first. */
  fuerMich: KonversationZeile[];
}

/** A received message as the list needs it, with its flag and categories from Outlook. */
export interface InboxNachricht {
  id: string;
  konversation: string;
  betreff: string;
  von: MailAdresse;
  am: string;
  vorschau: string;
  hatAnhang: boolean;
  wichtig: boolean;
  flag: OutlookFlag;
  /** ISO time the flag was completed, if Outlook tells. */
  erledigtAm: string | null;
  kategorien: string[];
  /** Version of the message in Exchange, for a change that must not overwrite a newer one. */
  etag?: string;
}

/** The newest first; the same time keeps the order of the input. */
function neuesteZuerst<T extends Pick<InboxNachricht, 'am'>>(nachrichten: readonly T[]): T[] {
  return [...nachrichten].sort((a, b) => b.am.localeCompare(a.am));
}

/**
 * The status of a conversation from the flags of its received messages: a flag anywhere means
 * „Handlungsbedarf“; otherwise the newest message decides, so a reply after „Erledigt“ is new
 * again.
 */
export function statusAus(
  nachrichten: readonly Pick<InboxNachricht, 'am' | 'flag' | 'erledigtAm'>[]
): Pick<KonversationStand, 'status' | 'erledigtAm'> {
  if (nachrichten.some((nachricht) => nachricht.flag === 'flagged'))
    return { status: 'handlungsbedarf', erledigtAm: null };
  const [neueste] = neuesteZuerst(nachrichten);
  if (neueste?.flag === 'complete') return { status: 'erledigt', erledigtAm: neueste.erledigtAm };
  return { status: 'neu', erledigtAm: null };
}

/** The responsible person named by a category, matched against the people of the mailbox. */
export function zustaendigAus(
  kategorien: readonly string[],
  personen: readonly PostfachPerson[]
): Zustaendigkeit | null {
  const kategorie = kategorien.find(
    (entry) => entry.startsWith(ZUSTAENDIG_PRAEFIX) && entry.length > ZUSTAENDIG_PRAEFIX.length
  );
  if (!kategorie) return null;
  const name = kategorie.slice(ZUSTAENDIG_PRAEFIX.length).trim();
  const gesucht = kategorie.trim().toLowerCase();
  // Only one person may fit; a name two people share without the login stays a plain name. With
  // the login it stays theirs, also after the other one with the name left the team
  const passend = personen.filter((entry) =>
    [kategorieFuer(entry, personen), kategorieFuer(entry, [{ login: '', name: entry.name }])]
      .map((form) => form.toLowerCase())
      .includes(gesucht)
  );
  if (passend.length !== 1) return { login: null, name };
  return {
    login: passend[0].login,
    name: kategorieFuer(passend[0], personen).slice(ZUSTAENDIG_PRAEFIX.length),
  };
}

/** Status and responsibility of a conversation; the newest message with a person names them. */
export function standAus(
  nachrichten: readonly Pick<InboxNachricht, 'am' | 'flag' | 'erledigtAm' | 'kategorien'>[],
  personen: readonly PostfachPerson[]
): KonversationStand {
  let zustaendig: Zustaendigkeit | null = null;
  for (const nachricht of neuesteZuerst(nachrichten)) {
    zustaendig = zustaendigAus(nachricht.kategorien, personen);
    if (zustaendig) break;
  }
  return { ...statusAus(nachrichten), zustaendig };
}

/**
 * Groups the messages of the inbox into conversations, newest first. Each conversation takes
 * subject, sender and preview of its newest message; its status and person also count
 * `weitere`, received messages of the same conversations in other folders (e.g. archived).
 */
export function konversationenAus(
  postfach: string,
  nachrichten: readonly InboxNachricht[],
  personen: readonly PostfachPerson[],
  weitere: readonly InboxNachricht[] = []
): KonversationZeile[] {
  const gruppen = new Map<string, InboxNachricht[]>();
  for (const nachricht of neuesteZuerst(nachrichten)) {
    const gruppe = gruppen.get(nachricht.konversation);
    if (gruppe) gruppe.push(nachricht);
    else gruppen.set(nachricht.konversation, [nachricht]);
  }
  return [...gruppen.values()].map((gruppe) => {
    const andere = weitere.filter((nachricht) => nachricht.konversation === gruppe[0].konversation);
    const [neueste] = gruppe;
    return {
      id: neueste.konversation,
      postfach,
      betreff: neueste.betreff,
      von: neueste.von,
      am: neueste.am,
      vorschau: neueste.vorschau,
      anzahl: gruppe.length,
      hatAnhang: gruppe.some((nachricht) => nachricht.hatAnhang),
      wichtig: gruppe.some((nachricht) => nachricht.wichtig),
      ...standAus([...gruppe, ...andere], personen),
    };
  });
}

/**
 * A time to the second. Exchange gives received times in whole seconds, and a time sent by the
 * page may carry milliseconds; compared to the second both agree.
 */
export function sekunde(iso: string): string {
  return iso.slice(0, 19);
}

/**
 * A status saved for the messages up to `bis`, applied to a view whose newest message is
 * `neueste`: a newer message has no flag yet, so a conversation saved as done is new again.
 */
export function standFuer(
  stand: Pick<KonversationStand, 'status' | 'erledigtAm'>,
  neueste: string,
  bis: string
): Pick<KonversationStand, 'status' | 'erledigtAm'> {
  return stand.status === 'erledigt' && sekunde(neueste) > sekunde(bis)
    ? { status: 'neu', erledigtAm: null }
    : stand;
}

/** The conversation is assigned to the login (compared without case). */
export function istMirZugewiesen(
  zeile: Pick<KonversationZeile, 'zustaendig'>,
  login: string
): boolean {
  return !!zeile.zustaendig?.login && zeile.zustaendig.login.toLowerCase() === login.toLowerCase();
}

/**
 * What the start page shows the person until someone decides: new conversations for everyone,
 * and those that need action for the responsible person, or for everyone while nobody is (also
 * when the named person is not known, e.g. left the team or the directory could not be read).
 */
export function fuerMich(zeilen: readonly KonversationZeile[], login: string): KonversationZeile[] {
  return zeilen.filter(
    (zeile) =>
      zeile.status === 'neu' ||
      (zeile.status === 'handlungsbedarf' &&
        (!zeile.zustaendig?.login || istMirZugewiesen(zeile, login)))
  );
}

/** Messages of a conversation the reading view reads and changes at most. */
export const KONVERSATION_MAX = 200;

/** Conversation IDs of Exchange are base64; anything else is refused before Graph is asked. */
export const KONVERSATION_ID = /^[A-Za-z0-9+/=_-]{8,256}$/;

/** Immutable message IDs of Exchange, also base64. */
export const NACHRICHT_ID = /^[A-Za-z0-9+/=_-]{8,256}$/;

/** Attachment IDs of Exchange, also base64. */
export const ANHANG_ID = /^[A-Za-z0-9+/=_-]{8,512}$/;
