import type { Gruppenstunde } from './types/oeffentlich';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';
import { STUFE_ORDER } from './types/stufen';

/** In the order of the Stufen; also applied to the data baked at build time. */
export function sortGruppenstunden(data: Gruppenstunde[]): Gruppenstunde[] {
  return [...data].sort((a, b) => (STUFE_ORDER[a.stufe] ?? 99) - (STUFE_ORDER[b.stufe] ?? 99));
}

const gruppenstunden = createResource<Gruppenstunde[]>('/gruppenstunden', {
  transform: sortGruppenstunden,
});

export const gruppenstundenStore = loadStateOf(gruppenstunden.state);

/** Asks again on every call, unless a request is already running, which is joined. */
export function fetchGruppenstunden(): Promise<void> {
  return gruppenstunden.load({ maxAge: 0 });
}
