import { createResource } from './pflegeStore.svelte';
import type { InventarArtikel } from './inventur';

/** The articles of the Inventur with their variants (`/intern/pflege/inventur`). */
export const inventurPflege = createResource<InventarArtikel[]>('/intern/pflege/inventur', {
  loadError:
    'Das Material konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
});
