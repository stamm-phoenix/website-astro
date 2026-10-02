import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as environment from '../lib/environment';
import * as geocoding from '../lib/geocoding';
import * as mails from '../lib/nikolaus-mails';
import * as mailQuota from '../lib/nikolaus-mail-quota';
import * as writeGate from '../lib/nikolaus-write-gate';
import * as durableState from '../lib/nikolaus-state';
import type { NikolausMailPermit } from '../lib/nikolaus-mail-quota';
import {
  canResendLink,
  cancelBooking,
  confirmBooking,
  updateBookingDetails,
  restorePreviousToken,
  deleteBooking,
  getBooking,
  getAllBookings,
  getAllBookingRecords,
  findBookingByToken,
  setBookingTags,
  rotateToken,
  createBooking,
  dateFields,
  detailFields,
  getSlotAvailability,
  hashToken,
  isBlocking,
  rescheduleBooking,
} from '../lib/nikolaus-bookings';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import lookupHandler from '../endpoints/nikolaus-manage-lookup';
import progressHandler from '../endpoints/nikolaus-manage-progress';
import resendHandler from '../endpoints/nikolaus-manage-resend-link';
import createHandler from '../endpoints/nikolaus-booking-create';
import { canChangeBooking, getPublicStatus } from '../lib/nikolaus-api';
import {
  NIKOLAUS_CONFIG,
  getChangeDeadline,
  getNikolausSlots,
  localDateTimeToDate,
} from '../lib/nikolaus-config';
import { CancelNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-cancel';
import { UpdateNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-update';
import { RescheduleNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-reschedule';
import { NikolausCancelEndpoint } from '../endpoints/intern-nikolaus-cancel';
import { NikolausRescheduleEndpoint } from '../endpoints/intern-nikolaus-reschedule';
import { ResendNikolausLinkEndpoint } from '../endpoints/nikolaus-manage-resend-link';
import { ConfirmNikolausBookingEndpoint } from '../endpoints/nikolaus-manage-confirm';
import { NikolausBookingTags } from '../endpoints/intern-nikolaus-helfende';
import { GetInternNikolausBookingsEndpoint } from '../endpoints/intern-nikolaus-bookings';
import type { StaffBooking } from '../lib/nikolaus-api';

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
  t.mock.method(mailQuota, 'reserveNikolausMailQuota', async () => ({}) as NikolausMailPermit);
  // These tests isolate booking CAS races; admission is covered by write-gate HTTP tests.
  t.mock.method(writeGate, 'runWithNikolausWriteGate', async (handler: () => Promise<unknown>) =>
    handler()
  );
  const operations = new Map<string, unknown>();
  t.mock.method(durableState, 'readNikolausState', async (key: string) =>
    operations.has(key)
      ? { id: key, key, etag: '"state,1"', data: structuredClone(operations.get(key)) }
      : undefined
  );
  t.mock.method(durableState, 'listNikolausStates', async (prefix: string) =>
    [...operations]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, data]) => ({
        id: key,
        key,
        etag: '"state,1"',
        data: structuredClone(data),
      }))
  );
  t.mock.method(
    durableState,
    'mutateNikolausState',
    async (
      key: string,
      parse: (value: unknown) => unknown,
      change: (value: unknown) => unknown
    ) => {
      const next = change(parse(structuredClone(operations.get(key))));
      if (next !== undefined) operations.set(key, structuredClone(next));
      return next;
    }
  );
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
        ...dateFields('LinkGesendetAm', item.linkSentAt),
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
    'createSharePointListItemWithVersion',
    async (_list: string, fields: Record<string, unknown>) => {
      const id = String(nextId++);
      rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
      return { id, etag: `"${id},1"` };
    }
  );
  const remove = t.mock.method(
    sharePoint,
    'deleteSharePointListItem',
    async (_list: string, id: string, etag?: string) => {
      const row = rows.get(id);
      if (!row) throw { statusCode: 404 };
      if (etag && row.eTag !== etag) throw { statusCode: 412 };
      rows.delete(id);
    }
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (_list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      const row = rows.get(id);
      if (!row) throw { statusCode: 404 };
      if (etag && row.eTag !== etag) throw { statusCode: 412 };
      Object.assign(row.fields, fields);
      const version = Number((JSON.parse(row.eTag) as string).split(',')[1]);
      row.eTag = JSON.stringify(`${id},${version + 1}`);
    }
  );
  const sent = t.mock.method(mails, 'sendBookingConfirmedMail', async () => undefined);
  return { rows, read, create, remove, update, sent, operations };
}

