import type { NikolausSlot } from './types';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

const slots = createResource<NikolausSlot[]>('/nikolaus/slots');

/** A reload keeps showing the last known slots, also when it fails. */
export const nikolausStore = loadStateOf(slots.state, { background: true });

/**
 * Loads the slot availability. Pass `force` to reload after a booking attempt,
 * so the displayed capacity reflects bookings made in the meantime.
 */
export function fetchNikolausSlots(force = false): Promise<void> {
  return slots.load({ force });
}
