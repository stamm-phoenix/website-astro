// The Nikolaus configuration is shared with the API, which validates bookings against it.
// Edit it in api/lib/nikolaus-config.ts.
export {
  NIKOLAUS_CONFIG,
  NIKOLAUS_SLOT_MINUTES,
  formatNikolausDate,
  getNikolausSlots,
} from '../../../api/lib/nikolaus-config';
export type {
  NikolausConfig,
  NikolausDayConfig,
  NikolausSlotDefinition,
} from '../../../api/lib/nikolaus-config';