test('resend during a provisional move cannot defeat a successful original cancellation', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  const resend = t.mock.method(mails, 'sendManageLinkMail', async () => undefined);
  let concurrent = false;
  state.remove.mock.mockImplementation(async (_list: string, id: string, etag?: string) => {
    if (id === original.id && !concurrent) {
      concurrent = true;
      const response = await ResendNikolausLinkEndpoint(
        post('nikolaus/manage/resend-link', { email: original.email }),
        new InvocationContext()
      );
      assert.equal(response.status, 200);
      await cancelBooking((await getBooking(original.id))!, NOW);
    }
    const row = state.rows.get(id);
    if (!row) throw { statusCode: 404 };
    if (row.eTag !== etag) throw { statusCode: 412 };
    state.rows.delete(id);
  });
  let result: Awaited<ReturnType<typeof rescheduleBooking>> | undefined;
  try {
    result = await rescheduleBooking(original, TARGET, NOW);
  } catch (error: unknown) {
    assert.equal((error as { statusCode?: number }).statusCode, 412);
  }
  assert.equal(resend.mock.callCount(), 1);
  assert.deepEqual([...state.rows.keys()], [original.id]);
  assert.equal(state.rows.get(original.id)!.fields.Status, 'Storniert');
  assert.notEqual(result?.ok, true);
});

test('tag responses return contact fields from the same version after an intervening family update', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.update.mock.mockImplementation(
    async (_list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      const row = state.rows.get(id)!;
      assert.equal(row.eTag, etag);
      Object.assign(row.fields, fields);
      row.fields.Telefon = 'new family phone';
      row.eTag = '"1,3"';
    }
  );
  const request = new HttpRequest({
    method: 'PUT',
    url: 'http://localhost/api/intern/pflege/nikolaus-bookings/1/tags',
    params: { id: original.id },
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
    body: { string: JSON.stringify({ tags: ['Testtag'], etag: original.etag }) },
  });
  const response = await NikolausBookingTags(request, new InvocationContext());
  assert.equal(response.status, 200);
  const saved = response.jsonBody as { booking: StaffBooking };
  assert.equal(saved.booking?.phone, 'new family phone');
  assert.equal(saved.booking.etag, '"1,3"');
  assert.deepEqual(saved.booking.internalTags, ['Testtag']);
});

function staffTagRequest(id: string, etag: string): HttpRequest {
  return new HttpRequest({
    method: 'PUT',
    url: `http://localhost/api/intern/pflege/nikolaus-bookings/${id}/tags`,
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
    body: { string: JSON.stringify({ tags: ['Unexpected tag'], etag }) },
  });
}

test('a hidden move copy reserves capacity but cannot be loaded or tagged even with its exact version', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    state.rows.set('2', { id: '2', eTag: '"2,1"', fields: structuredClone(fields) });
    assert.deepEqual(
      (await getAllBookings()).map((b) => b.id),
      ['1']
    );
    assert.equal((await findBookingByToken(TOKEN))!.id, '1');
    assert.equal(await getBooking('2'), undefined);
    assert.equal(
      (await getSlotAvailability(NOW)).find((s) => s.key === TARGET.key)!.available,
      TARGET.capacity - 1
    );
    assert.equal(
      (await NikolausBookingTags(staffTagRequest('2', '"2,1"'), new InvocationContext())).status,
      404
    );
    assert.equal(state.rows.get('2')!.fields.InterneTags, '');
    const staff = await GetInternNikolausBookingsEndpoint(
      new HttpRequest({
        method: 'GET',
        url: 'http://localhost/api/intern/nikolaus/bookings',
        headers: {
          'x-ms-client-principal': staffTagRequest('2', '"2,1"').headers.get(
            'x-ms-client-principal'
          )!,
        },
      })
    );
    const overview = staff.jsonBody as {
      bookings: StaffBooking[];
      slots: { key: string; taken: number }[];
    };
    assert.deepEqual(
      overview.bookings.map((b) => b.id),
      ['1']
    );
    assert.equal(overview.slots.find((s) => s.key === TARGET.key)!.taken, 1);
    return { id: '2', etag: '"2,1"' };
  });
  const result = await rescheduleBooking(original, TARGET, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(
    (await getAllBookings()).map((b) => b.id),
    ['2']
  );
});

