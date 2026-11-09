import { aenderungen, nachAenderung } from './postfach-aenderung';
import { readKonversationStand } from './postfach-graph';
import type { PostfachEintrag } from './postfach-liste';
import {
  kategorieFuer,
  konversationenAus,
  sekunde,
  type InboxNachricht,
  type KonversationZeile,
  type PostfachStatus,
  type Zustaendigkeit,
} from './postfach-model';
import { inboxVergessen, personenFuerKategorien } from './postfach';
import { kategorieAnlegen, schreibeAenderungen } from './postfach-schreiben';

/**
 * Changes of the status and the responsible person of a conversation, written into Outlook
 * (`docs/postfaecher.md`). Each change reads the conversation fresh and compares it with what the
 * page showed, so a change made meanwhile (also in Outlook) is not overwritten unseen.
 */

/** Someone else changed the responsibility since the page loaded it. */
export class ZustaendigkeitKonfliktError extends Error {
  constructor(public readonly aktuell: Zustaendigkeit | null) {
    super('The responsibility changed meanwhile.');
    this.name = 'ZustaendigkeitKonfliktError';
  }
}

/** Someone else changed the status since the page loaded it. */
export class StatusKonfliktError extends Error {
  constructor(public readonly aktuell: KonversationZeile) {
    super('The status changed meanwhile.');
    this.name = 'StatusKonfliktError';
  }
}

/** A newer message arrived than the page showed; marking the conversation would close it unseen. */
export class NeueNachrichtError extends Error {
  constructor() {
    super('A newer message arrived than the page showed.');
    this.name = 'NeueNachrichtError';
  }
}

/**
 * The conversation has more messages than a change reads: changing only part of them would
 * report a status the whole conversation does not have.
 */
export class KonversationZuLangError extends Error {
  constructor() {
    super('The conversation is longer than a change reads.');
    this.name = 'KonversationZuLangError';
  }
}

/**
 * Changes of one conversation in this Function instance, one after the other: two at once would
 * both pass the check against the same state and overwrite each other. Graph offers no
 * conditional change of a message, so a change in Outlook in the moment between reading and
 * writing can still be overwritten.
 */
const laufend = new Map<string, Promise<unknown>>();

async function nacheinander<T>(schluessel: string, arbeit: () => Promise<T>): Promise<T> {
  const vorher = laufend.get(schluessel) ?? Promise.resolve();
  const jetzt = vorher.catch(() => undefined).then(arbeit);
  laufend.set(schluessel, jetzt);
  try {
    return await jetzt;
  } finally {
    if (laufend.get(schluessel) === jetzt) laufend.delete(schluessel);
  }
}

export interface Person {
  login: string;
  name: string;
}

interface Frisch {
  zeile: KonversationZeile;
  nachrichten: InboxNachricht[];
}

/** The received messages of the conversation in every folder, and its line; null when none. */
export async function ladeFrisch(
  postfach: PostfachEintrag,
  konversation: string
): Promise<Frisch | null> {
  const [{ nachrichten, vollstaendig }, personen] = await Promise.all([
    readKonversationStand(postfach.address, konversation),
    personenFuerKategorien(postfach),
  ]);
  if (!nachrichten.length) return null;
  if (!vollstaendig) throw new KonversationZuLangError();
  return { zeile: konversationenAus(postfach.id, nachrichten, personen)[0], nachrichten };
}

async function schreiben(
  postfach: PostfachEintrag,
  { zeile, nachrichten }: Frisch,
  ziel: Parameters<typeof aenderungen>[1],
  personen: readonly Person[] = []
): Promise<KonversationZeile> {
  const geaendert = aenderungen(nachrichten, ziel);
  if (!geaendert.length) return zeile;
  try {
    await schreibeAenderungen(postfach.address, geaendert);
  } finally {
    // Also after a failure: part of it may be written, the list must not show the old state
    inboxVergessen(postfach.address);
  }
  const danach = nachAenderung(nachrichten, geaendert);
  return { ...zeile, ...konversationenAus(postfach.id, danach, personen)[0], id: zeile.id };
}

/**
 * Sets the status of the conversation. `vorher` is the status the page showed and `gesehen` the
 * received time of the newest message it showed. If someone changed the status meanwhile,
 * nothing is written and `StatusKonfliktError` names what applies now; if a newer message arrived
 * and the conversation would leave „Neu“ with it unseen, `NeueNachrichtError`. Null: the
 * conversation is no longer in the mailbox.
 */
export async function setzeStatus(
  postfach: PostfachEintrag,
  konversation: string,
  status: PostfachStatus,
  vorher: PostfachStatus,
  gesehen: string
): Promise<KonversationZeile | null> {
  return nacheinander(`${postfach.address}|${konversation}`, async () => {
    const frisch = await ladeFrisch(postfach, konversation);
    if (!frisch) return null;
    if (frisch.zeile.status !== vorher) throw new StatusKonfliktError(frisch.zeile);
    // Already so (e.g. from a choice of several): when it was done stays as it is
    if (status === vorher) return frisch.zeile;
    if (status !== 'neu' && sekunde(frisch.zeile.am) > sekunde(gesehen))
      throw new NeueNachrichtError();
    const personen = await personenFuerKategorien(postfach);
    return schreiben(postfach, frisch, { status }, personen);
  });
}

function gleicherName(a: string | null, b: string | null): boolean {
  return (a?.trim().toLowerCase() ?? null) === (b?.trim().toLowerCase() ?? null);
}

/**
 * Makes `neu` responsible for the conversation, or nobody with `null`. `vorher` is the name the
 * page showed (null: nobody); if someone changed it meanwhile, nothing is written and
 * `ZustaendigkeitKonfliktError` names the current person. A new conversation that gets a person
 * needs action: it gets the flag too. Null: the conversation is no longer in the mailbox.
 */
export async function setzeZustaendig(
  postfach: PostfachEintrag,
  konversation: string,
  neu: Person | null,
  vorher: string | null
): Promise<{ zeile: KonversationZeile; vorher: Zustaendigkeit | null } | null> {
  return nacheinander(`${postfach.address}|${konversation}`, async () => {
    const frisch = await ladeFrisch(postfach, konversation);
    if (!frisch) return null;
    const aktuell = frisch.zeile.zustaendig;
    if (!gleicherName(aktuell?.name ?? null, vorher))
      throw new ZustaendigkeitKonfliktError(aktuell);
    const kategorie = neu ? kategorieFuer(neu.name) : null;
    // Only a colour in Outlook; the category works without it
    if (kategorie) await kategorieAnlegen(postfach.address, kategorie);
    const personen = await personenFuerKategorien(postfach);
    const zeile = await schreiben(
      postfach,
      frisch,
      { kategorie, status: neu && frisch.zeile.status === 'neu' ? 'handlungsbedarf' : undefined },
      neu ? [...personen.filter((person) => person.login !== neu.login), neu] : personen
    );
    return { zeile, vorher: aktuell };
  });
}
