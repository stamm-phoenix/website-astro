// The Nikolaus configuration and validation rules are shared with the API, which
// validates bookings against them. Edit them in api/lib/nikolaus-*.ts.
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
export {
  NIKOLAUS_MAX_LENGTH,
  isValidNikolausEmail,
  validateNikolausDetails,
} from '../../../api/lib/nikolaus-validation';
export type {
  NikolausBookingDetails,
  NikolausDetailsField,
} from '../../../api/lib/nikolaus-validation';