test('a committed copy sheds its marker and returns the current booking version', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  const result = await rescheduleBooking(original, TARGET, NOW);
  assert.ok(result.ok);
  assert.equal(state.rows.get(result.booking.id)!.fields.TokenHash, original.tokenHash);
  assert.equal(result.booking.etag, state.rows.get(result.booking.id)!.eTag);
  assert.equal(result.booking.move, undefined);
  const scan = t.mock.method(durableState, 'listNikolausStates', async () => {
    throw new Error('A normal booking must not scan unrelated journals');
  });
  assert.equal((await getBooking(result.booking.id))!.id, result.booking.id);
  assert.equal(scan.mock.callCount(), 0);
});

for (const statusCode of [412, 503]) {
  test(`copy marker cleanup handles storage response ${statusCode} without unconditional writes`, async (t) => {
    const original = booking();
    const state = setup(t, [original]);
    const update = sharePoint.updateSharePointListItem;
    const cleanup = t.mock.method(
      sharePoint,
      'updateSharePointListItem',
      async (list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
        if (id !== original.id && fields.TokenHash === original.tokenHash) {
          assert.equal(etag, state.rows.get(id)!.eTag);
          throw Object.assign(new Error('Marker cleanup failed'), { statusCode });
        }
        return update(list, id, fields, etag);
      }
    );
    if (statusCode === 412) {
      assert.equal((await rescheduleBooking(original, TARGET, NOW)).ok, true);
    } else {
      await assert.rejects(rescheduleBooking(original, TARGET, NOW), { statusCode });
    }
    assert.ok(String(state.rows.get('2')!.fields.TokenHash).startsWith('move-copy:'));
    assert.equal((await getBooking('2'))!.id, '2');
    cleanup.mock.restore();
    const retry = await rescheduleBooking(original, TARGET, NOW);
    assert.ok(retry.ok);
    assert.equal(retry.booking.move, undefined);
    assert.equal(retry.booking.etag, state.rows.get('2')!.eTag);
    assert.equal(state.rows.get('2')!.fields.TokenHash, original.tokenHash);
  });
}

test('a retry adopts a copy whose POST committed before its response was lost', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    state.rows.set('2', { id: '2', eTag: '"2,1"', fields: structuredClone(fields) });
    throw new Error('copy POST committed, response lost');
  });
  await assert.rejects(rescheduleBooking(original, TARGET, NOW), /response lost/);
  assert.deepEqual(
    (await getAllBookings()).map((b) => b.id),
    ['1']
  );
  const result = await rescheduleBooking((await getBooking('1'))!, TARGET, NOW);
  assert.equal(result.ok, true);
  assert.equal(state.create.mock.callCount(), 1);
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal((await findBookingByToken(TOKEN))!.id, '2');
});

