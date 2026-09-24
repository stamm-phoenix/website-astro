// The Nikolaus configuration and validation rules are shared with the API, which
// validates bookings against them. Edit them in api/lib/nikolaus-*.ts.
export {
  NIKOLAUS_CONFIG,
  NIKOLAUS_SLOT_MINUTES,
  distanceKm,
  formatNikolausDate,
  getNikolausSlots,
  isOutsideServicePostalCodes,
} from '../../../api/lib/nikolaus-config';
export type {
  NikolausConfig,
  NikolausCoordinates,
  NikolausDayConfig,
  NikolausSlotDefinition,
} from '../../../api/lib/nikolaus-config';
export {
  NIKOLAUS_CHILDREN_RANGE,
  NIKOLAUS_MAX_LENGTH,
  isValidNikolausEmail,
  isValidNikolausPostalCode,
  validateNikolausDetails,
} from '../../../api/lib/nikolaus-validation';
export type {
  NikolausBookingDetails,
  NikolausDetailsField,
  NikolausDetailsValidation,
} from '../../../api/lib/nikolaus-validation';
