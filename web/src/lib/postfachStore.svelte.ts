import { fetchApi, sendApi } from './api';
import { createResource } from './pflegeStore.svelte';
import type {
  KonversationDetail,
  KonversationStand,
  PostfachStatus,
  KonversationZeile,
  PostfachAnsicht,
  PostfachPerson,
  PostfachStart,
  Zustaendigkeit,
} from '../../../api/lib/postfach-model';
import { standFuer } from '../../../api/lib/postfach-model';

/** The mailboxes of the person and what is waiting for them, for the start page. */
export const postfachStart = createResource<PostfachStart>('/intern/postfach', {
  loadError:
    'Die E-Mails konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
});

/** The list of one mailbox; `param` is its ID. */
export const postfachListe = createResource<PostfachAnsicht, string>(
  (id) => `/intern/postfach/${encodeURIComponent(id)}`,
  {
    idle: true,
    loadError:
      'Die E-Mails konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
  }
);

export function ladeKonversation(
  postfach: string,
  konversation: string,
  signal?: AbortSignal
): Promise<KonversationDetail> {
  return fetchApi<KonversationDetail>(
    `/intern/postfach/${encodeURIComponent(postfach)}/konversation?id=${encodeURIComponent(konversation)}`,
    signal
  );
}

/** The mailbox whose page is open, and a count of its loads. */
let offenesPostfach: string | null = null;
let ladeRevision = 0;

/** Loads the list of the mailbox whose page opens; a later load always wins. */
export function ladePostfach(postfach: string): Promise<void> {
  offenesPostfach = postfach;
  ladeRevision++;
  return postfachListe.load({ param: postfach, force: true });
}

/**
 * Loads the list again after a conflict, but only while this mailbox is still the open one: the
 * answer of a page that was left must not take the list over from another mailbox.
 */
export function ladeNachKonflikt(postfach: string): Promise<void> {
  if (offenesPostfach !== postfach) return Promise.resolve();
  return ladePostfach(postfach);
}

/**
 * Reads the list of the mailbox again, bypassing the cache of the API. A late answer is
 * dropped when another mailbox was opened or loaded meanwhile.
 */
export async function neuLaden(postfach: string): Promise<void> {
  const revision = ++ladeRevision;
  personen.delete(postfach);
  const data = await fetchApi<PostfachAnsicht>(
    `/intern/postfach/${encodeURIComponent(postfach)}?frisch=1`
  );
  if (offenesPostfach === postfach && revision === ladeRevision) postfachListe.set(data);
}

/** Changes a line of the loaded list in place, e.g. after a mark or an assignment. */
export function aendereZeile(
  postfach: string,
  id: string,
  change: Partial<KonversationZeile>
): void {
  postfachStart.invalidate();
  const data = postfachListe.state.data;
  // A late answer of a page that was left must not touch the list of another mailbox
  if (!data || offenesPostfach !== postfach || data.postfach.id !== postfach) return;
  // A reload asked before this saved change must not bring the old line back
  ladeRevision++;
  postfachListe.set({
    ...data,
    konversationen: data.konversationen.map((zeile) =>
      zeile.id === id ? { ...zeile, ...change } : zeile
    ),
  });
}

/** As long as the API keeps its list; a change of a team shows after that at the latest. */
const PERSONEN_MS = 5 * 60_000;

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, never rendered
const personen = new Map<string, { promise: Promise<PostfachPerson[]>; bis: number }>();

/** Who can be made responsible; kept a few minutes, read again after „Neu laden“. */
export function ladePersonen(postfach: string): Promise<PostfachPerson[]> {
  const eintrag = personen.get(postfach);
  if (eintrag && eintrag.bis > Date.now()) return eintrag.promise;
  const promise = fetchApi<{ personen: PostfachPerson[] }>(
    `/intern/postfach/${encodeURIComponent(postfach)}/personen`
  ).then((data) => data.personen);
  personen.set(postfach, { promise, bis: Date.now() + PERSONEN_MS });
  promise.catch(() => personen.delete(postfach));
  return promise;
}

/** A refused assignment may name someone who left the team: the next choice reads the list anew. */
async function mitFrischenPersonen<T>(postfach: string, speichern: () => Promise<T>): Promise<T> {
  try {
    return await speichern();
  } catch (error: unknown) {
    personen.delete(postfach);
    throw error;
  }
}

/** The status of a conversation, as the API answers after a change. */
export interface StatusStand extends Pick<KonversationStand, 'status'> {
  /**
   * Another change of the same conversation was started after this one: the answer is not
   * taken over, the page reads what applies now instead.
   */
  ueberholt?: boolean;
}