test('a committed move remains manageable after final journal persistence crashes and replay converges', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  let failCommit = true;
  t.mock.method(
    durableState,
    'mutateNikolausState',
    async (
      key: string,
      parse: (value: unknown) => unknown,
      change: (value: unknown) => unknown
    ) => {
      const next = change(parse(structuredClone(state.operations.get(key))));
      if (failCommit && (next as { phase?: string } | undefined)?.phase === 'committed') {
        throw new Error('process stopped before final journal write');
      }
      if (next !== undefined) state.operations.set(key, structuredClone(next));
      return next;
    }
  );
  await assert.rejects(rescheduleBooking(original, TARGET, NOW), /process stopped/);
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal((await findBookingByToken(TOKEN))!.id, '2');
  failCommit = false;
  const replay = await rescheduleBooking(original, TARGET, NOW);
  assert.equal(replay.ok, true);
  assert.equal(state.create.mock.callCount(), 1);
  const moved = (await getBooking('2'))!;
  await updateBookingDetails(moved, { ...moved, phone: 'manageable after crash' }, NOW);
  assert.equal((await getBooking('2'))!.phone, 'manageable after crash');
  assert.equal((state.operations.get('booking-move:1') as { phase: string }).phase, 'committed');
});

test('a delayed old-version copy cannot displace the journal winner after another move commits', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  let firstCreate!: () => void;
  const entering = new Promise<void>((resolve) => {
    firstCreate = resolve;
  });
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let nextId = 2;
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    if (++calls === 1) {
      firstCreate();
      await paused;
    }
    const id = String(nextId++);
    state.rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
    return { id, etag: `"${id},1"` };
  });
  const staleMove = rescheduleBooking(original, TARGET, NOW);
  await entering;
  const source = (await getBooking('1'))!;
  await updateBookingDetails(source, { ...source, notes: 'new version wins' }, NOW);
  const winner = await rescheduleBooking((await getBooking('1'))!, getNikolausSlots()[2], NOW);
  assert.equal(winner.ok, true);
  release();
  assert.deepEqual(await staleMove, { ok: false, reason: 'ALREADY_CHANGED' });
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal((await getBooking('2'))!.notes, 'new version wins');
  assert.equal((await findBookingByToken(TOKEN))!.id, '2');
  assert.equal(
    (await getSlotAvailability(NOW)).find((s) => s.key === TARGET.key)!.available,
    TARGET.capacity
  );
  assert.equal((state.operations.get('booking-move:1') as { copyId: string }).copyId, '2');
});

test('failed cleanup of an aborted copy never blocks capacity or exposes it', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.remove.mock.mockImplementation(async (_list: string, id: string) => {
    if (id === '1') {
      await cancelBooking((await getBooking('1'))!, NOW);
      throw { statusCode: 412 };
    }
    throw { statusCode: 503 };
  });
  await assert.rejects(
    rescheduleBooking(original, TARGET, NOW),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 503
  );
  assert.equal((await getAllBookingRecords()).length, 2);
  assert.deepEqual(
    (await getAllBookings()).map((b) => b.id),
    ['1']
  );
  assert.equal(
    (await getSlotAvailability(NOW)).find((s) => s.key === TARGET.key)!.available,
    TARGET.capacity
  );
  assert.equal(await getBooking('2'), undefined);
});

test('a source claim without a journal can be replayed to a different target after a crash', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  t.mock.method(durableState, 'mutateNikolausState', async () => {
    throw new Error('crash before journal registration');
  });
  await assert.rejects(rescheduleBooking(original, TARGET, NOW), /crash before journal/);
  assert.equal(state.create.mock.callCount(), 0);
  assert.equal((await findBookingByToken(TOKEN))!.id, '1');
  t.mock.method(
    durableState,
    'mutateNikolausState',
    async (
      key: string,
      parse: (value: unknown) => unknown,
      change: (value: unknown) => unknown
    ) => {
      const next = change(parse(structuredClone(state.operations.get(key))));
      if (next !== undefined) state.operations.set(key, structuredClone(next));
      return next;
    }
  );
  const replay = await rescheduleBooking((await getBooking('1'))!, getNikolausSlots()[2], NOW);
  assert.equal(replay.ok, true);
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal((await getBooking('2'))!.slotKey, getNikolausSlots()[2].key);
});

