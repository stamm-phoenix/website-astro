import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ExpressionBuilder, Selectable, Updateable } from 'kysely';
import type { BookingTable, Database, GeoResult } from './db-schema';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  parseId,
  parseStringList,
  requireVersion,
  toVersion,
} from './db';
import type { Db } from './db';
import type { NikolausSlotDefinition } from './nikolaus-config';
import {
  NIKOLAUS_CONFIG,
  getChangeDeadline,
  getNikolausSlots,
  isBookingClosed,
  slotKeyToDate,
} from './nikolaus-config';
import type { NikolausBookingDetails } from './nikolaus-validation';
import type { GeocodeResult } from './geocoding';
import { geocodeAddress } from './geocoding';

export type NikolausBookingStatus = 'Ausstehend' | 'Bestaetigt' | 'Storniert' | 'Abgelaufen';

/** Location of the address as shown to staff and families. */
export interface NikolausGeoFields {
  Breitengrad: string;
  Laengengrad: string;
  GeoGenauigkeit: string;
}

export interface NikolausBooking extends NikolausBookingDetails {
  id: string;
  /** Version of the row as loaded, for conditional updates. */
  etag: string;
  slotKey: string;
  status: NikolausBookingStatus;
  geo: NikolausGeoFields;
  /** Tags for the internal planning; never shown to the family. */
  internalTags: string[];
  /** Stufen whose suggestion from the Stufen-Abgleich was rejected. */
  rejectedStufen: string[];
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
  /** The online booking for this day is closed (from midnight of the day on). */
  closed: boolean;
}

/**
 * Pending bookings keep blocking their slot for this long after `reserved_until`, so a
 * confirmation arriving right at the expiry can never race with a new booking.
 */
const EXPIRY_GRACE_MS = 5 * 60_000;

/** Minimum time between two mails with a new management link for the same booking. */
export const LINK_RESEND_COOLDOWN_MINUTES = 15;

/**
 * Serializes every change that can take a place in a slot or an e-mail address (new booking,
 * move, e-mail change). Taken before the checks, so two of them never see the same free place.
 */
const CAPACITY_LOCK = 'nikolaus:booking-capacity';

type BookingRow = Selectable<BookingTable>;

/** The geocoding columns of a booking. */
export interface GeoColumns {
  geo_result: GeoResult;
  latitude: number | null;
  longitude: number | null;
}

const GEO_PRECISION_LABELS: Record<GeoResult, string> = {
  address: 'Adresse',
  street: 'Straße',
  area: 'Ort',
  not_found: 'nicht gefunden',
  unavailable: 'nicht ermittelt',
};

export function geoColumns(result: GeocodeResult): GeoColumns {
  if (result.found && result.precision && result.lat !== undefined && result.lon !== undefined) {
    return {
      geo_result: result.precision,
      latitude: Number(result.lat.toFixed(6)),
      longitude: Number(result.lon.toFixed(6)),
    };
  }
  return {
    geo_result: result.unavailable ? 'unavailable' : 'not_found',
    latitude: null,
    longitude: null,
  };
}

async function locate(details: NikolausBookingDetails): Promise<GeoColumns> {
  return geoColumns(await geocodeAddress(details.street, details.postalCode, details.city));
}

/** The columns of the family's details. */
export function detailColumns(details: NikolausBookingDetails) {
  return {
    family_name: details.familyName,
    email: details.email,
    phone: details.phone,
    street: details.street,
    postal_code: details.postalCode,
    city: details.city,
    address_notes: details.addressNotes,
    children_count: details.childrenCount,
    with_krampus: details.withKrampus,
    hiding_place: details.hidingPlace,
    notes: details.notes,
  };
}

/** The slot columns; the visit date is derived from the slot. */
export function slotColumns(slotKey: string): { slot_key: string; visit_date: string } {
  return { slot_key: slotKey, visit_date: slotKey.slice(0, 10) };
}

