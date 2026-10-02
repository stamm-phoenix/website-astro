import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext, type HttpResponseInit } from '@azure/functions';
import createHandler from '../endpoints/nikolaus-booking-create';
import resendHandler from '../endpoints/nikolaus-manage-resend-link';
import geocodeHandler from '../endpoints/nikolaus-geocode';
import confirmHandler from '../endpoints/nikolaus-manage-confirm';
import cancelHandler from '../endpoints/nikolaus-manage-cancel';
import updateHandler from '../endpoints/nikolaus-manage-update';
import rescheduleHandler from '../endpoints/nikolaus-manage-reschedule';
import lookupHandler from '../endpoints/nikolaus-manage-lookup';
import progressHandler from '../endpoints/nikolaus-manage-progress';
import { NikolausCancelEndpoint } from '../endpoints/intern-nikolaus-cancel';
import { NikolausRescheduleEndpoint } from '../endpoints/intern-nikolaus-reschedule';
import { NikolausMessageEndpoint } from '../endpoints/intern-nikolaus-message';
import { NikolausDispoSave } from '../endpoints/intern-nikolaus-dispo';
import { NikolausFahrtVisit } from '../endpoints/intern-nikolaus-fahrt';
import { NikolausStufenDecision } from '../endpoints/intern-nikolaus-stufen';
import {
  NikolausHelfendeCollection,
  NikolausHelfendeItem,
  NikolausBookingTags,
  NikolausEinteilungSave,
} from '../endpoints/intern-nikolaus-helfende';
import { pflegeHandler } from '../lib/pflege-api';
import { withNikolausWriteHandling } from '../lib/nikolaus-api';
import { NIKOLAUS_WRITE_GATE_KEY } from '../lib/nikolaus-write-gate';
import { readNikolausState } from '../lib/nikolaus-state';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as geocoding from '../lib/geocoding';
import * as graphMail from '../lib/mail';
import * as bookings from '../lib/nikolaus-bookings';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import { setupSharedState } from './fixtures/shared-state';

const MAINTENANCE = {
  schema: 1,
  writers: [],
  maintenance: {
    owner: 'test-cleanup',
    startedAt: '2026-10-02T12:00:00Z',
  },
};
const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

type Handler = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

const PUBLIC_WRITES: [string, Handler][] = [
  ['create', createHandler],
  ['resend', resendHandler],
  ['geocode', geocodeHandler],
  ['confirm', confirmHandler],
  ['cancel', cancelHandler],
  ['update', updateHandler],
  ['reschedule', rescheduleHandler],
];
const STAFF_WRITES: [string, string, Handler][] = [
  ['cancel', 'POST', NikolausCancelEndpoint],
  ['reschedule', 'POST', NikolausRescheduleEndpoint],
  ['message', 'POST', NikolausMessageEndpoint],
  ['dispo', 'PUT', NikolausDispoSave],
  ['fahrt', 'POST', NikolausFahrtVisit],
  ['stufen', 'POST', NikolausStufenDecision],
  ['helper-create', 'POST', NikolausHelfendeCollection],
  ['helper-update', 'PATCH', NikolausHelfendeItem],
  ['helper-delete', 'DELETE', NikolausHelfendeItem],
  ['tags', 'PUT', NikolausBookingTags],
  ['einteilung', 'PUT', NikolausEinteilungSave],
];

function request(method = 'POST', principal?: unknown, token = ''): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/nikolaus/test',
    method,
    headers:
      principal === undefined
        ? {}
        : { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') },
    params: { id: '1' },
    body: method === 'GET' ? undefined : { string: JSON.stringify({ token }) },
  });
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

function maintenanceResponse(
  response: HttpResponseInit,
  expectedOwner: string | null = 'test-cleanup'
): void {
  assert.equal(response.status, 503);
  assert.equal((response.jsonBody as { code: string }).code, 'MAINTENANCE');
  const headers = new Headers(response.headers);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('x-nikolaus-write-gate'), 'v1');
  assert.equal(headers.get('x-nikolaus-maintenance-owner'), expectedOwner);
}

test('every public Nikolaus mutation and geocoding stop before domain reads or sends during cleanup', async (t) => {
  const state = setupSharedState(t);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, MAINTENANCE);
  const readBooking = t.mock.method(sharePoint, 'getSharePointListItem', async () => {
    throw new Error('Must not read booking');
  });
  const locate = t.mock.method(geocoding, 'geocodeAddress', async () => ({ found: false }));
  const mail = t.mock.method(graphMail, 'sendMail', async () => undefined);
  for (const [name, handler] of PUBLIC_WRITES) {
    const response = await handler(request(), context(t));
    maintenanceResponse(response);
    assert.equal(readBooking.mock.callCount(), 0, name);
    assert.equal(locate.mock.callCount(), 0, name);
    assert.equal(mail.mock.callCount(), 0, name);
  }
  assert.deepEqual(state.writes, { creates: 0, updates: 0, deletes: 0 });
});

