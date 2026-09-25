import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { NikolausSlotDefinition } from './nikolaus-config';
import {
  NIKOLAUS_CONFIG,
  dateToLocalParts,
  getChangeDeadline,
  getNikolausSlots,
  localDateTimeToDate,
  slotKeyToDate,
} from './nikolaus-config';
import type { NikolausBookingDetails } from './nikolaus-validation';
import type { GeocodeResult } from './geocoding';
import { geocodeAddress } from './geocoding';

export type NikolausBookingStatus = 'Ausstehend' | 'Bestaetigt' | 'Storniert' | 'Abgelaufen';

/** Location of the address as stored in the list (text columns). */
export interface NikolausGeoFields {
  Breitengrad: string;
  Laengengrad: string;
  GeoGenauigkeit: string;
}

export interface NikolausBooking extends NikolausBookingDetails {
  id: string;
  slotKey: string;
  status: NikolausBookingStatus;
  geo: NikolausGeoFields;
  tokenHash: string;
  reservedUntil: Date | undefined;
  confirmedAt: Date | undefined;
  changedAt: Date | undefined;
  linkSentAt: Date | undefined;
}

export interface NikolausSlotAvailability {
  key: string;
  date: string;
  time: string;
  endTime: string;
  capacity: number;
  available: number;
}

/**
 * Pending bookings keep blocking their slot for this long after `ReserviertBis`, so a
 * confirmation arriving right at the expiry can never race with a new booking.
 */
const EXPIRY_GRACE_MS = 5 * 60_000;

/** Minimum time between two mails with a new management link for the same booking. */
export const LINK_RESEND_COOLDOWN_MINUTES = 15;

interface NikolausListItem {
  id: string;
  fields: {
    Title?: string;
    Email?: string;
    Telefon?: string;
    Strasse?: string;
    PLZ?: string;
    Ort?: string;
    AdressHinweise?: string;
    AnzahlKinder?: number;
    MitKrampus?: boolean;
    Versteck?: string;
    Bemerkungen?: string;
    Breitengrad?: string;
    Laengengrad?: string;
    GeoGenauigkeit?: string;
    SlotKey?: string;
    Status?: string;
    TokenHash?: string;
    ReserviertBisDatum?: string;
    ReserviertBisUhrzeit?: string;
    BestaetigtAmDatum?: string;
    BestaetigtAmUhrzeit?: string;
    GeaendertAmDatum?: string;
    GeaendertAmUhrzeit?: string;
    LinkGesendetAmDatum?: string;
    LinkGesendetAmUhrzeit?: string;
  };
}

function getListId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_LIST_ID);
}

/** Dates are stored as two text columns `<prefix>Datum` / `<prefix>Uhrzeit` in local time. */
type DatePrefix = 'Termin' | 'ReserviertBis' | 'BestaetigtAm' | 'GeaendertAm' | 'LinkGesendetAm';

function parseLocalDateTime(date: string | undefined, time: string | undefined): Date | undefined {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return undefined;
  }
  const parsed = localDateTimeToDate(date, time);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The two text columns for a point in time, precise to the minute. */
function dateFields(prefix: DatePrefix, date: Date | undefined): Record<string, string> {
  if (!date) return {};
  const { date: day, time } = dateToLocalParts(date);
  return { [`${prefix}Datum`]: day, [`${prefix}Uhrzeit`]: time };
}

/** Rounds up to the next full minute, so a stored reservation is never shorter than promised. */
function ceilToMinute(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
}

function detailFields(details: NikolausBookingDetails): Record<string, unknown> {
  return {
    Title: details.familyName,
    Email: details.email,
    Telefon: details.phone,
    Strasse: details.street,
    PLZ: details.postalCode,
    Ort: details.city,
    AdressHinweise: details.addressNotes,
    AnzahlKinder: details.childrenCount,
    MitKrampus: details.withKrampus,
    Versteck: details.hidingPlace,
    Bemerkungen: details.notes,
  };
}

const GEO_PRECISION_LABELS = { address: 'Adresse', street: 'Straße', area: 'Ort' };

function geoFields(result: GeocodeResult): NikolausGeoFields {
  if (result.found && result.precision && result.lat !== undefined && result.lon !== undefined) {
    return {
      Breitengrad: result.lat.toFixed(6),
      Laengengrad: result.lon.toFixed(6),
      GeoGenauigkeit: GEO_PRECISION_LABELS[result.precision],
    };
  }
  return {
    Breitengrad: '',
    Laengengrad: '',
    GeoGenauigkeit: result.unavailable ? 'nicht ermittelt' : 'nicht gefunden',
  };
}

