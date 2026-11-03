import { fetchApi, sendApi } from './api';
import { createResource } from './pflegeStore.svelte';
import type {
  Erledigung,
  KonversationDetail,
  PostfachStatus,
  KonversationZeile,
  PostfachAnsicht,
  PostfachPerson,
  PostfachStart,
  Zustaendigkeit,
} from '../../../api/lib/postfach-model';

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

export async function markiere(
  postfach: string,
  nachrichten: string[],
  gelesen: boolean
): Promise<void> {
  await sendApi('POST', `/intern/postfach/${encodeURIComponent(postfach)}/gelesen`, {
    nachrichten,
    gelesen,
  });
  postfachStart.invalidate();
}

export async function alleGelesen(postfach: string): Promise<void> {
  await sendApi('POST', `/intern/postfach/${encodeURIComponent(postfach)}/gelesen`, {
    alle: true,
  });
  const data = postfachListe.state.data;
  if (data?.postfach.id === postfach && offenesPostfach === postfach) {
    ladeRevision++;
    postfachListe.set({
      ...data,
      konversationen: data.konversationen.map((zeile) => ({ ...zeile, ungelesen: 0 })),
    });
  }
  postfachStart.invalidate();
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, never rendered
const personen = new Map<string, Promise<PostfachPerson[]>>();

/** Who can be made responsible; loaded once per page. */
export function ladePersonen(postfach: string): Promise<PostfachPerson[]> {
  let promise = personen.get(postfach);
  if (!promise) {
    promise = fetchApi<{ personen: PostfachPerson[] }>(
      `/intern/postfach/${encodeURIComponent(postfach)}/personen`
    ).then((data) => data.personen);
    personen.set(postfach, promise);
    promise.catch(() => personen.delete(postfach));
  }
  return promise;
}

export interface ZuweisungErgebnis {
  zustaendig: Zustaendigkeit | null;
  benachrichtigt: boolean;
}

export async function setzeZustaendig(
  postfach: string,
  konversation: string,
  login: string | null,
  vorher: string | null
): Promise<ZuweisungErgebnis> {
  const result = await sendApi<ZuweisungErgebnis>(
    'PUT',
    `/intern/postfach/${encodeURIComponent(postfach)}/zustaendig`,
    { konversation, login, vorher }
  );
  aendereZeile(postfach, konversation, { zustaendig: result.zustaendig });
  return result;
}

/** Marks the conversation as done, as needing nothing or as open again. */
export async function setzeStatus(
  postfach: string,
  konversation: string,
  status: PostfachStatus,
  vorher: PostfachStatus,
  /** Received time of the newest message the page shows; newer ones stay open. */
  bis: string
): Promise<Erledigung | null> {
  const result = await sendApi<{ erledigung: Erledigung | null }>(
    'PUT',
    `/intern/postfach/${encodeURIComponent(postfach)}/status`,
    { konversation, status, vorher, bis }
  );
  aendereZeile(postfach, konversation, { erledigung: result.erledigung, wiederOffen: false });
  return result.erledigung;
}

export function anhangUrl(postfach: string, nachricht: string, anhang: string): string {
  return `/api/intern/postfach/${encodeURIComponent(postfach)}/anhang?nachricht=${encodeURIComponent(nachricht)}&anhang=${encodeURIComponent(anhang)}`;
}
