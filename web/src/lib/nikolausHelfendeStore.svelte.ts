import { createResource } from './pflegeStore.svelte';
import type {
  StaffNikolausEinteilungData,
  StaffNikolausHelfendeData,
  StaffNikolausStufenData,
} from './types';

const helfende = createResource<StaffNikolausHelfendeData>('/intern/nikolaus/helfende');
const einteilung = createResource<StaffNikolausEinteilungData>('/intern/nikolaus/einteilung');
const stufen = createResource<StaffNikolausStufenData>('/intern/nikolaus/stufen-abgleich', {
  idle: true,
});

export const helfendeStore = helfende.state;
export const einteilungStore = einteilung.state;
/** Only loaded when the Stufen-Abgleich is started. */
export const stufenStore = stufen.state;

/** Loads all helpers with the tags in use and the configured days. */
export function fetchHelfende(): Promise<void> {
  return helfende.load({ force: true });
}

/** Loads helpers, days with the family tags per team and the saved Einteilung. */
export function fetchEinteilung(): Promise<void> {
  return einteilung.load({ force: true });
}

/** Compares bookings with the CampFlow member list and helpers with the Leitende list. */
export function fetchStufen(): Promise<void> {
  return stufen.load({ force: true });
}
