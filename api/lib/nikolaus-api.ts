import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { NikolausBooking } from './nikolaus-bookings';
import { findBookingByToken, isBeforeChangeDeadline } from './nikolaus-bookings';
import type { NikolausSlotDefinition } from './nikolaus-config';
import { NIKOLAUS_CONFIG, findNikolausSlot, getChangeDeadline } from './nikolaus-config';
import { errorResponse } from './response-utils';

export type PublicBookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface PublicBookingInfo {
  status: PublicBookingStatus;
  familyName: string;
  email: string;
  phone: string;
  withKrampus: boolean;
  slot: {
    key: string;
    date: string;
    time: string;
    endTime: string;
  } | null;
  reservedUntil: string | null;
  /** Latest point in time for online changes and cancellations. */
  changeDeadline: string | null;
  changeDeadlineHours: number;
  /** Whether details, slot and cancellation can currently be changed online. */
  canChange: boolean;
}

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export function getPublicStatus(
  booking: NikolausBooking,
  now: Date = new Date()
): PublicBookingStatus {
  switch (booking.status) {
    case 'Bestaetigt':
      return 'confirmed';
    case 'Storniert':
      return 'cancelled';
    case 'Abgelaufen':
      return 'expired';
    default:
      return booking.reservedUntil && booking.reservedUntil.getTime() > now.getTime()
        ? 'pending'
        : 'expired';
  }
}

/** Whether the booking is active and still before the online change deadline. */
export function canChangeBooking(booking: NikolausBooking, now: Date = new Date()): boolean {
  const status = getPublicStatus(booking, now);
  return (
    (status === 'pending' || status === 'confirmed') &&
    findNikolausSlot(booking.slotKey) !== undefined &&
    isBeforeChangeDeadline(booking, now)
  );
}

export function toPublicBookingInfo(booking: NikolausBooking): PublicBookingInfo {
  const slot = findNikolausSlot(booking.slotKey);
  return {
    status: getPublicStatus(booking),
    familyName: booking.familyName,
    email: booking.email,
    phone: booking.phone,
    withKrampus: booking.withKrampus,
    slot: slot ? { key: slot.key, date: slot.date, time: slot.time, endTime: slot.endTime } : null,
    reservedUntil: booking.reservedUntil?.toISOString() ?? null,
    changeDeadline: slot ? getChangeDeadline(slot.key).toISOString() : null,
    changeDeadlineHours: NIKOLAUS_CONFIG.changeDeadlineHours,
    canChange: canChangeBooking(booking),
  };
}

export function bookingResponse(booking: NikolausBooking): HttpResponseInit {
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: toPublicBookingInfo(booking) };
}

export async function readJsonBody(request: HttpRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const DEADLINE_PASSED = errorResponse(
  403,
  'DEADLINE_PASSED',
  `Ihr Termin kann ab ${NIKOLAUS_CONFIG.changeDeadlineHours} Stunden vor Beginn nicht mehr online geändert oder abgesagt werden, da unsere Teams ihre Touren dann bereits planen. Bitte wenden Sie sich an kontakt@stamm-phoenix.de.`
);

const INVALID_LINK = errorResponse(
  404,
  'INVALID_LINK',
  'Dieser Link ist ungültig. Bitte prüfen Sie, ob Sie die vollständige Adresse aus der E-Mail verwendet haben.'
);

export interface AuthorizedBooking {
  booking: NikolausBooking;
  slot: NikolausSlotDefinition | undefined;
  token: string;
  body: Record<string, unknown>;
}

/**
 * Reads the JSON body and loads the booking belonging to its `token`.
 * Unknown and malformed tokens get the same answer, so bookings cannot be probed.
 */
export async function loadAuthorizedBooking(
  request: HttpRequest
): Promise<AuthorizedBooking | HttpResponseInit> {
  const body = await readJsonBody(request);
  const token = body?.token;
  if (!body || typeof token !== 'string' || token.length < 20 || token.length > 200) {
    return INVALID_LINK;
  }

  const booking = await findBookingByToken(token);
  if (!booking) {
    return INVALID_LINK;
  }

  return { booking, slot: findNikolausSlot(booking.slotKey), token, body };
}

export function isErrorResponse(
  value: AuthorizedBooking | HttpResponseInit
): value is HttpResponseInit {
  return !('booking' in value);
}
