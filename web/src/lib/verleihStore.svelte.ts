import { createResource } from './resource.svelte';
import type { VerleihUebersicht } from '../../../api/lib/verleih-model';
export const verleihResource = createResource<VerleihUebersicht>('/intern/pflege/verleih', {
  loadError:
    'Die Ausleihen konnten nicht geladen werden. Prüfe deine Verbindung und tippe auf „Erneut versuchen“.',
});