function mapBooking(row: BookingRow): NikolausBooking {
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    familyName: row.family_name,
    email: row.email,
    phone: row.phone,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    addressNotes: row.address_notes,
    childrenCount: row.children_count,
    withKrampus: row.with_krampus,
    hidingPlace: row.hiding_place,
    notes: row.notes,
    geo: {
      Breitengrad: row.latitude === null ? '' : Number(row.latitude).toFixed(6),
      Laengengrad: row.longitude === null ? '' : Number(row.longitude).toFixed(6),
      GeoGenauigkeit: GEO_PRECISION_LABELS[row.geo_result],
    },
    internalTags: parseStringList(row.internal_tags),
    rejectedStufen: parseStringList(row.rejected_stufen),
    slotKey: row.slot_key,
    status: row.status as NikolausBookingStatus,
    tokenHash: row.token_hash,
    reservedUntil: row.reserved_until ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    changedAt: row.changed_at ?? undefined,
    linkSentAt: row.link_sent_at ?? undefined,
  };
}

/** Rounds up to the next full minute, so a stored reservation is never shorter than promised. */
function ceilToMinute(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
}

/** Whether a booking currently occupies its slot. */
export function isBlocking(booking: NikolausBooking, now: Date = new Date()): boolean {
  if (booking.status === 'Bestaetigt') return true;
  if (booking.status !== 'Ausstehend' || !booking.reservedUntil) return false;
  return booking.reservedUntil.getTime() + EXPIRY_GRACE_MS > now.getTime();
}

/** The SQL form of `isBlocking`. */
function blockingAt(now: Date) {
  const cutoff = new Date(now.getTime() - EXPIRY_GRACE_MS);
  return (eb: ExpressionBuilder<Database, 'nikolaus.booking'>) =>
    eb.or([
      eb('status', '=', 'Bestaetigt'),
      eb.and([eb('status', '=', 'Ausstehend'), eb('reserved_until', '>', cutoff)]),
    ]);
}

function configuredSlotKeys(): Set<string> {
  return new Set(getNikolausSlots().map((slot) => slot.key));
}

export async function getAllBookings(db: Db = getDb()): Promise<NikolausBooking[]> {
  const rows = await db.selectFrom('nikolaus.booking').selectAll().orderBy('id').execute();
  return rows.map(mapBooking);
}

/** Bookings that currently occupy one of the configured slots. */
export async function getCapacityBlockingBookings(
  now: Date = new Date()
): Promise<NikolausBooking[]> {
  const slots = configuredSlotKeys();
  const rows = await getDb()
    .selectFrom('nikolaus.booking')
    .selectAll()
    .where(blockingAt(now))
    .orderBy('id')
    .execute();
  return rows.map(mapBooking).filter((booking) => slots.has(booking.slotKey));
}

async function countBlocking(
  db: Db,
  slotKey: string,
  now: Date,
  excludeId?: number
): Promise<number> {
  let query = db
    .selectFrom('nikolaus.booking')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('slot_key', '=', slotKey)
    .where(blockingAt(now));
  if (excludeId !== undefined) query = query.where('id', '<>', excludeId);
  return Number((await query.executeTakeFirstOrThrow()).count);
}