test('a selected copy interrupted before source deletion can be replaced by another target safely', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  let stopped = false;
  t.mock.method(sharePoint, 'getSharePointListItem', async (_list: string, id: string) => {
    if (stopped && id === '1') throw new Error('process stopped during delete reconciliation');
    return structuredClone(state.rows.get(id));
  });
  state.remove.mock.mockImplementation(async () => {
    stopped = true;
    throw new Error('original delete never committed');
  });
  await assert.rejects(rescheduleBooking(original, TARGET, NOW), /process stopped/);
  stopped = false;
  assert.equal((state.operations.get('booking-move:1') as { phase: string }).phase, 'selected');
  assert.deepEqual([...state.rows.keys()], ['1', '2']);
  state.remove.mock.mockImplementation(async (_list: string, id: string, etag?: string) => {
    const row = state.rows.get(id);
    if (!row) throw { statusCode: 404 };
    if (row.eTag !== etag) throw { statusCode: 412 };
    state.rows.delete(id);
  });
  const replay = await rescheduleBooking((await getBooking('1'))!, getNikolausSlots()[2], NOW);
  assert.equal(replay.ok, true);
  assert.deepEqual([...state.rows.keys()], ['3']);
  assert.equal((await getBooking('3'))!.slotKey, getNikolausSlots()[2].key);
  assert.equal(
    (await getSlotAvailability(NOW)).find((s) => s.key === TARGET.key)!.available,
    TARGET.capacity
  );
});

test('an obsolete abort cannot delete a newer resumed move after a same-content source write', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  let enteredA!: () => void;
  let releaseA!: () => void;
  let enteredB!: () => void;
  let releaseB!: () => void;
  const readyA = new Promise<void>((resolve) => {
    enteredA = resolve;
  });
  const waitA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const readyB = new Promise<void>((resolve) => {
    enteredB = resolve;
  });
  const waitB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let sourceDeletes = 0;
  state.remove.mock.mockImplementation(async (_list: string, id: string, etag?: string) => {
    if (id === '1') {
      if (++sourceDeletes === 1) {
        enteredA();
        await waitA;
      } else {
        enteredB();
        await waitB;
      }
    }
    const row = state.rows.get(id);
    if (!row) throw { statusCode: 404 };
    if (row.eTag !== etag) throw { statusCode: 412 };
    state.rows.delete(id);
  });
  const moveA = rescheduleBooking(original, TARGET, NOW);
  await readyA;
  const source = (await getBooking('1'))!;
  await setBookingTags('1', [], source.etag);
  const moveB = rescheduleBooking((await getBooking('1'))!, TARGET, NOW);
  await readyB;
  releaseA();
  assert.deepEqual(await moveA, { ok: false, reason: 'ALREADY_CHANGED' });
  releaseB();
  const winner = await moveB;
  assert.equal(winner.ok, true);
  assert.equal(state.rows.size, 1);
  assert.equal((await findBookingByToken(TOKEN))!.slotKey, TARGET.key);
});

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
    return { id, etag: `"${id},1"` };
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
    return { id, etag: `"${id},1"` };
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
  let nextId = 2;
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    const id = String(nextId++);
    state.rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
    return { id, etag: `"${id},1"` };
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
      body: { string: JSON.stringify({ token: TOKEN, etag: state.rows.get('1')!.eTag }) },
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
      body: { string: JSON.stringify({ token: TOKEN, etag: state.rows.get('1')!.eTag }) },
    });
  assert.equal((await ConfirmNikolausBookingEndpoint(request(), context)).status, 200);
  assert.equal(state.rows.get('1')?.fields.Status, 'Bestaetigt');
  assert.equal(warn.mock.callCount(), 1);
  assert.equal((await ConfirmNikolausBookingEndpoint(request(), context)).status, 200);
  assert.equal(state.sent.mock.callCount(), 1);
  assert.equal(state.update.mock.callCount(), 1);
});

function post(path: string, body: Record<string, unknown>): HttpRequest {
  return new HttpRequest({
    method: 'POST',
    url: `https://example.test/api/${path}`,
    headers: { 'content-type': 'application/json' },
    body: { string: JSON.stringify(body) },
  });
}

