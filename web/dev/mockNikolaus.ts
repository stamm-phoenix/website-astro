/** Nikolausdienst: public booking pages. */
import {
  bookingForToken,
  bookingInfo,
  createBooking,
  geocode,
  publicSlots,
  slotExists,
  visitProgress,
  MOCK_NIKOLAUS_SETTINGS,
} from './mock-data/nikolaus';
import { toNikolausConfig } from '../src/lib/nikolausConfig';
import { MOCK_NOW, newEtag } from './mock-data/util';
import { error, json, route, str } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';
import { CAPTCHA_FAILED } from './mockKontakt';

// ---------------------------------------------------------------------------------------------
// Nikolaus (public)

route('GET', '/api/nikolaus/settings', () => json(toNikolausConfig(MOCK_NIKOLAUS_SETTINGS)));

route('GET', '/api/nikolaus/slots', () => json(publicSlots()));

route('POST', '/api/nikolaus/bookings', (req) => {
  const body = req.json ?? {};
  if (str(body.website)) return json({ status: 'pending' }, 201);
  if (typeof body.altcha !== 'string') return CAPTCHA_FAILED();
  if (!slotExists(str(body.slot)))
    return error(400, 'INVALID_SLOT', 'Dieser Termin existiert nicht.');
  const booking = createBooking(body);
  return json({ status: 'pending', reservedUntil: booking.reservedUntil }, 201);
});

route('POST', '/api/nikolaus/geocode', (req) => {
  const body = req.json ?? {};
  const location = geocode(str(body.street), str(body.postalCode), str(body.city));
  if (!location) return json({ found: false });
  return json({
    found: true,
    precision: location.approximate ? 'area' : 'address',
    lat: location.lat,
    lon: location.lon,
  });
});

function manageBooking(req: MockRequest): ReturnType<typeof bookingForToken> {
  return bookingForToken(str(req.json?.token));
}

const INVALID_TOKEN = (): MockResult =>
  error(404, 'INVALID_TOKEN', 'Dieser Link ist ungültig oder abgelaufen.');

route('POST', '/api/nikolaus/manage/lookup', (req) => {
  const booking = manageBooking(req);
  return booking ? json(bookingInfo(booking)) : INVALID_TOKEN();
});

route('POST', '/api/nikolaus/manage/progress', (req) => {
  const booking = manageBooking(req);
  return booking ? json(visitProgress(str(req.json?.token), booking)) : INVALID_TOKEN();
});

route('POST', '/api/nikolaus/manage/confirm', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  if (booking.status === 'cancelled')
    return error(410, 'CANCELLED', 'Dieser Termin wurde abgesagt.');
  if (booking.status === 'expired')
    return error(410, 'EXPIRED', 'Die Reservierung ist abgelaufen. Bitte buchen Sie erneut.');
  booking.status = 'confirmed';
  booking.reservedUntil = null;
  booking.confirmedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

route('POST', '/api/nikolaus/manage/cancel', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  booking.status = 'cancelled';
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

const DETAIL_KEYS = [
  'familyName',
  'email',
  'phone',
  'street',
  'postalCode',
  'city',
  'addressNotes',
  'hidingPlace',
  'notes',
] as const;

route('POST', '/api/nikolaus/manage/update', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  const body = req.json ?? {};
  const address = `${booking.street}|${booking.postalCode}|${booking.city}`;
  for (const key of DETAIL_KEYS)
    if (typeof body[key] === 'string') booking[key] = str(body[key]).trim();
  if (typeof body.childrenCount === 'number') booking.childrenCount = body.childrenCount;
  if (typeof body.withKrampus === 'boolean') booking.withKrampus = body.withKrampus;
  if (address !== `${booking.street}|${booking.postalCode}|${booking.city}`)
    booking.location = geocode(booking.street, booking.postalCode, booking.city);
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

route('POST', '/api/nikolaus/manage/reschedule', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  const slot = str(req.json?.slot);
  if (!slotExists(slot)) return error(400, 'INVALID_SLOT', 'Dieser Termin existiert nicht.');
  const free = publicSlots().find((s) => s.key === slot);
  if (free && free.available <= 0 && slot !== booking.slotKey)
    return error(409, 'SLOT_FULL', 'Dieser Termin ist inzwischen leider ausgebucht.');
  booking.slotKey = slot;
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

route('POST', '/api/nikolaus/manage/resend-link', (req) =>
  typeof req.json?.altcha === 'string'
    ? json({ status: 'sent', cooldownMinutes: 15 })
    : CAPTCHA_FAILED()
);
