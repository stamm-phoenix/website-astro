import type { NikolausBookingStatus, StaffNikolausBooking } from './types';

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