test('parallel resend requests reserve one token and send at most one mail', async (t) => {
  const state = setup(t, [booking()]);
  const sent = t.mock.method(mails, 'sendManageLinkMail', async () => undefined);
  const responses = await Promise.all(
    [1, 2].map(() =>
      ResendNikolausLinkEndpoint(
        post('nikolaus/manage/resend-link', { email: 'family@example.test' }),
        new InvocationContext()
      )
    )
  );
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200]
  );
  assert.equal(sent.mock.callCount(), 1);
  assert.equal(state.update.mock.callCount(), 2);
});

test('failed mail rollback cannot overwrite a token rotated after its read', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.rows.get('1')!.fields.TokenHash = hashToken('failed-token');
  const readOne = t.mock.method(sharePoint, 'getSharePointListItem', async () => {
    const snapshot = structuredClone(state.rows.get('1'));
    state.rows.get('1')!.fields.TokenHash = hashToken('newer-token');
    state.rows.get('1')!.eTag = '"1,2"';
    return snapshot;
  });
  await restorePreviousToken(original, 'failed-token');
  assert.equal(state.rows.get('1')!.fields.TokenHash, hashToken('newer-token'));
  assert.equal(readOne.mock.callCount(), 1);
});

test('late confirmation cannot reactivate a concurrently cancelled reservation', async (t) => {
  const original = booking({
    status: 'Ausstehend',
    reservedUntil: new Date(NOW.getTime() + 60_000),
  });
  const state = setup(t, [original]);
  await cancelBooking(original, NOW);
  await assert.rejects(
    confirmBooking(original, NOW),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 412
  );
  assert.equal(state.rows.get('1')!.fields.Status, 'Storniert');
});

test('editing with a stale version preserves another actor details', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  await updateBookingDetails(original, { ...original, phone: '111' }, NOW);
  await assert.rejects(
    updateBookingDetails(original, { ...original, phone: '222' }, NOW),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 412
  );
  assert.equal(state.rows.get('1')!.fields.Telefon, '111');
});

test('rescheduling stale data retains the updated original and removes its copy', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  await updateBookingDetails(original, { ...original, notes: 'New information' }, NOW);
  assert.deepEqual(await rescheduleBooking(original, TARGET, NOW), {
    ok: false,
    reason: 'ALREADY_CHANGED',
  });
  assert.deepEqual([...state.rows.keys()], ['1']);
  assert.equal(state.rows.get('1')!.fields.Bemerkungen, 'New information');
});

for (const [name, handler] of [
  ['confirm', ConfirmNikolausBookingEndpoint],
  ['cancel', CancelNikolausBookingEndpoint],
  ['update', UpdateNikolausBookingEndpoint],
  ['reschedule', RescheduleNikolausBookingEndpoint],
] as const) {
  test(`${name} rejects missing, wildcard and stale client versions without writes or mail`, async (t) => {
    const state = setup(t, [booking({ etag: '"1,2"' })]);
    for (const etag of [undefined, '*', '"1,1"']) {
      const response = await handler(
        post(`nikolaus/manage/${name}`, { token: TOKEN, etag }),
        new InvocationContext()
      );
      assert.equal(response.status, 409);
      assert.equal((response.jsonBody as { code: string }).code, 'ALREADY_CHANGED');
    }
    assert.equal(state.update.mock.callCount(), 0);
    assert.equal(state.create.mock.callCount(), 0);
    assert.equal(state.sent.mock.callCount(), 0);
  });
}

test('confirmation maps a cancellation between load and write to a readable conflict', async (t) => {
  const original = booking({
    status: 'Ausstehend',
    reservedUntil: new Date(NOW.getTime() + 60_000),
  });
  const state = setup(t, [original]);
  state.read.mock.mockImplementation(async () => {
    const snapshot = structuredClone([...state.rows.values()]);
    await cancelBooking((await getBooking(original.id))!, NOW);
    return snapshot;
  });
  const response = await ConfirmNikolausBookingEndpoint(
    post('nikolaus/manage/confirm', {
      token: TOKEN,
      etag: original.etag,
    }),
    new InvocationContext()
  );
  assert.equal(response.status, 409);
  assert.equal(state.rows.get('1')!.fields.Status, 'Storniert');
  assert.equal(state.sent.mock.callCount(), 0);
});

