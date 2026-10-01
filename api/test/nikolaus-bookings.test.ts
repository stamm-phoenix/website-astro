import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as environment from '../lib/environment';
import * as geocoding from '../lib/geocoding';
import * as mails from '../lib/nikolaus-mails';
import {
  canResendLink,
  createBooking,
  dateFields,
  detailFields,
  getSlotAvailability,
  hashToken,
  isBlocking,
  rescheduleBooking,
} from '../lib/nikolaus-bookings';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import { canChangeBooking, getPublicStatus } from '../lib/nikolaus-api';
import { getChangeDeadline, getNikolausSlots, localDateTimeToDate } from '../lib/nikolaus-config';
import { ConfirmNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-confirm';

const NOW = new Date('2026-12-01T12:00:00Z');
const SLOT = getNikolausSlots()[0];
const TARGET = getNikolausSlots()[1];
const TOKEN = 'simulated-management-token-long-enough';

function booking(overrides: Partial<NikolausBooking> = {}): NikolausBooking {
  return {
    id: '1',
    etag: '"1,1"',
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
    slotKey: SLOT.key,
    status: 'Bestaetigt',
    geo: { Breitengrad: '', Laengengrad: '', GeoGenauigkeit: '' },
    internalTags: [],
    rejectedStufen: [],
    tokenHash: hashToken(TOKEN),
    reservedUntil: undefined,
    confirmedAt: NOW,
    changedAt: undefined,
    linkSentAt: undefined,
    ...overrides,
  };
}

interface StoredItem {
  id: string;
  eTag: string;
  fields: Record<string, unknown>;
}

/** Only this in-memory list is available to the booking code; no external services run. */
function setup(t: TestContext, initial: NikolausBooking[] = []) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(environment, 'getEnvironment', () => 'simulated-bookings');
  t.mock.method(geocoding, 'geocodeAddress', async () => ({ found: false }));
  const rows = new Map<string, StoredItem>();
  for (const item of initial) {
    rows.set(item.id, {
      id: item.id,
      eTag: item.etag,
      fields: {
        ...detailFields(item),
        ...item.geo,
        SlotKey: item.slotKey,
        Status: item.status,
        TokenHash: item.tokenHash,
        InterneTags: item.internalTags.join(', '),
        AbgelehnteStufen: item.rejectedStufen.join(', '),
        ...dateFields('ReserviertBis', item.reservedUntil),
        ...dateFields('BestaetigtAm', item.confirmedAt),
      },
    });
  }
  let nextId = Math.max(0, ...[...rows.keys()].map(Number)) + 1;
  const read = t.mock.method(sharePoint, 'getSharePointListItems', async () =>
    structuredClone([...rows.values()])
  );
  t.mock.method(sharePoint, 'getSharePointListItem', async (_list: string, id: string) =>
    structuredClone(rows.get(id))
  );
  const create = t.mock.method(
    sharePoint,
    'createSharePointListItem',
    async (_list: string, fields: Record<string, unknown>) => {
      const id = String(nextId++);
      rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
      return id;
    }
  );
  const remove = t.mock.method(
    sharePoint,
    'deleteSharePointListItem',
    async (_list: string, id: string) => {
      rows.delete(id);
    }
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (_list: string, id: string, fields: Record<string, unknown>) => {
      const row = rows.get(id);
      assert.ok(row);
      Object.assign(row.fields, fields);
    }
  );
  const sent = t.mock.method(mails, 'sendBookingConfirmedMail', async () => undefined);
  return { rows, read, create, remove, update, sent };
}

test('availability counts confirmed and pending reservations, clamps overbooking and closes at Berlin midnight', async (t) => {
  setup(t, [
    booking(),
    booking({ id: '2', status: 'Ausstehend', reservedUntil: NOW }),
    booking({ id: '3', status: 'Storniert' }),
    booking({ id: '4', status: 'Abgelaufen' }),
    booking({ id: '5', slotKey: 'unconfigured' }),
    booking({ id: '6', status: 'Ausstehend', reservedUntil: new Date(NOW.getTime() - 300_000) }),
    booking({ id: '7', email: 'overbooked@example.test' }),
  ]);
  assert.equal((await getSlotAvailability(NOW))[0].available, 0);
  assert.equal((await getSlotAvailability(NOW))[1].available, TARGET.capacity);
  const midnight = localDateTimeToDate(SLOT.date, '00:00');
  const before = (await getSlotAvailability(new Date(midnight.getTime() - 1)))[1];
  assert.equal(before.closed, false);
  assert.equal(before.available, TARGET.capacity);
  const closed = (await getSlotAvailability(midnight))[1];
  assert.equal(closed.closed, true);
  assert.equal(closed.available, 0);
});

