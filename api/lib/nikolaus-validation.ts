/**
 * Validation rules for the booking details, shared between the API and the web frontend
 * (re-exported via `web/src/lib/nikolausConfig.ts`). Must stay free of imports.
 */

export interface NikolausBookingDetails {
  familyName: string;
  email: string;
  phone: string;
  withKrampus: boolean;
}

export type NikolausDetailsField = 'familyName' | 'email' | 'phone' | 'withKrampus';

export interface NikolausDetailsInput {
  familyName?: unknown;
  email?: unknown;
  phone?: unknown;
  withKrampus?: unknown;
}

export interface NikolausDetailsValidation {
  /** The trimmed details, or `null` if any field is invalid. */
  details: NikolausBookingDetails | null;
  errors: Partial<Record<NikolausDetailsField, string>>;
}

export const NIKOLAUS_MAX_LENGTH = { familyName: 100, email: 254, phone: 30 };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()/-]{5,30}$/;

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/** Validates the contact details of a booking; all fields are required. */
export function validateNikolausDetails(input: NikolausDetailsInput): NikolausDetailsValidation {
  const errors: Partial<Record<NikolausDetailsField, string>> = {};

  const familyName = readText(input.familyName, NIKOLAUS_MAX_LENGTH.familyName);
  if (!familyName) errors.familyName = 'Bitte geben Sie Ihren Familiennamen an.';

  const email = readText(input.email, NIKOLAUS_MAX_LENGTH.email);
  if (!email || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
  }

  const phone = readText(input.phone, NIKOLAUS_MAX_LENGTH.phone);
  if (!phone || !PHONE_PATTERN.test(phone)) {
    errors.phone = 'Bitte geben Sie eine gültige Telefonnummer an (z. B. 0171 1234567).';
  }

  if (typeof input.withKrampus !== 'boolean') {
    errors.withKrampus = 'Bitte geben Sie an, ob der Krampus mit reinkommen darf.';
  }

  if (Object.keys(errors).length > 0 || !familyName || !email || !phone) {
    return { details: null, errors };
  }

  return {
    details: { familyName, email, phone, withKrampus: input.withKrampus as boolean },
    errors,
  };
}
