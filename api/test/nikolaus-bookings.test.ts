import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as geocoding from '../lib/geocoding';
import * as mails from '../lib/nikolaus-mails';
import * as mailQuota from '../lib/nikolaus-mail-quota';
import * as db from '../lib/db';
import type { NikolausMailPermit } from '../lib/nikolaus-mail-quota';
import {
  BookingEmailExistsError,
  canResendLink,
  cancelBooking,
  confirmBooking,
  createBooking,
  deleteBooking,
  findBookingByToken,
  getBooking,
  getSlotAvailability,
  hashToken,
  isBlocking,
  rescheduleBooking,
  restorePreviousToken,
  rotateToken,
  setBookingTags,
  updateBookingDetails,
} from '../lib/nikolaus-bookings';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import { getDispoRows } from '../lib/nikolaus-dispo-list';
import { canChangeBooking, getPublicStatus } from '../lib/nikolaus-api';
import { getChangeDeadline, getNikolausSlots, localDateTimeToDate } from '../lib/nikolaus-config';
import lookupHandler from '../endpoints/nikolaus-manage-lookup';
import progressHandler from '../endpoints/nikolaus-manage-progress';
import resendHandler from '../endpoints/nikolaus-manage-resend-link';
import createHandler from '../endpoints/nikolaus-booking-create';
import { CancelNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-cancel';
import { UpdateNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-update';
import { RescheduleNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-reschedule';
import { ConfirmNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-confirm';
import { NikolausRescheduleEndpoint } from '../endpoints/intern-nikolaus-reschedule';
import { dbTest } from './fixtures/database';
import { setupSharedState } from './fixtures/shared-state';
import { FAMILY, insertBooking, insertDispo } from './fixtures/nikolaus-data';
import {
  TEST_SETTINGS,
  mockNikolausSettings,
  updateNikolausSettings,
} from './fixtures/nikolaus-settings';

const NOW = new Date('2026-12-01T12:00:00Z');
const SLOT = getNikolausSlots(TEST_SETTINGS)[0];
const TARGET = getNikolausSlots(TEST_SETTINGS)[1];

function details(email: string) {
  return { ...FAMILY, email };
}

/** Bookings at a fixed time without external services; the database is real. */
function setup(t: TestContext): void {
  setupSharedState(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(geocoding, 'geocodeAddress', async () => ({ found: false }));
  t.mock.method(mailQuota, 'reserveNikolausMailQuota', async () => ({}) as NikolausMailPermit);
}

function pendingUntil(date: Date) {
  return { status: 'Ausstehend', reserved_until: date, confirmed_at: null };
}

function post(path: string, body: unknown): HttpRequest {
  return new HttpRequest({
    method: 'POST',
    url: `http://localhost/api/${path}`,
    body: { string: JSON.stringify(body) },
  });
}

function staff(path: string, id: string, body: unknown): HttpRequest {
  return new HttpRequest({
    method: 'POST',
    url: `http://localhost/api/${path}`,
    params: { id },
    headers: {
      'x-ms-client-principal': Buffer.from(
        JSON.stringify({
          identityProvider: 'aad',
          userId: 'staff-test',
          userDetails: 'staff@example.test',
          userRoles: ['authenticated'],
        })
      ).toString('base64'),
    },
    body: { string: JSON.stringify(body) },
  });
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'warn', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

test('confirmation expiry and capacity grace have distinct exact boundaries', () => {
  const base = { reservedUntil: NOW } as NikolausBooking;
  const pending = { ...base, status: 'Ausstehend' } as NikolausBooking;
  assert.equal(getPublicStatus(pending, new Date(NOW.getTime() - 1)), 'pending');
  assert.equal(getPublicStatus(pending, NOW), 'expired');
  assert.equal(isBlocking(pending, NOW), true);
  assert.equal(isBlocking(pending, new Date(NOW.getTime() + 299_999)), true);
  assert.equal(isBlocking(pending, new Date(NOW.getTime() + 300_000)), false);
  assert.equal(isBlocking({ status: 'Ausstehend' } as NikolausBooking, NOW), false);
  assert.equal(isBlocking({ ...base, status: 'Storniert' } as NikolausBooking, NOW), false);
  assert.equal(
    isBlocking({ status: 'Bestaetigt' } as NikolausBooking, new Date('2027-01-01T00:00:00Z')),
    true
  );
});

test('online changes and link resends use their exact deadline boundaries', () => {
  const active = { status: 'Bestaetigt', slotKey: SLOT.key } as NikolausBooking;
  const deadline = getChangeDeadline(active.slotKey, TEST_SETTINGS);
  assert.equal(canChangeBooking(active, TEST_SETTINGS, new Date(deadline.getTime() - 1)), true);
  assert.equal(canChangeBooking(active, TEST_SETTINGS, deadline), false);
  assert.equal(canChangeBooking({ ...active, status: 'Storniert' }, TEST_SETTINGS, NOW), false);
  assert.equal(
    canChangeBooking({ ...active, slotKey: '2026-12-05T16:00' }, TEST_SETTINGS, NOW),
    false
  );
  const linked = { linkSentAt: NOW } as NikolausBooking;
  assert.equal(canResendLink(linked, new Date(NOW.getTime() + 899_999)), false);
  assert.equal(canResendLink(linked, new Date(NOW.getTime() + 900_000)), true);
});

dbTest(
  'availability counts confirmed and pending reservations, clamps overbooking and closes at Berlin midnight',
  async (t) => {
    setup(t);
    await insertBooking(SLOT.key);
    await insertBooking(SLOT.key, pendingUntil(NOW));
    await insertBooking(SLOT.key, { status: 'Storniert' });
    await insertBooking(SLOT.key, { status: 'Abgelaufen' });
    await insertBooking(SLOT.key, pendingUntil(new Date(NOW.getTime() - 300_000)));
    await insertBooking(SLOT.key);
    assert.equal((await getSlotAvailability(TEST_SETTINGS, NOW))[0].available, 0);
    assert.equal((await getSlotAvailability(TEST_SETTINGS, NOW))[1].available, TARGET.capacity);
    const midnight = localDateTimeToDate(SLOT.date, '00:00');
    const before = (await getSlotAvailability(TEST_SETTINGS, new Date(midnight.getTime() - 1)))[1];
    assert.equal(before.closed, false);
    assert.equal(before.available, TARGET.capacity);
    const closed = (await getSlotAvailability(TEST_SETTINGS, midnight))[1];
    assert.equal(closed.closed, true);
    assert.equal(closed.available, 0);
  }
);

dbTest('full slots reject new reservations without writing', async (t) => {
  setup(t);
  for (let i = 0; i < SLOT.capacity; i++) await insertBooking(SLOT.key);
  assert.deepEqual(await createBooking(details('new@example.test'), SLOT, TEST_SETTINGS, NOW), {
    ok: false,
    reason: 'SLOT_FULL',
  });
  const count = await db
    .getDb()
    .selectFrom('nikolaus.booking')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  assert.equal(Number(count.count), SLOT.capacity);
});

dbTest('concurrent reservations never exceed the capacity of a slot', async (t) => {
  setup(t);
  for (let i = 0; i < SLOT.capacity - 1; i++) await insertBooking(SLOT.key);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      createBooking(details(`race-${i}@example.test`), SLOT, TEST_SETTINGS, NOW)
    )
  );
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === 'SLOT_FULL').length, 5);
  assert.equal((await getSlotAvailability(TEST_SETTINGS, NOW))[0].available, 0);
});

dbTest(
  'concurrent reservations normalize e-mail addresses and keep one active booking',
  async (t) => {
    setup(t);
    const results = await Promise.all([
      createBooking(details('Family@Example.test'), SLOT, TEST_SETTINGS, NOW),
      createBooking(details(' family@example.TEST '), TARGET, TEST_SETTINGS, NOW),
      createBooking(details('family@example.test'), TARGET, TEST_SETTINGS, NOW),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(
      results.filter((result) => !result.ok && result.reason === 'EMAIL_EXISTS').length,
      2
    );
  }
);

dbTest('a reservation holds its place and token until it is confirmed', async (t) => {
  setup(t);
  const created = await createBooking(details('new@example.test'), SLOT, TEST_SETTINGS, NOW);
  assert.ok(created.ok);
  const booking = (await findBookingByToken(created.token))!;
  assert.equal(booking.id, created.id);
  assert.equal(booking.status, 'Ausstehend');
  assert.equal(booking.reservedUntil?.getTime(), created.reservedUntil.getTime());
  assert.equal(booking.geo.GeoGenauigkeit, 'nicht gefunden');
  const confirmed = await confirmBooking(booking, NOW);
  assert.equal(confirmed.status, 'Bestaetigt');
  assert.equal(confirmed.confirmedAt?.getTime(), NOW.getTime());
  assert.notEqual(confirmed.etag, booking.etag);
});

dbTest('rescheduling keeps the ID, data and tags and frees the old slot', async (t) => {
  setup(t);
  const { booking, token } = await insertBooking(SLOT.key, {
    internal_tags: JSON.stringify(['Wölflinge']),
  });
  await insertDispo(booking.id, SLOT.date, { slotKey: SLOT.key });
  const moved = await rescheduleBooking(booking, TARGET, NOW);
  assert.ok(moved.ok);
  assert.equal(moved.booking.id, booking.id);
  assert.equal(moved.booking.slotKey, TARGET.key);
  assert.deepEqual(moved.booking.internalTags, ['Wölflinge']);
  assert.equal(moved.booking.status, 'Bestaetigt');
  assert.equal(moved.booking.tokenHash, hashToken(token));
  assert.equal((await getSlotAvailability(TEST_SETTINGS, NOW))[0].available, SLOT.capacity);
  // The old Dispo row stays and shows the booking as moved
  assert.equal((await getDispoRows(SLOT.date))[0].slotKey, SLOT.key);
});

dbTest('rescheduling with a stale version or into a full slot changes nothing', async (t) => {
  setup(t);
  const { booking } = await insertBooking(SLOT.key);
  await setBookingTags(booking.id, ['Neu'], booking.etag);
  assert.deepEqual(await rescheduleBooking(booking, TARGET, NOW), {
    ok: false,
    reason: 'ALREADY_CHANGED',
  });
  const current = (await getBooking(booking.id))!;
  for (let i = 0; i < TARGET.capacity; i++) await insertBooking(TARGET.key);
  assert.deepEqual(await rescheduleBooking(current, TARGET, NOW), {
    ok: false,
    reason: 'SLOT_FULL',
  });
  assert.equal((await getBooking(booking.id))!.slotKey, SLOT.key);
});

dbTest('concurrent moves into the last free place keep exactly one', async (t) => {
  setup(t);
  for (let i = 0; i < TARGET.capacity - 1; i++) await insertBooking(TARGET.key);
  const first = (await insertBooking(SLOT.key)).booking;
  const second = (await insertBooking(SLOT.key)).booking;
  const results = await Promise.all([
    rescheduleBooking(first, TARGET, NOW),
    rescheduleBooking(second, TARGET, NOW),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal((await getSlotAvailability(TEST_SETTINGS, NOW))[1].available, 0);
});

dbTest('stale versions are rejected by every conditional write', async (t) => {
  setup(t);
  const { booking } = await insertBooking(SLOT.key);
  await setBookingTags(booking.id, ['Neu'], booking.etag);
  for (const write of [
    () => confirmBooking(booking, NOW),
    () => cancelBooking(booking, NOW),
    () => setBookingTags(booking.id, ['Alt'], booking.etag),
    () => updateBookingDetails(booking, details('family@example.test'), NOW),
    () => deleteBooking(booking.id, booking.etag),
    () => rotateToken(booking, NOW),
  ]) {
    await assert.rejects(write(), db.VersionConflictError);
  }
  await assert.rejects(setBookingTags(booking.id, [], '*'), db.VersionConflictError);
  await assert.rejects(setBookingTags('999999', [], booking.etag), db.RecordNotFoundError);
  assert.deepEqual((await getBooking(booking.id))!.internalTags, ['Neu']);
});

dbTest('changing the e-mail address to one of another active booking is refused', async (t) => {
  setup(t);
  const { booking } = await insertBooking(SLOT.key, { email: 'own@example.test' });
  await insertBooking(TARGET.key, { email: 'taken@example.test' });
  await assert.rejects(
    updateBookingDetails(booking, details('TAKEN@example.test'), NOW),
    BookingEmailExistsError
  );
  const updated = await updateBookingDetails(booking, details('new@example.test'), NOW);
  assert.equal(updated.email, 'new@example.test');
  assert.equal(updated.changedAt?.getTime(), NOW.getTime());
});

dbTest('a new link invalidates the old one and a failed mail restores it', async (t) => {
  setup(t);
  const { booking, token } = await insertBooking(SLOT.key);
  const fresh = await rotateToken(booking, NOW);
  assert.ok(fresh);
  assert.equal(await findBookingByToken(token), undefined);
  const rotated = (await findBookingByToken(fresh))!;
  assert.equal(canResendLink(rotated, NOW), false);
  await restorePreviousToken(booking, fresh);
  const restored = (await findBookingByToken(token))!;
  assert.equal(restored.id, booking.id);
  assert.equal(canResendLink(restored, NOW), true);
});

dbTest('parallel resend requests reserve one token and send at most one mail', async (t) => {
  setup(t);
  await insertBooking(SLOT.key, { email: 'family@example.test' });
  const sent = t.mock.method(mails, 'sendManageLinkMail', async () => undefined);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      resendHandler(
        post('nikolaus/manage/resend-link', { email: 'family@example.test' }),
        context(t)
      )
    )
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(sent.mock.callCount(), 1);
});

dbTest('deleting a booking removes its Dispo rows', async (t) => {
  setup(t);
  const { booking } = await insertBooking(SLOT.key);
  await insertDispo(booking.id, SLOT.date);
  await deleteBooking(booking.id, booking.etag);
  assert.deepEqual(await getDispoRows(SLOT.date), []);
});

dbTest('the public booking flow reserves, confirms and moves a booking', async (t) => {
  setup(t);
  await updateNikolausSettings({ publicActive: true });
  let token = '';
  t.mock.method(mails, 'sendConfirmationRequestMail', async (data: { token: string }) => {
    token = data.token;
  });
  t.mock.method(mails, 'sendBookingConfirmedMail', async () => undefined);
  t.mock.method(mails, 'sendBookingChangedMail', async () => undefined);
  const created = await createHandler(
    post('nikolaus/bookings', { ...details('flow@example.test'), slot: SLOT.key }),
    context(t)
  );
  assert.equal(created.status, 201);
  const pending = (await findBookingByToken(token))!;
  const confirmed = await ConfirmNikolausBookingEndpoint(
    post('nikolaus/manage/confirm', { token, etag: pending.etag }),
    context(t)
  );
  assert.equal(confirmed.status, 200);
  const { etag } = confirmed.jsonBody as { etag: string };
  const moved = await RescheduleNikolausBookingEndpoint(
    post('nikolaus/manage/reschedule', { token, etag, slot: TARGET.key }),
    context(t)
  );
  assert.equal(moved.status, 200);
  const stale = await RescheduleNikolausBookingEndpoint(
    post('nikolaus/manage/reschedule', { token, etag, slot: SLOT.key }),
    context(t)
  );
  assert.equal(stale.status, 409);
  const booking = (await findBookingByToken(token))!;
  assert.equal(booking.slotKey, TARGET.key);
  assert.equal(booking.status, 'Bestaetigt');
});

dbTest('staff moves keep the booking ID and answer stale views with a conflict', async (t) => {
  setup(t);
  t.mock.method(mails, 'sendStaffRescheduleMail', async () => undefined);
  const { booking } = await insertBooking(SLOT.key);
  const body = { fromSlot: SLOT.key, toSlot: TARGET.key, etag: booking.etag, message: '' };
  const moved = await NikolausRescheduleEndpoint(
    staff('intern/pflege/nikolaus-verlegen', booking.id, body),
    context(t)
  );
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.jsonBody, { id: booking.id, mailSent: true });
  const again = await NikolausRescheduleEndpoint(
    staff('intern/pflege/nikolaus-verlegen', booking.id, body),
    context(t)
  );
  assert.equal(again.status, 409);
});

dbTest(
  'public management responses forbid storage for success, validation, conflict and unexpected errors',
  async (t) => {
    setup(t);
    const { booking, token } = await insertBooking(SLOT.key);
    const cases = [
      [lookupHandler, { token }, 200],
      [lookupHandler, { token: 'invalid' }, 404],
      [UpdateNikolausBookingEndpoint, { token, etag: booking.etag }, 400],
      [ConfirmNikolausBookingEndpoint, { token, etag: 'stale' }, 409],
      [resendHandler, { email: 'invalid' }, 400],
    ] as const;
    for (const [handler, body, status] of cases) {
      const response = await handler(post('nikolaus/manage/test', body), context(t));
      assert.equal(response.status, status);
      assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
    }
    t.mock.method(db, 'getDb', () => {
      throw new Error('Unexpected database failure');
    });
    mockNikolausSettings(t, { publicActive: true });
    for (const handler of [
      lookupHandler,
      progressHandler,
      ConfirmNikolausBookingEndpoint,
      CancelNikolausBookingEndpoint,
      UpdateNikolausBookingEndpoint,
      RescheduleNikolausBookingEndpoint,
      resendHandler,
      createHandler,
    ]) {
      const response = await handler(
        post('nikolaus/manage/test', {
          ...details('family@example.test'),
          token,
          etag: booking.etag,
          slot: booking.slotKey,
        }),
        context(t)
      );
      assert.equal(response.status, 500);
      assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
    }
  }
);
