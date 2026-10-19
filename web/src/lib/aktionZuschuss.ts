// Whether the KJR grant is applied for a CampFlow Aktion, switched in the Aktion and in its
// Abrechnung, and whether an event is no real Aktion (`aktionArt.ts`), switched in the Aktion.
// Every loaded copy of the Aktion is updated, so lists and pages agree at once.
import { sendApi } from './api';
import { abrechnungStore } from './abrechnungStore.svelte';
import { campflowDetailStore, campflowEventsStore } from './campflowStore.svelte';
import type { CampflowEvent } from './types';

/** Saves whether the KJR grant is applied for the Aktion `eventId`; throws `ApiError`. */
export async function saveZuschussfaehig(eventId: string, zuschussfaehig: boolean): Promise<void> {
  await sendApi('PUT', `/intern/pflege/aktionen-zuschuss/${encodeURIComponent(eventId)}`, {
    zuschussfaehig,
  });
  for (const event of campflowEventsStore.data ?? []) {
    if (event.id === eventId) event.zuschussfaehig = zuschussfaehig;
  }
  const detail = campflowDetailStore.data[eventId];
  if (detail) detail.event.zuschussfaehig = zuschussfaehig;
  for (const abrechnung of Object.values(abrechnungStore.data)) {
    if (abrechnung.event.id === eventId) abrechnung.event.zuschussfaehig = zuschussfaehig;
  }
}

/** Saves whether the event `eventId` is no real Aktion; throws `ApiError`. */
export async function saveKeineAktion(eventId: string, keineAktion: boolean): Promise<void> {
  // Taking the mark back brings the KJR choice stored before, so both come from the answer
  const art = await sendApi<{ keineAktion: boolean; zuschussfaehig: boolean }>(
    'PUT',
    `/intern/pflege/aktionen-art/${encodeURIComponent(eventId)}`,
    { keineAktion }
  );
  const apply = (event: Pick<CampflowEvent, 'keineAktion' | 'zuschussfaehig'>): void => {
    event.keineAktion = art.keineAktion;
    event.zuschussfaehig = art.zuschussfaehig;
  };
  for (const event of campflowEventsStore.data ?? []) {
    if (event.id === eventId) apply(event);
  }
  const detail = campflowDetailStore.data[eventId];
  if (detail) apply(detail.event);
  for (const abrechnung of Object.values(abrechnungStore.data)) {
    if (abrechnung.event.id === eventId) apply(abrechnung.event);
  }
}