export interface ZuweisungErgebnis extends StatusStand {
  zustaendig: Zustaendigkeit | null;
  benachrichtigt: boolean;
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- counters, never rendered
const aenderungen = new Map<string, number>();

/** Starts a change of a conversation; the returned check tells whether a later one started. */
function aenderungBeginnen(postfach: string, konversation: string): () => boolean {
  const schluessel = `${postfach}|${konversation}`;
  const nummer = (aenderungen.get(schluessel) ?? 0) + 1;
  aenderungen.set(schluessel, nummer);
  return () => aenderungen.get(schluessel) !== nummer;
}

export async function setzeZustaendig(
  postfach: string,
  konversation: string,
  login: string | null,
  /** Name of the person the page showed. */
  vorher: string | null
): Promise<ZuweisungErgebnis> {
  const ueberholt = aenderungBeginnen(postfach, konversation);
  const result = await mitFrischenPersonen(postfach, () =>
    sendApi<ZuweisungErgebnis>(
      'PUT',
      `/intern/postfach/${encodeURIComponent(postfach)}/zustaendig`,
      { konversation, login, vorher }
    )
  );
  if (ueberholt()) {
    void ladeNachKonflikt(postfach);
    return { ...result, ueberholt: true };
  }
  aendereZeile(postfach, konversation, {
    zustaendig: result.zustaendig,
    status: result.status,
  });
  return result;
}

/** Sets the status in Outlook: „Neu“ or „Handlungsbedarf“ in the inbox, or „Erledigt“ archived. */
export async function setzeStatus(
  postfach: string,
  konversation: string,
  status: PostfachStatus,
  vorher: PostfachStatus,
  /** Received time of the newest message the page shows; a newer one is not closed unseen. */
  bis: string
): Promise<StatusStand> {
  const ueberholt = aenderungBeginnen(postfach, konversation);
  const result = await sendApi<StatusStand>(
    'PUT',
    `/intern/postfach/${encodeURIComponent(postfach)}/status`,
    { konversation, status, vorher, bis }
  );
  if (ueberholt()) {
    void ladeNachKonflikt(postfach);
    return { ...result, ueberholt: true };
  }
  // A late answer: the list may have a newer message by now, which the change does not cover
  const zeile = postfachListe.state.data?.konversationen.find((entry) => entry.id === konversation);
  aendereZeile(postfach, konversation, standFuer(result, zeile?.am ?? bis, bis));
  return result;
}

/** The answer of `PUT …/zustaendig-mehrere`. */
export interface MehrfachAntwort {
  ergebnisse: MehrfachErgebnis[];
  /** Null when no note was due (nothing new for another person), false when it failed. */
  benachrichtigt: boolean | null;
}

/** What happened to one conversation of a choice (`PUT …/zustaendig-mehrere`). */
export interface MehrfachErgebnis {
  konversation: string;
  ok: boolean;
  /** Missing when the API does not know what applies now; the list is read again then. */
  zustaendig?: Zustaendigkeit | null;
  status?: PostfachStatus;
  fehler?: string;
}

/**
 * One person (null: nobody) for several conversations of the list; each line shows what applies
 * afterwards, also where someone else changed it meanwhile.
 */
export async function setzeZustaendigMehrere(
  postfach: string,
  login: string | null,
  zeilen: readonly KonversationZeile[]
): Promise<MehrfachAntwort> {
  const ergebnisse: MehrfachErgebnis[] = [];
  const benachrichtigt: (boolean | null)[] = [];
  // The API takes at most MEHRFACH_MAX at once; the list may show more (inbox and archive)
  for (let start = 0; start < zeilen.length; start += MEHRFACH_MAX) {
    const teil = zeilen.slice(start, start + MEHRFACH_MAX);
    const result = await mitFrischenPersonen(postfach, () =>
      sendApi<MehrfachAntwort>(
        'PUT',
        `/intern/postfach/${encodeURIComponent(postfach)}/zustaendig-mehrere`,
        {
          login,
          konversationen: teil.map((zeile) => ({
            konversation: zeile.id,
            vorher: zeile.zustaendig?.name ?? null,
          })),
        }
      )
    );
    for (const ergebnis of result.ergebnisse) {
      // Unknown after an unexpected error: the list is read again instead
      if (ergebnis.zustaendig === undefined) continue;
      aendereZeile(postfach, ergebnis.konversation, {
        zustaendig: ergebnis.zustaendig,
        ...(ergebnis.status && { status: ergebnis.status }),
      });
    }
    ergebnisse.push(...result.ergebnisse);
    benachrichtigt.push(result.benachrichtigt);
  }
  return { ergebnisse, benachrichtigt: zusammen(benachrichtigt) };
}

/** Conversations the API takes in one call (`MAX_AUSWAHL` of `api/lib/validation/postfach.ts`). */
export const MEHRFACH_MAX = 100;

/** One answer for all calls: a note that failed counts, otherwise one that was sent. */
function zusammen(werte: readonly (boolean | null)[]): boolean | null {
  if (werte.includes(false)) return false;
  return werte.includes(true) ? true : null;
}

export function anhangUrl(postfach: string, nachricht: string, anhang: string): string {
  return `/api/intern/postfach/${encodeURIComponent(postfach)}/anhang?nachricht=${encodeURIComponent(nachricht)}&anhang=${encodeURIComponent(anhang)}`;
}
