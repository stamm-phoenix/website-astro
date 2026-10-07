// The Nikolaus configuration helpers and validation rules are shared with the API, which
// validates bookings against them. The values come from the Steuerung (`/api/nikolaus/settings`).
export {
  NIKOLAUS_SLOT_MINUTES,
  NIKOLAUS_TEAMS,
  dateToLocalParts,
  distanceKm,
  formatNikolausDate,
  formatNikolausDays,
  getNikolausSlots,
  getNikolausTeams,
  isOutsideServicePostalCodes,
  toNikolausConfig,
} from '../../../api/lib/nikolaus-config';
export type {
  NikolausAreaConfig,
  NikolausConfig,
  NikolausCoordinates,
  NikolausDayConfig,
  NikolausSettings,
  NikolausSlotDefinition,
  NikolausTeam,
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