/** Returns all configured slots together with their remaining capacity. */
export async function getSlotAvailability(
  now: Date = new Date()
): Promise<NikolausSlotAvailability[]> {
  const rows = await getDb()
    .selectFrom('nikolaus.booking')
    .select((eb) => ['slot_key', eb.fn.countAll<number>().as('count')])
    .where(blockingAt(now))
    .groupBy('slot_key')
    .execute();
  const taken = new Map(rows.map((row) => [row.slot_key, Number(row.count)]));

  return getNikolausSlots().map((slot) => {
    const closed = isBookingClosed(slot.date, now);
    return {
      key: slot.key,
      date: slot.date,
      time: slot.time,
      endTime: slot.endTime,
      capacity: slot.capacity,
      available:
        closed || isSlotInPast(slot, now)
          ? 0
          : Math.max(0, slot.capacity - (taken.get(slot.key) ?? 0)),
      closed,
    };
  });
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

async function activeByEmail(
  db: Db,
  email: string,
  now: Date,
  exclude?: { tokenHash?: string; id?: number }
): Promise<NikolausBooking | undefined> {
  const slots = configuredSlotKeys();
  let query = db
    .selectFrom('nikolaus.booking')
    .selectAll()
    .where('email_normalized', '=', normalizeEmail(email))
    .where(blockingAt(now));
  if (exclude?.tokenHash) query = query.where('token_hash', '<>', exclude.tokenHash);
  if (exclude?.id !== undefined) query = query.where('id', '<>', exclude.id);
  const rows = await query.orderBy('id', 'desc').execute();
  return rows.map(mapBooking).find((booking) => slots.has(booking.slotKey));
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
  return activeByEmail(getDb(), email, now, { tokenHash: excludeTokenHash });
}

/**
 * Finds the booking belonging to a management token.
 * @param loadBookings Source of the bookings, e.g. a short-lived cache for polling endpoints.
 */
export async function findBookingByToken(
  token: string,
  loadBookings?: () => Promise<NikolausBooking[]>
): Promise<NikolausBooking | undefined> {
  if (loadBookings) {
    return (await loadBookings()).find((booking) => verifyToken(booking, token));
  }
  const row = await getDb()
    .selectFrom('nikolaus.booking')
    .selectAll()
    .where('token_hash', '=', hashToken(token))
    .executeTakeFirst();
  return row ? mapBooking(row) : undefined;
}

export type CreateBookingResult =
  | { ok: true; id: string; etag: string; token: string; reservedUntil: Date }
  | { ok: false; reason: 'SLOT_FULL' | 'EMAIL_EXISTS' };

/**
 * Reserves a slot for a new, unconfirmed booking. Each e-mail address may only have one active
 * booking. Capacity and address are checked and the row written in one transaction.
 */
export async function createBooking(
  details: NikolausBookingDetails,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<CreateBookingResult> {
  // Answer quickly without geocoding if the address is already taken
  if (await findActiveBookingByEmail(details.email, undefined, now)) {
    return { ok: false, reason: 'EMAIL_EXISTS' };
  }

  const geo = await locate(details);
  const token = randomBytes(32).toString('base64url');
  const reservedUntil = ceilToMinute(
    new Date(now.getTime() + NIKOLAUS_CONFIG.pendingHoldMinutes * 60_000)
  );

  return inTransaction(async (trx) => {
    await lockResource(trx, CAPACITY_LOCK);
    if (await activeByEmail(trx, details.email, now)) {
      return { ok: false, reason: 'EMAIL_EXISTS' } as const;
    }
    if ((await countBlocking(trx, slot.key, now)) >= slot.capacity) {
      return { ok: false, reason: 'SLOT_FULL' } as const;
    }
    const inserted = await trx
      .insertInto('nikolaus.booking')
      .values({
        ...slotColumns(slot.key),
        ...detailColumns(details),
        ...geo,
        status: 'Ausstehend',
        token_hash: hashToken(token),
        reserved_until: reservedUntil,
        link_sent_at: now,
      })
      .output(['inserted.id', 'inserted.version'])
      .executeTakeFirstOrThrow();
    return {
      ok: true,
      id: String(inserted.id),
      etag: toVersion(inserted.version),
      token,
      reservedUntil,
    } as const;
  });
}

export type RescheduleResult =
  { ok: true; booking: NikolausBooking } | { ok: false; reason: 'SLOT_FULL' | 'ALREADY_CHANGED' };

/** Moves a booking to another slot if it still has the loaded version and the slot is free. */
export async function rescheduleBooking(
  booking: NikolausBooking,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<RescheduleResult> {
  const id = parseId(booking.id);
  const version = requireVersion(booking.etag);
  if (id === undefined) return { ok: false, reason: 'ALREADY_CHANGED' };
  return inTransaction(async (trx) => {
    await lockResource(trx, CAPACITY_LOCK);
    if ((await countBlocking(trx, slot.key, now, id)) >= slot.capacity) {
      return { ok: false, reason: 'SLOT_FULL' } as const;
    }
    const result = await trx
      .updateTable('nikolaus.booking')
      .set({ ...slotColumns(slot.key), changed_at: now })
      .where('id', '=', id)
      .where('version', '=', version)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0)
      return { ok: false, reason: 'ALREADY_CHANGED' } as const;
    const moved = await loadBooking(trx, id);
    return moved
      ? ({ ok: true, booking: moved } as const)
      : ({ ok: false, reason: 'ALREADY_CHANGED' } as const);
  });
}

/** Writes `values` only if the row still has the version the caller loaded. */
async function updateBooking(
  db: Db,
  id: string,
  etag: string,
  values: Updateable<BookingTable>
): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  const result = await db
    .updateTable('nikolaus.booking')
    .set(values)
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) > 0) return;
  throw (await loadBooking(db, numericId)) ? new VersionConflictError() : new RecordNotFoundError();
}