test('confirmation expiry and capacity grace have distinct exact boundaries', () => {
  const pending = booking({ status: 'Ausstehend', reservedUntil: NOW });
  assert.equal(getPublicStatus(pending, new Date(NOW.getTime() - 1)), 'pending');
  assert.equal(getPublicStatus(pending, NOW), 'expired');
  assert.equal(isBlocking(pending, NOW), true);
  assert.equal(isBlocking(pending, new Date(NOW.getTime() + 299_999)), true);
  assert.equal(isBlocking(pending, new Date(NOW.getTime() + 300_000)), false);
  assert.equal(isBlocking(booking({ status: 'Ausstehend' }), NOW), false);
  assert.equal(isBlocking(booking({ status: 'Storniert', reservedUntil: NOW }), NOW), false);
  assert.equal(isBlocking(booking(), new Date('2027-01-01T00:00:00Z')), true);
});

test('online changes and link resends use their exact deadline boundaries', () => {
  const active = booking();
  const deadline = getChangeDeadline(active.slotKey);
  assert.equal(canChangeBooking(active, new Date(deadline.getTime() - 1)), true);
  assert.equal(canChangeBooking(active, deadline), false);
  assert.equal(canChangeBooking(booking({ status: 'Storniert' }), NOW), false);
  assert.equal(canChangeBooking(booking({ slotKey: '2026-12-05T16:00' }), NOW), false);
  const linked = booking({ linkSentAt: NOW });
  assert.equal(canResendLink(linked, new Date(NOW.getTime() + 899_999)), false);
  assert.equal(canResendLink(linked, new Date(NOW.getTime() + 900_000)), true);
});

test('full slots reject new reservations before any write', async (t) => {
  const state = setup(t, [booking(), booking({ id: '2', email: 'other@example.test' })]);
  assert.deepEqual(await createBooking(booking({ email: 'new@example.test' }), SLOT, NOW), {
    ok: false,
    reason: 'SLOT_FULL',
  });
  assert.equal(state.create.mock.callCount(), 0);
  assert.equal(state.rows.size, SLOT.capacity);
});

test('concurrent slot claims keep only the earliest claim for the last free place', async (t) => {
  const state = setup(t, [booking()]);
  let release!: () => void;
  const bothWritten = new Promise<void>((resolve) => {
    release = resolve;
  });
  let nextId = 2;
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    const id = String(nextId++);
    state.rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
    if (nextId === 4) release();
    await bothWritten;
    return id;
  });
  const results = await Promise.all([
    createBooking(booking({ email: 'first@example.test' }), SLOT, NOW),
    createBooking(booking({ email: 'second@example.test' }), SLOT, NOW),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results[1], { ok: false, reason: 'SLOT_FULL' });
  assert.equal(state.create.mock.callCount(), 2);
  assert.deepEqual([...state.rows.keys()], ['1', '2']);
});

test('failed post-write verification removes the unverified slot claim', async (t) => {
  const state = setup(t);
  const failure = new Error('simulated verification failure');
  state.read.mock.mockImplementation(async () => {
    if (state.rows.size > 0) throw failure;
    return [];
  });
  await assert.rejects(createBooking(booking(), SLOT, NOW), (error: unknown) => error === failure);
  assert.equal(state.create.mock.callCount(), 1);
  assert.equal(state.remove.mock.callCount(), 1);
  assert.equal(state.rows.size, 0);
});

test('concurrent reservations normalize email addresses and retain only one active booking', async (t) => {
  const state = setup(t);
  let release!: () => void;
  const bothWritten = new Promise<void>((resolve) => {
    release = resolve;
  });
  let nextId = 1;
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    const id = String(nextId++);
    state.rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
    if (nextId === 3) release();
    await bothWritten;
    return id;
  });
  const results = await Promise.all([
    createBooking(booking({ email: ' Family@Example.Test ' }), SLOT, NOW),
    createBooking(booking({ email: 'family@example.test' }), TARGET, NOW),
  ]);
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[1], { ok: false, reason: 'EMAIL_EXISTS' });
  assert.deepEqual([...state.rows.keys()], ['1']);
});