async function locate(details: NikolausBookingDetails): Promise<NikolausGeoFields> {
  return geoFields(await geocodeAddress(details.street, details.postalCode, details.city));
}

function mapBooking(item: unknown): NikolausBooking {
  const listItem = item as NikolausListItem;
  const fields = listItem.fields ?? {};
  return {
    id: String(listItem.id),
    familyName: fields.Title ?? '',
    email: fields.Email ?? '',
    phone: fields.Telefon ?? '',
    street: fields.Strasse ?? '',
    postalCode: fields.PLZ ?? '',
    city: fields.Ort ?? '',
    addressNotes: fields.AdressHinweise ?? '',
    childrenCount: Number(fields.AnzahlKinder ?? 0),
    withKrampus: fields.MitKrampus === true,
    hidingPlace: fields.Versteck ?? '',
    notes: fields.Bemerkungen ?? '',
    geo: {
      Breitengrad: fields.Breitengrad ?? '',
      Laengengrad: fields.Laengengrad ?? '',
      GeoGenauigkeit: fields.GeoGenauigkeit ?? '',
    },
    slotKey: fields.SlotKey ?? '',
    status: (fields.Status as NikolausBookingStatus) ?? 'Ausstehend',
    tokenHash: fields.TokenHash ?? '',
    reservedUntil: parseLocalDateTime(fields.ReserviertBisDatum, fields.ReserviertBisUhrzeit),
    confirmedAt: parseLocalDateTime(fields.BestaetigtAmDatum, fields.BestaetigtAmUhrzeit),
    changedAt: parseLocalDateTime(fields.GeaendertAmDatum, fields.GeaendertAmUhrzeit),
    linkSentAt: parseLocalDateTime(fields.LinkGesendetAmDatum, fields.LinkGesendetAmUhrzeit),
  };
}

/** Whether a booking currently occupies its slot. */
export function isBlocking(booking: NikolausBooking, now: Date = new Date()): boolean {
  if (booking.status === 'Bestaetigt') return true;
  if (booking.status !== 'Ausstehend' || !booking.reservedUntil) return false;
  return booking.reservedUntil.getTime() + EXPIRY_GRACE_MS > now.getTime();
}

/** Loads every booking in the list, regardless of status or slot. */
export async function getAllBookings(): Promise<NikolausBooking[]> {
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items.map(mapBooking);
}

/** Loads all bookings that currently occupy one of the configured slots. */
async function getBlockingBookings(now: Date): Promise<NikolausBooking[]> {
  const slotKeys = new Set(getNikolausSlots().map((slot) => slot.key));
  const bookings = await getAllBookings();
  return bookings.filter((booking) => slotKeys.has(booking.slotKey) && isBlocking(booking, now));
}

/** Returns all configured slots together with their remaining capacity. */
export async function getSlotAvailability(
  now: Date = new Date()
): Promise<NikolausSlotAvailability[]> {
  const bookings = await getBlockingBookings(now);
  const taken = new Map<string, number>();
  for (const booking of bookings) {
    taken.set(booking.slotKey, (taken.get(booking.slotKey) ?? 0) + 1);
  }

  return getNikolausSlots().map((slot) => ({
    key: slot.key,
    date: slot.date,
    time: slot.time,
    endTime: slot.endTime,
    capacity: slot.capacity,
    available: isSlotInPast(slot, now)
      ? 0
      : Math.max(0, slot.capacity - (taken.get(slot.key) ?? 0)),
  }));
}

export function isSlotInPast(slot: NikolausSlotDefinition, now: Date = new Date()): boolean {
  return slotKeyToDate(slot.key).getTime() <= now.getTime();
}

