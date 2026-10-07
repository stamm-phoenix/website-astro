import { randomBytes } from 'node:crypto';
import type { Insertable } from 'kysely';
import type { BookingTable } from '../../lib/db-schema';
import { getDb } from '../../lib/db';
import { createHelper } from '../../lib/nikolaus-helfende-list';
import type { NikolausBooking } from '../../lib/nikolaus-bookings';
import { getBooking, hashToken, slotColumns } from '../../lib/nikolaus-bookings';
import type { HelperInput } from '../../lib/pflege-validation';

export const FAMILY = {
  familyName: 'Testfamilie',
  email: 'family@example.test',
  phone: '0123456789',
  street: 'Teststraße 1',
  postalCode: '83620',
  city: 'Testort',
  addressNotes: '',
  childrenCount: 2,
  withKrampus: false,
  hidingPlace: 'Tür',
  notes: '',
};

export interface InsertedBooking {
  booking: NikolausBooking;
  token: string;
}

/** Writes a booking directly, without capacity checks; confirmed unless stated otherwise. */
export async function insertBooking(
  slotKey: string,
  values: Partial<Insertable<BookingTable>> = {}
): Promise<InsertedBooking> {
  const token = randomBytes(32).toString('base64url');
  const { id } = await getDb()
    .insertInto('nikolaus.booking')
    .values({
      ...slotColumns(slotKey),
      family_name: FAMILY.familyName,
      email: `family-${randomBytes(4).toString('hex')}@example.test`,
      phone: FAMILY.phone,
      street: FAMILY.street,
      postal_code: FAMILY.postalCode,
      city: FAMILY.city,
      children_count: FAMILY.childrenCount,
      with_krampus: FAMILY.withKrampus,
      hiding_place: FAMILY.hidingPlace,
      geo_result: 'address',
      latitude: 47.85,
      longitude: 11.7,
      status: 'Bestaetigt',
      token_hash: hashToken(token),
      confirmed_at: new Date('2026-10-01T12:00:00Z'),
      ...values,
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return { booking: (await getBooking(String(id)))!, token };
}

/** Writes one planned visit. */
export async function insertDispo(
  bookingId: string,
  date: string,
  values: { team?: string; order?: number; slotKey?: string; visitedAt?: Date } = {}
): Promise<void> {
  await getDb()
    .insertInto('nikolaus.dispo_visit')
    .values({
      date,
      booking_id: Number(bookingId),
      team: values.team ?? 'A',
      route_order: values.order ?? 1,
      slot_key: values.slotKey ?? `${date}T17:00`,
      planned_arrival: (values.slotKey ?? `${date}T17:00`).slice(11, 16),
      fixed: false,
      visited_at: values.visitedAt ?? null,
    })
    .execute();
}

export async function insertHelper(input: Partial<HelperInput> = {}): Promise<string> {
  return createHelper({
    name: 'Test Helfer',
    availability: {},
    positiveTags: [],
    negativeTags: [],
    notes: '',
    ...input,
  });
}
