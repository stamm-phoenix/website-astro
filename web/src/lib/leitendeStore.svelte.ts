import type { Leitende } from './types/oeffentlich';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

const leitende = createResource<Leitende[]>('/leitende');

export const leitendeStore = loadStateOf(leitende.state);

/** Asks again on every call, unless a request is already running, which is joined. */
export function fetchLeitende(): Promise<void> {
  return leitende.load({ maxAge: 0 });
}

export function getLeadersForGroup(groupKey: string): string[] {
  if (!leitendeStore.data) return [];
  return leitendeStore.data
    .filter((member) => member.teams.includes(groupKey))
    .map((member) => member.name);
}
