import { fetchApi } from './api';
import { authStore, fetchPrincipal, isOwnName } from './authStore.svelte';
import { sameName } from './personen';
import type { CampflowPerson, Ich } from './types';

/**
 * The logged-in person and their CampFlow person from the module „Personen“
 * (`docs/personen.md`), to mark own entries with „(ich)“. Loaded once per page, on the first
 * question; until then, and without a link, the name from the Microsoft account decides.
 */
export const ichStore = $state<{ ich: Ich | null }>({ ich: null });

let started = false;

/** Starts loading; asked from templates, so it changes state only after an `await`. */
function ensureLoaded(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void (async () => {
    await Promise.resolve();
    void fetchPrincipal();
    try {
      ichStore.ich = await fetchApi<Ich>('/intern/ich');
    } catch {
      /* Without the link the names from the Microsoft account still mark own entries. */
    }
  })();
}

/** What a list knows about a person; any of it may be missing. */
export interface PersonMerkmale {
  /** CampFlow ID; only persons of the member list have the linked one. */
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

/**
 * Whether a person is the logged-in one: the linked CampFlow person itself, a registration with
 * its primary address (CampFlow keeps registrations to events as persons of their own), or the
 * same name as in CampFlow or the Microsoft account.
 */
export function isIch(person: PersonMerkmale): boolean {
  ensureLoaded();
  const campflow = ichStore.ich?.campflow;
  if (campflow) {
    if (person.id && person.id === campflow.id) return true;
    const email = person.email?.trim().toLowerCase();
    if (campflow.email && email === campflow.email) return true;
    const name = `${campflow.firstName} ${campflow.lastName}`;
    if (person.name && sameName(name, person.name)) return true;
  }
  return !!person.name && isOwnName(authStore.principal, person.name);
}

/** `isIch` for a person as CampFlow sends it, e.g. a registration to an event. */
export function isIchCampflow(person: CampflowPerson): boolean {
  const name = person.name as { first_name?: unknown; last_name?: unknown } | null | undefined;
  const parts = [name?.first_name, name?.last_name].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  return isIch({
    id: person.id,
    name: parts.join(' '),
    email: typeof person.primary_email === 'string' ? person.primary_email : null,
  });
}
