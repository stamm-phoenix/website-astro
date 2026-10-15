// Whether the KJR grant is applied for a CampFlow Aktion, switched in the Aktion and in its
// Abrechnung. Every loaded copy of the Aktion is updated, so lists and pages agree at once.
import { sendApi } from './api';
import { abrechnungStore } from './abrechnungStore.svelte';
import { campflowDetailStore, campflowEventsStore } from './campflowStore.svelte';

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