/** Replaces the internal tags of a booking. */
export async function setBookingTags(id: string, tags: string[], etag: string): Promise<void> {
  await updateBooking(getDb(), id, etag, { internal_tags: JSON.stringify(tags) });
}

/** Replaces the Stufen whose suggestion from the Stufen-Abgleich was rejected. */
export async function setBookingRejectedStufen(
  id: string,
  stufen: string[],
  etag: string
): Promise<void> {
  await updateBooking(getDb(), id, etag, { rejected_stufen: JSON.stringify(stufen) });
}

/** Another active booking already uses the new e-mail address. */
export class BookingEmailExistsError extends Error {
  constructor() {
    super('Für diese E-Mail-Adresse gibt es bereits einen anderen Termin.');
    this.name = 'BookingEmailExistsError';
  }
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
  const geo = addressChanged ? await locate(details) : {};
  const id = parseId(booking.id);
  if (id === undefined) throw new RecordNotFoundError();

  return inTransaction(async (trx) => {
    if (normalizeEmail(details.email) !== normalizeEmail(booking.email)) {
      await lockResource(trx, CAPACITY_LOCK);
      if (await activeByEmail(trx, details.email, now, { id })) {
        throw new BookingEmailExistsError();
      }
    }
    await updateBooking(trx, booking.id, booking.etag, {
      ...detailColumns(details),
      ...geo,
      changed_at: now,
    });
    const updated = await loadBooking(trx, id);
    if (!updated) throw new RecordNotFoundError();
    return updated;
  });
}

/** Cancels a booking and records when it was changed. */
export async function cancelBooking(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<void> {
  await setBookingStatus(booking, 'Storniert', { changed_at: now });
}

/** Confirms only the reservation version that was loaded by the caller. */
export async function confirmBooking(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<NikolausBooking> {
  await setBookingStatus(booking, 'Bestaetigt', { confirmed_at: now });
  return (await getBooking(booking.id)) ?? { ...booking, status: 'Bestaetigt', confirmedAt: now };
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
): Promise<string | undefined> {
  if (!canResendLink(booking, now)) return undefined;
  const token = randomBytes(32).toString('base64url');
  await updateBooking(getDb(), booking.id, booking.etag, {
    token_hash: hashToken(token),
    link_sent_at: ceilToMinute(now),
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
  try {
    await updateBooking(getDb(), booking.id, current.etag, {
      token_hash: booking.tokenHash,
      link_sent_at: booking.linkSentAt ?? allowedAgain,
    });
  } catch (error: unknown) {
    if (!(error instanceof VersionConflictError) && !(error instanceof RecordNotFoundError)) {
      throw error;
    }
  }
}

async function loadBooking(db: Db, id: number): Promise<NikolausBooking | undefined> {
  const row = await db
    .selectFrom('nikolaus.booking')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? mapBooking(row) : undefined;
}

export async function getBooking(id: string): Promise<NikolausBooking | undefined> {
  const numericId = parseId(id);
  return numericId === undefined ? undefined : loadBooking(getDb(), numericId);
}

/** Deletes a booking with the loaded version; its Dispo visit goes with it. */
export async function deleteBooking(id: string, etag: string): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  const result = await getDb()
    .deleteFrom('nikolaus.booking')
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) > 0) return;
  throw (await loadBooking(getDb(), numericId))
    ? new VersionConflictError()
    : new RecordNotFoundError();
}

export async function setBookingStatus(
  booking: NikolausBooking,
  status: NikolausBookingStatus,
  extra: { confirmed_at?: Date; changed_at?: Date } = {}
): Promise<void> {
  await updateBooking(getDb(), booking.id, booking.etag, { status, ...extra });
}
