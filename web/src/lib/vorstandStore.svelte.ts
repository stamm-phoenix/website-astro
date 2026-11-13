import type { Vorstand } from './types';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

const vorstand = createResource<Vorstand[]>('/vorstand');

export const vorstandStore = loadStateOf(vorstand.state);

/** Asks again on every call, unless a request is already running, which is joined. */
export function fetchVorstand(): Promise<void> {
  return vorstand.load({ maxAge: 0 });
}
