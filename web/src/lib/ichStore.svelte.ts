import { fetchApi } from './api';
import { authStore, fetchPrincipal, isOwnName } from './authStore.svelte';
import { istVerknuepftePerson } from './personen';
import type { PersonMerkmale } from './personen';
import type { CampflowPerson, Ich } from './types';

/**
 * The logged-in person and their CampFlow person from the module „Personen“
 * (`docs/personen.md`), to mark own entries with „(ich)“. Loaded once per page, on the first
 * question; until then, and without a link, the name from the Microsoft account decides.
 */
export const ichStore = $state<{ ich: Ich | null }>({ ich: null });

let started = false;
/** Counts the loads, so an older answer never replaces a newer one. */
let generation = 0;

/** Starts loading; asked from templates, so it changes state only after an `await`. */
function ensureLoaded(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const current = ++generation;
  void (async () => {
    await Promise.resolve();
    void fetchPrincipal();
    try {
      const ich = await fetchApi<Ich>('/intern/ich');
      if (current === generation) ichStore.ich = ich;
    } catch {
      /* Without the link the names from the Microsoft account still mark own entries. */
    }
  })();
}

/** Loads the link again, e.g. after it was saved in the module „Personen“. */
export function reloadIch(): void {
  started = false;
  ensureLoaded();
}

// Pages change without a full load (Astro's ClientRouter), so each new page asks once again
if (typeof document !== 'undefined') {
  document.addEventListener('astro:after-swap', () => {
    started = false;
  });
}

/**
 * Whether a person is the logged-in one: the linked CampFlow person itself, a registration with
 * its primary address (CampFlow keeps registrations to events as persons of their own), or the
 * same name as in CampFlow or the Microsoft account. A namesake in the member list never is.
 */
export function isIch(person: PersonMerkmale): boolean {
  ensureLoaded();
  const linked = istVerknuepftePerson(ichStore.ich?.campflow ?? null, person);
  if (linked !== undefined) return linked;
  return !!person.name && isOwnName(authStore.principal, person.name);
}

/**
 * `isIch` for a person as CampFlow sends it, e.g. a registration to an event. `eigene` are the IDs
 * the server matched by the primary address of the linked person (`ich` of the Aktion); `null`
 * or missing when it could not compare, then the names decide.
 */
export function isIchCampflow(
  person: CampflowPerson,
  eigene: readonly string[] | null = null
): boolean {
  const name = person.name as { first_name?: unknown; last_name?: unknown } | null | undefined;
  const parts = [name?.first_name, name?.last_name].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  return isIch({
    id: person.id,
    name: parts.join(' '),
    ich: eigene ? eigene.includes(person.id) : undefined,
  });
}
