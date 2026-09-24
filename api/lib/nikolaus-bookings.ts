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
  getChangeDeadline,
  getNikolausSlots,
  slotKeyToDate,
} from './nikolaus-config';
import type { NikolausBookingDetails } from './nikolaus-validation';

export type NikolausBookingStatus = 'Ausstehend' | 'Bestaetigt' | 'Storniert' | 'Abgelaufen';

export interface NikolausBooking {
  id: string;
  familyName: string;
  email: string;
  phone: string;
  slotKey: string;
  withKrampus: boolean;
  status: NikolausBookingStatus;
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
    SlotKey?: string;
    MitKrampus?: boolean;
    Status?: string;
    TokenHash?: string;
    ReserviertBis?: string;
    BestaetigtAm?: string;
    GeaendertAm?: string;
    LinkGesendetAm?: string;
  };
}

function getListId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_LIST_ID);
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function mapBooking(item: unknown): NikolausBooking {
  const listItem = item as NikolausListItem;
  const fields = listItem.fields ?? {};
  return {
    id: String(listItem.id),
    familyName: fields.Title ?? '',
    email: fields.Email ?? '',
    phone: fields.Telefon ?? '',
    slotKey: fields.SlotKey ?? '',
    withKrampus: fields.MitKrampus === true,
    status: (fields.Status as NikolausBookingStatus) ?? 'Ausstehend',
    tokenHash: fields.TokenHash ?? '',
    reservedUntil: parseDate(fields.ReserviertBis),
    confirmedAt: parseDate(fields.BestaetigtAm),
    changedAt: parseDate(fields.GeaendertAm),
    linkSentAt: parseDate(fields.LinkGesendetAm),
  };
}

/** Whether a booking currently occupies its slot. */
function isBlocking(booking: NikolausBooking, now: Date): boolean {
  if (booking.status === 'Bestaetigt') return true;
  if (booking.status !== 'Ausstehend' || !booking.reservedUntil) return false;
  return booking.reservedUntil.getTime() + EXPIRY_GRACE_MS > now.getTime();
}

async function getAllBookings(): Promise<NikolausBooking[]> {
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
    Termin: slotKeyToDate(slot.key).toISOString(),
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

  const token = randomBytes(32).toString('base64url');
  const reservedUntil = new Date(now.getTime() + NIKOLAUS_CONFIG.pendingHoldMinutes * 60_000);

  const result = await claimSlot(
    {
      Title: details.familyName,
      Email: details.email,
      Telefon: details.phone,
      MitKrampus: details.withKrampus,
      Status: 'Ausstehend',
      TokenHash: hashToken(token),
      ReserviertBis: reservedUntil.toISOString(),
      LinkGesendetAm: now.toISOString(),
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
      Title: booking.familyName,
      Email: booking.email,
      Telefon: booking.phone,
      MitKrampus: booking.withKrampus,
      Status: booking.status,
      TokenHash: booking.tokenHash,
      ...(booking.reservedUntil && { ReserviertBis: booking.reservedUntil.toISOString() }),
      ...(booking.confirmedAt && { BestaetigtAm: booking.confirmedAt.toISOString() }),
      ...(booking.linkSentAt && { LinkGesendetAm: booking.linkSentAt.toISOString() }),
      GeaendertAm: now.toISOString(),
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
  const sameToken = (await getAllBookings()).filter((b) => b.tokenHash === booking.tokenHash);
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

/** Updates the contact details of a booking. */
export async function updateBookingDetails(
  booking: NikolausBooking,
  details: NikolausBookingDetails,
  now: Date = new Date()
): Promise<NikolausBooking> {
  await updateSharePointListItem(getListId(), booking.id, {
    Title: details.familyName,
    Email: details.email,
    Telefon: details.phone,
    MitKrampus: details.withKrampus,
    GeaendertAm: now.toISOString(),
  });
  return { ...booking, ...details, changedAt: now };
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
    LinkGesendetAm: now.toISOString(),
  });
  return token;
}

/** Lifts the resend cooldown again, e.g. when sending the mail failed. */
export async function resetLinkCooldown(booking: NikolausBooking): Promise<void> {
  const allowedAgain = new Date(Date.now() - LINK_RESEND_COOLDOWN_MINUTES * 60_000);
  await updateSharePointListItem(getListId(), booking.id, {
    LinkGesendetAm: allowedAgain.toISOString(),
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
