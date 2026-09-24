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
import { NIKOLAUS_CONFIG, getNikolausSlots, slotKeyToDate } from './nikolaus-config';

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
}

export interface NewNikolausBooking {
  familyName: string;
  email: string;
  phone: string;
  slotKey: string;
  withKrampus: boolean;
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
  };
}

/** Whether a booking currently occupies its slot. */
function isBlocking(booking: NikolausBooking, now: Date): boolean {
  if (booking.status === 'Bestaetigt') return true;
  if (booking.status !== 'Ausstehend' || !booking.reservedUntil) return false;
  return booking.reservedUntil.getTime() + EXPIRY_GRACE_MS > now.getTime();
}

/** Loads all bookings that currently occupy one of the configured slots. */
async function getBlockingBookings(now: Date): Promise<NikolausBooking[]> {
  const slotKeys = new Set(getNikolausSlots().map((slot) => slot.key));
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items
    .map(mapBooking)
    .filter((booking) => slotKeys.has(booking.slotKey) && isBlocking(booking, now));
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

export type CreateBookingResult =
  { ok: true; id: string; token: string; reservedUntil: Date } | { ok: false; reason: 'SLOT_FULL' };

/**
 * Reserves a slot for a new booking without ever exceeding the slot capacity.
 *
 * SharePoint offers no transactions, so the booking is written first and verified
 * afterwards: all bookings blocking the same slot are re-read, and if more than
 * `capacity` of them have a lower (= earlier) item ID, the new item is removed again.
 * Of two concurrent requests the later one (higher ID) always sees the earlier one,
 * so at most `capacity` bookings can survive.
 */
export async function createBooking(
  input: NewNikolausBooking,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<CreateBookingResult> {
  const listId = getListId();

  // Fast path: reject without writing if the slot is already full.
  const before = await getBlockingBookings(now);
  if (before.filter((b) => b.slotKey === slot.key).length >= slot.capacity) {
    return { ok: false, reason: 'SLOT_FULL' };
  }

  const token = randomBytes(32).toString('base64url');
  const reservedUntil = new Date(now.getTime() + NIKOLAUS_CONFIG.pendingHoldMinutes * 60_000);

  const id = await createSharePointListItem(listId, {
    Title: input.familyName,
    Email: input.email,
    Telefon: input.phone,
    Termin: slotKeyToDate(slot.key).toISOString(),
    MitKrampus: input.withKrampus,
    SlotKey: slot.key,
    Status: 'Ausstehend',
    TokenHash: hashToken(token),
    ReserviertBis: reservedUntil.toISOString(),
  });

  let earlier: number;
  try {
    const after = await getBlockingBookings(new Date());
    earlier = after.filter((b) => b.slotKey === slot.key && Number(b.id) < Number(id)).length;
  } catch (error: unknown) {
    // Without verification the booking must not stay in the list
    await deleteSharePointListItem(listId, id);
    throw error;
  }

  if (earlier >= slot.capacity) {
    await deleteSharePointListItem(listId, id);
    return { ok: false, reason: 'SLOT_FULL' };
  }

  return { ok: true, id, token, reservedUntil };
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
