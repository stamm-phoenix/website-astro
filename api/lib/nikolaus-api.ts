import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { NikolausBooking } from './nikolaus-bookings';
import { getBooking, verifyToken } from './nikolaus-bookings';
import type { NikolausSlotDefinition } from './nikolaus-config';
import { findNikolausSlot } from './nikolaus-config';
import { errorResponse } from './response-utils';

export type PublicBookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface PublicBookingInfo {
  id: string;
  status: PublicBookingStatus;
  familyName: string;
  withKrampus: boolean;
  slot: {
    key: string;
    date: string;
    time: string;
    endTime: string;
  } | null;
  reservedUntil: string | null;
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

export function toPublicBookingInfo(booking: NikolausBooking): PublicBookingInfo {
  const slot = findNikolausSlot(booking.slotKey);
  return {
    id: booking.id,
    status: getPublicStatus(booking),
    familyName: booking.familyName,
    withKrampus: booking.withKrampus,
    slot: slot ? { key: slot.key, date: slot.date, time: slot.time, endTime: slot.endTime } : null,
    reservedUntil: booking.reservedUntil?.toISOString() ?? null,
  };
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

const INVALID_LINK = errorResponse(
  404,
  'INVALID_LINK',
  'Dieser Link ist ungültig. Bitte prüfen Sie, ob Sie die vollständige Adresse aus der E-Mail verwendet haben.'
);

export interface AuthorizedBooking {
  booking: NikolausBooking;
  slot: NikolausSlotDefinition | undefined;
  token: string;
}

/**
 * Loads the booking addressed by the route parameter `id` and checks the token.
 * Returns an error response for unknown IDs and wrong tokens alike, so the
 * existence of bookings cannot be probed.
 */
export async function loadAuthorizedBooking(
  request: HttpRequest,
  token: unknown
): Promise<AuthorizedBooking | HttpResponseInit> {
  const id = request.params.id;
  if (!id || !/^\d{1,10}$/.test(id) || typeof token !== 'string' || token.length > 200) {
    return INVALID_LINK;
  }

  const booking = await getBooking(id);
  if (!booking || !verifyToken(booking, token)) {
    return INVALID_LINK;
  }

  return { booking, slot: findNikolausSlot(booking.slotKey), token };
}

export function isErrorResponse(
  value: AuthorizedBooking | HttpResponseInit
): value is HttpResponseInit {
  return !('booking' in value);
}
