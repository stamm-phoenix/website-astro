/**
 * Validation rules for the booking details, shared between the API and the web frontend
 * (re-exported via `web/src/lib/nikolausConfig.ts`). Must stay free of imports.
 */

export interface NikolausBookingDetails {
  familyName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  /** Optional directions, e.g. door or doorbell; empty string if not given. */
  addressNotes: string;
  childrenCount: number;
  withKrampus: boolean;
  /** Where presents, notes for the Golden Book and donation are left outside. */
  hidingPlace: string;
  /** Optional remarks; empty string if not given. */
  notes: string;
}

export type NikolausDetailsField = keyof NikolausBookingDetails;

export type NikolausDetailsInput = Partial<Record<NikolausDetailsField, unknown>>;

export interface NikolausDetailsValidation {
  /** The trimmed details, or `null` if any field is invalid. */
  details: NikolausBookingDetails | null;
  errors: Partial<Record<NikolausDetailsField, string>>;
}

export const NIKOLAUS_MAX_LENGTH = {
  familyName: 100,
  email: 254,
  phone: 30,
  street: 100,
  city: 60,
  addressNotes: 500,
  hidingPlace: 500,
  notes: 1000,
};

export const NIKOLAUS_CHILDREN_RANGE = { min: 1, max: 20 };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()/-]{5,30}$/;
const POSTAL_CODE_PATTERN = /^\d{5}$/;

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/** Reads an optional text; `''` if empty, `null` if too long or not a string. */
function readOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

function readChildrenCount(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return Number.isInteger(number) &&
    number >= NIKOLAUS_CHILDREN_RANGE.min &&
    number <= NIKOLAUS_CHILDREN_RANGE.max
    ? number
    : null;
}

/** Whether the value is a plausible e-mail address within the length limit. */
export function isValidNikolausEmail(value: unknown): value is string {
  const email = readText(value, NIKOLAUS_MAX_LENGTH.email);
  return email !== null && EMAIL_PATTERN.test(email);
}

/** Whether the value is a German postal code (five digits). */
export function isValidNikolausPostalCode(value: unknown): value is string {
  return typeof value === 'string' && POSTAL_CODE_PATTERN.test(value.trim());
}

/** Validates the details of a booking; all fields except the notes are required. */
export function validateNikolausDetails(input: NikolausDetailsInput): NikolausDetailsValidation {
  const errors: Partial<Record<NikolausDetailsField, string>> = {};
  const max = NIKOLAUS_MAX_LENGTH;

  const familyName = readText(input.familyName, max.familyName);
  if (!familyName) errors.familyName = 'Bitte geben Sie Ihren Familiennamen an.';

  const email = readText(input.email, max.email);
  if (!email || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
  }

  const phone = readText(input.phone, max.phone);
  if (!phone || !PHONE_PATTERN.test(phone)) {
    errors.phone = 'Bitte geben Sie eine gültige Telefonnummer an (z. B. 0171 1234567).';
  }

  const street = readText(input.street, max.street);
  if (!street) errors.street = 'Bitte geben Sie Straße und Hausnummer an.';

  const postalCode = readText(input.postalCode, 5);
  if (!postalCode || !POSTAL_CODE_PATTERN.test(postalCode)) {
    errors.postalCode = 'Bitte geben Sie eine gültige PLZ mit 5 Ziffern an.';
  }

  const city = readText(input.city, max.city);
  if (!city) errors.city = 'Bitte geben Sie Ihren Ort an.';

  const addressNotes = readOptionalText(input.addressNotes, max.addressNotes);
  if (addressNotes === null) {
    errors.addressNotes = `Die Hinweise zur Adresse dürfen höchstens ${max.addressNotes} Zeichen lang sein.`;
  }

  const childrenCount = readChildrenCount(input.childrenCount);
  if (childrenCount === null) {
    errors.childrenCount = `Bitte geben Sie die Anzahl der Kinder an (${NIKOLAUS_CHILDREN_RANGE.min} bis ${NIKOLAUS_CHILDREN_RANGE.max}).`;
  }

  if (typeof input.withKrampus !== 'boolean') {
    errors.withKrampus = 'Bitte geben Sie an, ob der Krampus mit reinkommen darf.';
  }

  const hidingPlace = readText(input.hidingPlace, max.hidingPlace);
  if (!hidingPlace) {
    errors.hidingPlace = 'Bitte beschreiben Sie, wo Sie Geschenke, Zettel und Spende bereitlegen.';
  }

  const notes = readOptionalText(input.notes, max.notes);
  if (notes === null) {
    errors.notes = `Die Bemerkungen dürfen höchstens ${max.notes} Zeichen lang sein.`;
  }

  if (
    Object.keys(errors).length > 0 ||
    !familyName ||
    !email ||
    !phone ||
    !street ||
    !postalCode ||
    !city ||
    addressNotes === null ||
    childrenCount === null ||
    !hidingPlace ||
    notes === null
  ) {
    return { details: null, errors };
  }

  return {
    details: {
      familyName,
      email,
      phone,
      street,
      postalCode,
      city,
      addressNotes,
      childrenCount,
      withKrampus: input.withKrampus as boolean,
      hidingPlace,
      notes,
    },
    errors,
  };
}
