import type { Aktion } from './types';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

/** Earliest first; also applied to the data baked at build time. */
export function sortAktionen(data: Aktion[]): Aktion[] {
  return [...data].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

const aktionen = createResource<Aktion[]>('/aktionen', { transform: sortAktionen });

export const aktionenStore = loadStateOf(aktionen.state);

/** Asks again on every call, unless a request is already running, which is joined. */
export function fetchAktionen(): Promise<void> {
  return aktionen.load({ maxAge: 0 });
}