test('concurrent reschedules to different slots keep one copy and remove the original once', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  let release!: () => void;
  const bothWritten = new Promise<void>((resolve) => {
    release = resolve;
  });
  let nextId = 2;
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    const id = String(nextId++);
    state.rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
    if (nextId === 4) release();
    await bothWritten;
    return id;
  });
  const results = await Promise.all([
    rescheduleBooking(original, TARGET, NOW),
    rescheduleBooking(original, getNikolausSlots()[2], NOW),
  ]);
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[1], { ok: false, reason: 'ALREADY_CHANGED' });
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal(state.rows.get('2')?.fields.SlotKey, TARGET.key);
  assert.equal(
    state.remove.mock.calls.filter((call) => call.arguments[1] === original.id).length,
    1
  );
});

test('failed removal of the original booking rolls back a reschedule after retry', async (t) => {
  const original = booking({ internalTags: ['Bekannt'], rejectedStufen: ['Rover'] });
  const state = setup(t, [original]);
  state.remove.mock.mockImplementation(async (_list: string, id: string) => {
    if (id === original.id) throw new Error('simulated old-item delete failure');
    state.rows.delete(id);
  });
  assert.deepEqual(await rescheduleBooking(original, TARGET, NOW), {
    ok: false,
    reason: 'NOT_MOVED',
  });
  assert.deepEqual(
    state.remove.mock.calls.map((call) => call.arguments[1]),
    ['1', '1', '2']
  );
  assert.deepEqual([...state.rows.keys()], ['1']);
  assert.equal(state.rows.get('1')?.fields.SlotKey, SLOT.key);
});

test('rescheduling preserves booking data, tags and confirmation without occupying the old slot', async (t) => {
  const original = booking({ internalTags: ['Bekannt'], rejectedStufen: ['Rover'] });
  const state = setup(t, [original]);
  const result = await rescheduleBooking(original, TARGET, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.booking.slotKey, TARGET.key);
  assert.equal(result.booking.status, original.status);
  assert.equal(result.booking.tokenHash, original.tokenHash);
  assert.deepEqual(result.booking.internalTags, original.internalTags);
  assert.deepEqual(result.booking.rejectedStufen, original.rejectedStufen);
  assert.equal(result.booking.confirmedAt?.getTime(), original.confirmedAt?.getTime());
  assert.deepEqual([...state.rows.keys()], [result.booking.id]);
});

for (const [offset, expectedStatus] of [
  [-1, 200],
  [0, 410],
  [1, 410],
] as const) {
  test(`confirmation at expiry plus ${offset}ms returns ${expectedStatus} without real mail`, async (t) => {
    const state = setup(t, [
      booking({
        status: 'Ausstehend',
        confirmedAt: undefined,
        reservedUntil: NOW,
      }),
    ]);
    t.mock.timers.setTime(NOW.getTime() + offset);
    const request = new HttpRequest({
      method: 'POST',
      url: 'https://example.test/api/nikolaus/manage/confirm',
      headers: { 'content-type': 'application/json' },
      body: { string: JSON.stringify({ token: TOKEN }) },
    });
    const response = await ConfirmNikolausBookingEndpoint(request, new InvocationContext());
    assert.equal(response.status, expectedStatus);
    assert.equal(
      state.rows.get('1')?.fields.Status,
      expectedStatus === 200 ? 'Bestaetigt' : 'Abgelaufen'
    );
    assert.equal(state.sent.mock.callCount(), expectedStatus === 200 ? 1 : 0);
  });
}

test('confirmation survives an informational mail failure and repeating it does not send again', async (t) => {
  const state = setup(t, [
    booking({
      status: 'Ausstehend',
      confirmedAt: undefined,
      reservedUntil: new Date(NOW.getTime() + 60_000),
    }),
  ]);
  state.sent.mock.mockImplementation(async () => {
    throw new Error('simulated mail failure');
  });
  const context = new InvocationContext();
  const warn = t.mock.method(context, 'warn', () => undefined);
  const request = (): HttpRequest =>
    new HttpRequest({
      method: 'POST',
      url: 'https://example.test/api/nikolaus/manage/confirm',
      headers: { 'content-type': 'application/json' },
      body: { string: JSON.stringify({ token: TOKEN }) },
    });
  assert.equal((await ConfirmNikolausBookingEndpoint(request(), context)).status, 200);
  assert.equal(state.rows.get('1')?.fields.Status, 'Bestaetigt');
  assert.equal(warn.mock.callCount(), 1);
  assert.equal((await ConfirmNikolausBookingEndpoint(request(), context)).status, 200);
  assert.equal(state.sent.mock.callCount(), 1);
  assert.equal(state.update.mock.callCount(), 1);
});