test('mail failure rollback restores the previous token and permits an immediate retry', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  const sent = t.mock.method(mails, 'sendManageLinkMail', async () => {
    throw new Error('mail failed');
  });
  const context = new InvocationContext();
  t.mock.method(context, 'error', () => undefined);
  assert.equal(
    (
      await ResendNikolausLinkEndpoint(
        post('nikolaus/manage/resend-link', {
          email: original.email,
        }),
        context
      )
    ).status,
    502
  );
  assert.equal(state.rows.get('1')!.fields.TokenHash, original.tokenHash);
  assert.equal(canResendLink((await getBooking('1'))!, NOW), true);
  sent.mock.mockImplementation(async () => undefined);
  assert.equal(
    (
      await ResendNikolausLinkEndpoint(
        post('nikolaus/manage/resend-link', {
          email: original.email,
        }),
        context
      )
    ).status,
    200
  );
  assert.equal(sent.mock.callCount(), 2);
});

test('deletion cleanup with the initial version preserves a later confirmed booking', async (t) => {
  const original = booking({
    status: 'Ausstehend',
    reservedUntil: new Date(NOW.getTime() + 60_000),
  });
  const state = setup(t, [original]);
  await confirmBooking(original, NOW);
  await assert.rejects(
    deleteBooking(original.id, original.etag),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 412
  );
  assert.equal(state.rows.get('1')!.fields.Status, 'Bestaetigt');
});

test('reschedule cancellation during copy creation retains the cancelled original', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.create.mock.mockImplementation(async (_list: string, fields: Record<string, unknown>) => {
    state.rows.set('2', { id: '2', eTag: '"2,1"', fields: structuredClone(fields) });
    await cancelBooking((await getBooking(original.id))!, NOW);
    return { id: '2', etag: '"2,1"' };
  });
  assert.deepEqual(await rescheduleBooking(original, TARGET, NOW), {
    ok: false,
    reason: 'ALREADY_CHANGED',
  });
  assert.deepEqual([...state.rows.keys()], ['1']);
  assert.equal(state.rows.get('1')!.fields.Status, 'Storniert');
});

test('token reservations reject missing and wildcard versions before any write', async (t) => {
  const state = setup(t, [booking()]);
  for (const etag of ['', '*']) {
    await assert.rejects(
      rotateToken(booking({ etag }), NOW),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 412
    );
  }
  assert.equal(state.update.mock.callCount(), 0);
});

for (const [name, handler] of [
  ['cancel', NikolausCancelEndpoint],
  ['reschedule', NikolausRescheduleEndpoint],
] as const) {
  test(`staff ${name} rejects changed booking details even while the slot is unchanged`, async (t) => {
    const original = booking();
    const state = setup(t, [original]);
    await updateBookingDetails(original, { ...original, notes: 'New family information' }, NOW);
    const staffHeader = Buffer.from(
      JSON.stringify({
        identityProvider: 'aad',
        userId: 'staff-test',
        userDetails: 'staff@example.test',
        userRoles: ['authenticated'],
      })
    ).toString('base64');
    const request = new HttpRequest({
      method: 'POST',
      url: `https://example.test/api/intern/nikolaus/bookings/1/${name}`,
      params: { id: '1' },
      headers: { 'content-type': 'application/json', 'x-ms-client-principal': staffHeader },
      body: {
        string: JSON.stringify({
          etag: original.etag,
          fromSlot: original.slotKey,
          toSlot: TARGET.key,
        }),
      },
    });
    const response = await handler(request, new InvocationContext());
    assert.equal(response.status, 409);
    assert.equal(state.rows.get('1')!.fields.Status, 'Bestaetigt');
    assert.equal(state.rows.get('1')!.fields.Bemerkungen, 'New family information');
    assert.equal(state.create.mock.callCount(), 0);
    assert.equal(state.remove.mock.callCount(), 0);
  });
}