test('every authenticated staff Nikolaus mutation stops during cleanup without changing data', async (t) => {
  const state = setupSharedState(t);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, MAINTENANCE);
  for (const [, method, handler] of STAFF_WRITES)
    maintenanceResponse(await handler(request(method, PRINCIPAL), context(t)));
  assert.deepEqual(state.writes, { creates: 0, updates: 0, deletes: 0 });
});

test('anonymous and wrong-tenant staff mutations never access the shared gate', async (t) => {
  setupSharedState(t);
  const read = t.mock.method(sharePoint, 'getSharePointListItems', async () => {
    throw new Error('Unauthorized gate access');
  });
  for (const [, method, handler] of STAFF_WRITES) {
    assert.equal((await handler(request(method), context(t))).status, 401);
    assert.equal(
      (await handler(request(method, { ...PRINCIPAL, identityProvider: 'github' }), context(t)))
        .status,
      401
    );
    assert.equal(
      (
        await handler(
          request(method, { ...PRINCIPAL, claims: [{ typ: 'tid', val: 'wrong-tenant' }] }),
          context(t)
        )
      ).status,
      403
    );
  }
  assert.equal(read.mock.callCount(), 0);
});

test('shared gate outage denies public and authenticated staff writes with the deployment marker', async (t) => {
  setupSharedState(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => {
    throw new Error('State unavailable');
  });
  for (const [, handler] of PUBLIC_WRITES)
    maintenanceResponse(await handler(request(), context(t)), null);
  for (const [, method, handler] of STAFF_WRITES)
    maintenanceResponse(await handler(request(method, PRINCIPAL), context(t)), null);
});

test('read-only management and staff GET operations do not register as writers', async (t) => {
  const state = setupSharedState(t);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, MAINTENANCE);
  const read = t.mock.method(sharePoint, 'getSharePointListItems', async () => {
    throw new Error('Read-only operation accessed gate');
  });
  const token = 'mock-management-token-for-read-only-tests';
  const booking: NikolausBooking = {
    id: '1',
    etag: '"1,1"',
    familyName: 'Testfamilie',
    email: 'family@example.test',
    phone: '0123456789',
    street: 'Testweg 1',
    postalCode: '83620',
    city: 'Testort',
    addressNotes: '',
    childrenCount: 2,
    withKrampus: false,
    hidingPlace: 'Tür',
    notes: '',
    slotKey: '2026-12-05T17:00',
    status: 'Bestaetigt',
    geo: { Breitengrad: '', Laengengrad: '', GeoGenauigkeit: '' },
    internalTags: [],
    rejectedStufen: [],
    tokenHash: bookings.hashToken(token),
    reservedUntil: undefined,
    confirmedAt: new Date('2026-10-01T12:00:00Z'),
    changedAt: undefined,
    linkSentAt: undefined,
  };
  t.mock.method(bookings, 'findBookingByToken', async () => booking);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-02T12:00:00Z') });
  for (const handler of [lookupHandler, progressHandler]) {
    const response = await handler(request('POST', undefined, token), context(t));
    assert.equal(response.status, 200);
    assert.equal(new Headers(response.headers).has('x-nikolaus-write-gate'), false);
  }
  const handler = pflegeHandler('nikolaus-read', async () => ({ status: 200 }));
  assert.equal((await handler(request('GET', PRINCIPAL), context(t))).status, 200);
  const unrelated = pflegeHandler('qa', async () => ({ status: 204 }));
  assert.equal((await unrelated(request('POST', PRINCIPAL), context(t))).status, 204);
  assert.equal(read.mock.callCount(), 0);
});

test('admission spans the entire handler and unexpected errors retain no-store and deployment marker', async (t) => {
  setupSharedState(t);
  let observed = 0;
  const handler = withNikolausWriteHandling(async () => {
    const state = (await readNikolausState(NIKOLAUS_WRITE_GATE_KEY))?.data as {
      writers: unknown[];
    };
    observed = state.writers.length;
    throw new Error('Simulated handler failure');
  });
  const response = await handler(request(), context(t));
  assert.equal(observed, 1);
  assert.equal(response.status, 500);
  assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
  assert.equal(new Headers(response.headers).get('x-nikolaus-write-gate'), 'v1');
  const state = (await readNikolausState(NIKOLAUS_WRITE_GATE_KEY))?.data as { writers: unknown[] };
  assert.equal(state.writers.length, 0);
  const staffHandler = pflegeHandler('nikolaus-test', async () => {
    throw new Error('Simulated staff failure');
  });
  const staffResponse = await staffHandler(request('POST', PRINCIPAL), context(t));
  assert.equal(staffResponse.status, 500);
  assert.equal(new Headers(staffResponse.headers).get('cache-control'), 'no-store');
  assert.equal(new Headers(staffResponse.headers).get('x-nikolaus-write-gate'), 'v1');
});
