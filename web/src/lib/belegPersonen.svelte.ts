import { fetchApi } from './api';
import type { ProtokollEditorPersonen } from './types';

/**
 * The names to suggest for an Auslage of someone else: the leaders and the active people of the
 * module „Personen“, as the minutes offer them. Loaded once per page; without them names are typed.
 */
export const belegPersonen = $state<{ names: string[]; loading: boolean }>({
  names: [],
  loading: false,
});

let loading: Promise<void> | null = null;

export function fetchBelegPersonen(): Promise<void> {
  loading ??= (async () => {
    belegPersonen.loading = true;
    try {
      const result = await fetchApi<ProtokollEditorPersonen>('/intern/protokoll-editor-personen');
      const names = result.personen.map((person) => person.name);
      belegPersonen.names = names.filter((name, index) => names.indexOf(name) === index);
    } catch {
      // Only suggestions: ask again next time
      loading = null;
    } finally {
      belegPersonen.loading = false;
    }
  })();
  return loading;
}