test('reschedule adopts the copy after a committed old-item delete loses its response', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.remove.mock.mockImplementation(async (_list: string, id: string, etag?: string) => {
    const row = state.rows.get(id);
    if (!row) throw { statusCode: 404 };
    if (etag && row.eTag !== etag) throw { statusCode: 412 };
    state.rows.delete(id);
    if (id === original.id) throw new Error('response lost after committing delete');
  });
  const result = await rescheduleBooking(original, TARGET, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal(state.rows.get('2')!.fields.SlotKey, TARGET.key);
});

test('resend sends the reserved link after a committed token update loses its response', async (t) => {
  const state = setup(t, [booking()]);
  const sent = t.mock.method(mails, 'sendManageLinkMail', async () => undefined);
  state.update.mock.mockImplementation(
    async (_list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      const row = state.rows.get(id)!;
      if (etag && row.eTag !== etag) throw { statusCode: 412 };
      Object.assign(row.fields, fields);
      row.eTag = '"1,2"';
      throw new Error('response lost after committing token rotation');
    }
  );
  const response = await ResendNikolausLinkEndpoint(
    post('nikolaus/manage/resend-link', {
      email: 'family@example.test',
    }),
    new InvocationContext()
  );
  assert.equal(response.status, 200);
  assert.equal(sent.mock.callCount(), 1);
  const delivered = sent.mock.calls[0].arguments[0];
  assert.ok(delivered);
  assert.equal(state.rows.get('1')!.fields.TokenHash, hashToken(delivered.token));
});

test('reschedule reconciliation preserves a replacement changed after the delete committed', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  state.remove.mock.mockImplementation(async (_list: string, id: string, etag?: string) => {
    const row = state.rows.get(id);
    if (!row) throw { statusCode: 404 };
    if (etag && row.eTag !== etag) throw { statusCode: 412 };
    state.rows.delete(id);
    if (id === original.id) {
      state.rows.get('2')!.fields.Bemerkungen = 'Updated replacement';
      state.rows.get('2')!.eTag = '"2,2"';
      throw new Error('response lost after committing delete');
    }
  });
  await assert.rejects(
    rescheduleBooking(original, TARGET, NOW),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 412
  );
  assert.deepEqual([...state.rows.keys()], ['2']);
  assert.equal(state.rows.get('2')!.fields.Bemerkungen, 'Updated replacement');
});

test('public management responses forbid storage for success, validation, conflict and unexpected errors', async (t) => {
  const original = booking();
  const state = setup(t, [original]);
  const context = new InvocationContext();
  t.mock.method(context, 'error', () => undefined);
  const cases = [
    [lookupHandler, { token: TOKEN }, 200],
    [lookupHandler, { token: 'invalid' }, 404],
    [UpdateNikolausBookingEndpoint, { token: TOKEN, etag: original.etag }, 400],
    [ConfirmNikolausBookingEndpoint, { token: TOKEN, etag: 'stale' }, 409],
    [resendHandler, { email: 'invalid' }, 400],
  ] as const;
  for (const [handler, body, status] of cases) {
    const response = await handler(post('nikolaus/manage/test', body), context);
    assert.equal(response.status, status);
    assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
  }
  state.read.mock.mockImplementation(async () => {
    throw new Error('Unexpected SharePoint failure');
  });
  const active = NIKOLAUS_CONFIG.publicActive;
  NIKOLAUS_CONFIG.publicActive = true;
  t.after(() => {
    NIKOLAUS_CONFIG.publicActive = active;
  });
  const handlers = [
    lookupHandler,
    progressHandler,
    ConfirmNikolausBookingEndpoint,
    CancelNikolausBookingEndpoint,
    UpdateNikolausBookingEndpoint,
    RescheduleNikolausBookingEndpoint,
    resendHandler,
    createHandler,
  ];
  for (const handler of handlers) {
    const response = await handler(
      post('nikolaus/manage/test', {
        ...original,
        token: TOKEN,
        etag: original.etag,
        slot: original.slotKey,
      }),
      context
    );
    assert.equal(response.status, 500);
    assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
  }
});
