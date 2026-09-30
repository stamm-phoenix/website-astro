import { validateNikolausDetails } from './nikolausConfig';
import type { NikolausDetailsValidation } from './nikolausConfig';
import type { NikolausBookingInfo, NikolausDetailsForm } from './types';

export function emptyDetailsForm(): NikolausDetailsForm {
  return {
    familyName: '',
    email: '',
    phone: '',
    street: '',
    postalCode: '',
    city: '',
    addressNotes: '',
    childrenCount: null,
    withKrampus: null,
    hidingPlace: '',
    notes: '',
  };
}

export function detailsFormFromBooking(booking: NikolausBookingInfo): NikolausDetailsForm {
  return {
    familyName: booking.familyName,
    email: booking.email,
    phone: booking.phone,
    street: booking.street,
    postalCode: booking.postalCode,
    city: booking.city,
    addressNotes: booking.addressNotes,
    childrenCount: booking.childrenCount,
    withKrampus: booking.withKrampus ? 'ja' : 'nein',
    hidingPlace: booking.hidingPlace,
    notes: booking.notes,
  };
}

/** Validates the form with the rules shared with the API. */
export function validateDetailsForm(form: NikolausDetailsForm): NikolausDetailsValidation {
  return validateNikolausDetails({
    ...form,
    withKrampus: form.withKrampus === null ? undefined : form.withKrampus === 'ja',
  });
}