/** Whether the booking may still be changed or cancelled online. */
export function isBeforeChangeDeadline(booking: NikolausBooking, now: Date = new Date()): boolean {
  return getChangeDeadline(booking.slotKey).getTime() > now.getTime();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of a plain token against the stored hash. */
export function verifyToken(booking: NikolausBooking, token: string): boolean {
  if (!booking.tokenHash || !token) return false;
  const expected = Buffer.from(booking.tokenHash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasSameEmail(booking: NikolausBooking, email: string): boolean {
  return normalizeEmail(booking.email) === normalizeEmail(email);
}

/**
 * Finds an active booking (confirmed or reserved) for an e-mail address.
 * @param excludeTokenHash Ignores the booking with this token, e.g. the one being edited.
 */
export async function findActiveBookingByEmail(
  email: string,
  excludeTokenHash?: string,
  now: Date = new Date()
): Promise<NikolausBooking | undefined> {
  const matches = (await getBlockingBookings(now)).filter(
    (b) => hasSameEmail(b, email) && b.tokenHash !== excludeTokenHash
  );
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0];
}

/**
 * Finds the booking belonging to a management token. While a booking is being
 * rescheduled, the old and the new item briefly share the token; the newer item wins.
 */
export async function findBookingByToken(token: string): Promise<NikolausBooking | undefined> {
  const matches = (await getAllBookings()).filter((booking) => verifyToken(booking, token));
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0];
}

type ClaimResult = { ok: true; id: string; blocking: NikolausBooking[] } | { ok: false };

/**
 * Writes a new item into a slot without ever exceeding the slot capacity.
 *
 * SharePoint offers no transactions, so the item is written first and verified
 * afterwards: all bookings blocking the same slot are re-read, and if `capacity` of
 * them have a lower (= earlier) item ID, the new item is removed again. Of two
 * concurrent requests the later one (higher ID) always sees the earlier one, so at
 * most `capacity` bookings can survive.
 */
async function claimSlot(
  fields: Record<string, unknown>,
  slot: NikolausSlotDefinition,
  now: Date
): Promise<ClaimResult> {
  const listId = getListId();

  // Fast path: reject without writing if the slot is already full.
  const before = await getBlockingBookings(now);
  if (before.filter((b) => b.slotKey === slot.key).length >= slot.capacity) {
    return { ok: false };
  }

  const id = await createSharePointListItem(listId, {
    ...fields,
    SlotKey: slot.key,
    ...dateFields('Termin', slotKeyToDate(slot.key)),
  });

  let after: NikolausBooking[];
  let earlier: number;
  try {
    after = await getBlockingBookings(new Date());
    earlier = after.filter((b) => b.slotKey === slot.key && Number(b.id) < Number(id)).length;
  } catch (error: unknown) {
    // Without verification the item must not stay in the list
    await deleteSharePointListItem(listId, id);
    throw error;
  }

  if (earlier >= slot.capacity) {
    await deleteSharePointListItem(listId, id);
    return { ok: false };
  }

  return { ok: true, id, blocking: after };
}

export type CreateBookingResult =
  | { ok: true; id: string; token: string; reservedUntil: Date }
  | { ok: false; reason: 'SLOT_FULL' | 'EMAIL_EXISTS' };

/**
 * Reserves a slot for a new, unconfirmed booking. Each e-mail address may only have
 * one active booking; of concurrent bookings with the same address the earliest wins.
 */
export async function createBooking(
  details: NikolausBookingDetails,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<CreateBookingResult> {
  if (await findActiveBookingByEmail(details.email, undefined, now)) {
    return { ok: false, reason: 'EMAIL_EXISTS' };
  }

  // Geocode before claiming the slot, so the time between writing and verifying stays short
  const geo = await locate(details);

  const token = randomBytes(32).toString('base64url');
  const reservedUntil = ceilToMinute(
    new Date(now.getTime() + NIKOLAUS_CONFIG.pendingHoldMinutes * 60_000)
  );

  const result = await claimSlot(
    {
      ...detailFields(details),
      ...geo,
      Status: 'Ausstehend',
      TokenHash: hashToken(token),
      ...dateFields('ReserviertBis', reservedUntil),
      ...dateFields('LinkGesendetAm', now),
    },
    slot,
    now
  );
  if (!result.ok) {
    return { ok: false, reason: 'SLOT_FULL' };
  }

  const earlierWithSameEmail = result.blocking.some(
    (b) => hasSameEmail(b, details.email) && Number(b.id) < Number(result.id)
  );
  if (earlierWithSameEmail) {
    await deleteSharePointListItem(getListId(), result.id);
    return { ok: false, reason: 'EMAIL_EXISTS' };
  }

  return { ok: true, id: result.id, token, reservedUntil };
}

export type RescheduleResult =
  | { ok: true; booking: NikolausBooking; oldItemRemoved: boolean }
  | { ok: false; reason: 'SLOT_FULL' | 'ALREADY_CHANGED' };

/**
 * Moves a booking to another slot.
 *
 * The existing item must not simply be moved: its old, low ID would rank it ahead of
 * newer bookings in the target slot that were already verified, which could overbook
 * the slot. Instead a copy is claimed in the target slot like a new booking (same
 * token, status and reservation), and only if that succeeds the old item is removed.
 */
export async function rescheduleBooking(
  booking: NikolausBooking,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<RescheduleResult> {
  const listId = getListId();

  const result = await claimSlot(
    {
      ...detailFields(booking),
      ...booking.geo,
      Status: booking.status,
      TokenHash: booking.tokenHash,
      ...dateFields('ReserviertBis', booking.reservedUntil),
      ...dateFields('BestaetigtAm', booking.confirmedAt),
      ...dateFields('LinkGesendetAm', booking.linkSentAt),
      ...dateFields('GeaendertAm', now),
    },
    slot,
    now
  );
  if (!result.ok) {
    return { ok: false, reason: 'SLOT_FULL' };
  }

  // Concurrent reschedules of the same booking each create a copy with the same token.
  // Like slot claims, the earliest copy (lowest ID) wins and later ones withdraw. If the
  // old item is gone, a concurrent request has already completed the reschedule.
  let sameToken: NikolausBooking[];
  try {
    sameToken = (await getAllBookings()).filter((b) => b.tokenHash === booking.tokenHash);
  } catch (error: unknown) {
    // Without this check the copy must not stay, it would block the target slot as well
    await deleteSharePointListItem(listId, result.id);
    throw error;
  }
  const oldItemExists = sameToken.some((b) => b.id === booking.id);
  const earlierCopyExists = sameToken.some(
    (b) => Number(b.id) > Number(booking.id) && Number(b.id) < Number(result.id)
  );
  if (!oldItemExists || earlierCopyExists) {
    await deleteSharePointListItem(listId, result.id);
    return { ok: false, reason: 'ALREADY_CHANGED' };
  }

  // Keeping the old item by mistake only blocks a slot twice, it never overbooks.
  let oldItemRemoved = false;
  for (let attempt = 0; attempt < 2 && !oldItemRemoved; attempt++) {
    try {
      await deleteSharePointListItem(listId, booking.id);
      oldItemRemoved = true;
    } catch {
      // Retry once below
    }
  }

  const moved = await getBooking(result.id);
  return {
    ok: true,
    booking: moved ?? { ...booking, id: result.id, slotKey: slot.key, changedAt: now },
    oldItemRemoved,
  };
}

/** Updates the details of a booking; the address is located again if it changed. */
export async function updateBookingDetails(
  booking: NikolausBooking,
  details: NikolausBookingDetails,
  now: Date = new Date()
): Promise<NikolausBooking> {
  const addressChanged =
    details.street !== booking.street ||
    details.postalCode !== booking.postalCode ||
    details.city !== booking.city;
  const geo = addressChanged ? await locate(details) : booking.geo;

  await updateSharePointListItem(getListId(), booking.id, {
    ...detailFields(details),
    ...geo,
    ...dateFields('GeaendertAm', now),
  });
  return { ...booking, ...details, geo, changedAt: now };
}

/** Marks a booking as confirmed. */
/** Cancels a booking on behalf of the team and records when it was changed. */
export async function cancelBooking(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<void> {
  await setBookingStatus(booking.id, 'Storniert', dateFields('GeaendertAm', now));
}

export async function confirmBooking(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<NikolausBooking> {
  await setBookingStatus(booking.id, 'Bestaetigt', dateFields('BestaetigtAm', now));
  return { ...booking, status: 'Bestaetigt', confirmedAt: now };
}

/** Whether a new management link may be sent for this booking yet. */
export function canResendLink(booking: NikolausBooking, now: Date = new Date()): boolean {
  return (
    !booking.linkSentAt ||
    now.getTime() - booking.linkSentAt.getTime() >= LINK_RESEND_COOLDOWN_MINUTES * 60_000
  );
}

/**
 * Replaces the management token of a booking, invalidating all previous links.
 * @returns The new plain token for the link in the mail.
 */
export async function rotateToken(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await updateSharePointListItem(getListId(), booking.id, {
    TokenHash: hashToken(token),
    ...dateFields('LinkGesendetAm', now),
  });
  return token;
}

/**
 * Undoes `rotateToken` when the mail with the new link could not be sent: the previous
 * link works again and the cooldown is lifted. Skipped if a concurrent request has
 * rotated the token again in the meantime.
 */
export async function restorePreviousToken(
  booking: NikolausBooking,
  failedToken: string
): Promise<void> {
  const current = await getBooking(booking.id);
  if (!current || current.tokenHash !== hashToken(failedToken)) return;
  const allowedAgain = new Date(Date.now() - LINK_RESEND_COOLDOWN_MINUTES * 60_000);
  await updateSharePointListItem(getListId(), booking.id, {
    TokenHash: booking.tokenHash,
    ...dateFields('LinkGesendetAm', booking.linkSentAt ?? allowedAgain),
  });
}

export async function getBooking(id: string): Promise<NikolausBooking | undefined> {
  const item = await getSharePointListItem(getListId(), id);
  return item ? mapBooking(item) : undefined;
}

export async function deleteBooking(id: string): Promise<void> {
  await deleteSharePointListItem(getListId(), id);
}

export async function setBookingStatus(
  id: string,
  status: NikolausBookingStatus,
  extraFields: Record<string, unknown> = {}
): Promise<void> {
  await updateSharePointListItem(getListId(), id, { Status: status, ...extraFields });
}
