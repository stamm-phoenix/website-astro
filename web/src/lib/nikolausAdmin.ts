import type { NikolausBookingStatus, StaffNikolausBooking, StaffNikolausSlot } from './types';

export const STATUS_ORDER: NikolausBookingStatus[] = [
  'confirmed',
  'pending',
  'expired',
  'cancelled',
];

/** Statuses that occupy a place and are shown by default. */
export const ACTIVE_STATUSES: NikolausBookingStatus[] = ['confirmed', 'pending'];

export const STATUS_LABEL: Record<NikolausBookingStatus, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  expired: 'Abgelaufen',
  cancelled: 'Storniert',
};

/** Tailwind classes for a small status pill. */
export const STATUS_CLASS: Record<NikolausBookingStatus, string> = {
  confirmed: 'bg-[#e3f1e8] text-[var(--color-dpsg-pfadfinder)] border-[#b5d9c2]',
  pending: 'bg-[#fff1e0] text-[#8a4a00] border-[#f5cf9f]',
  expired: 'bg-[var(--color-neutral-100)] text-neutral-700 border-[var(--color-neutral-200)]',
  cancelled: 'bg-[#f7e3e5] text-[var(--color-dpsg-red)] border-[#e5b8bd]',
};

export function isActiveBooking(booking: StaffNikolausBooking): boolean {
  return ACTIVE_STATUSES.includes(booking.status);
}

/** Formats a date (`YYYY-MM-DD`) like `Sa, 5.12.`. */
export function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Formats a slot key (`YYYY-MM-DDTHH:MM`) like `Sa, 5.12. · 17:00`. */
export function formatSlotKey(slotKey: string): string {
  const [date, time] = slotKey.split('T');
  if (!date || !time) return slotKey || '–';
  return `${formatShortDate(date)} · ${time}`;
}

/** Formats an ISO timestamp in local time like `24.11.2026, 18:05`. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

/** Active bookings per slot key, oldest booking (lowest id) first. */
export function activeBookingsBySlot(
  bookings: StaffNikolausBooking[]
): Record<string, StaffNikolausBooking[]> {
  const map: Record<string, StaffNikolausBooking[]> = {};
  for (const booking of bookings.filter(isActiveBooking)) {
    (map[booking.slotKey] ??= []).push(booking);
  }
  for (const list of Object.values(map)) list.sort((a, b) => Number(a.id) - Number(b.id));
  return map;
}

/** Whether a slot (`YYYY-MM-DDTHH:MM`, local time) has already started. */
export function isSlotPast(slotKey: string, now: Date = new Date()): boolean {
  return new Date(`${slotKey}:00`).getTime() <= now.getTime();
}

export interface FreeSlot {
  slot: StaffNikolausSlot;
  free: number;
}

/** Future slots with at least one free place, in chronological order. */
export function getFreeSlots(
  slots: StaffNikolausSlot[],
  bookings: StaffNikolausBooking[],
  now: Date = new Date()
): FreeSlot[] {
  const bySlot = activeBookingsBySlot(bookings);
  return slots
    .filter((slot) => !isSlotPast(slot.key, now))
    .map((slot) => ({ slot, free: slot.capacity - (bySlot[slot.key]?.length ?? 0) }))
    .filter((entry) => entry.free > 0)
    .sort((a, b) => a.slot.key.localeCompare(b.slot.key));
}

/** A slot with more active bookings than teams, e.g. after the number of teams was reduced. */
export interface OverbookedSlot {
  slot: StaffNikolausSlot;
  /** Active bookings in the slot, oldest first. */
  bookings: StaffNikolausBooking[];
}

export function getOverbookedSlots(
  slots: StaffNikolausSlot[],
  bookings: StaffNikolausBooking[]
): OverbookedSlot[] {
  const bySlot = activeBookingsBySlot(bookings);
  return slots
    .map((slot) => ({ slot, bookings: bySlot[slot.key] ?? [] }))
    .filter((entry) => entry.bookings.length > entry.slot.capacity)
    .sort((a, b) => a.slot.key.localeCompare(b.slot.key));
}

/** Active bookings whose slot is not part of the current configuration. */
export function getOrphanedBookings(
  slots: StaffNikolausSlot[],
  bookings: StaffNikolausBooking[]
): StaffNikolausBooking[] {
  const keys = new Set(slots.map((slot) => slot.key));
  return bookings.filter((booking) => isActiveBooking(booking) && !keys.has(booking.slotKey));
}

export type BookingProblem = 'overbooked' | 'orphaned';

/** Problems per booking id, for markers in list, matrix and details. */
export function getBookingProblems(
  slots: StaffNikolausSlot[],
  bookings: StaffNikolausBooking[]
): Record<string, BookingProblem> {
  const problems: Record<string, BookingProblem> = {};
  for (const entry of getOverbookedSlots(slots, bookings)) {
    for (const booking of entry.bookings) problems[booking.id] = 'overbooked';
  }
  for (const booking of getOrphanedBookings(slots, bookings)) problems[booking.id] = 'orphaned';
  return problems;
}

/** Free places per slot summed up; overbooked slots count as zero, not negative. */
export function countFreePlaces(
  slots: StaffNikolausSlot[],
  bookings: StaffNikolausBooking[]
): number {
  const bySlot = activeBookingsBySlot(bookings);
  return slots.reduce(
    (sum, slot) => sum + Math.max(0, slot.capacity - (bySlot[slot.key]?.length ?? 0)),
    0
  );
}

export const PROBLEM_LABEL: Record<BookingProblem, string> = {
  overbooked: 'Überbucht',
  orphaned: 'Termin nicht mehr angeboten',
};
