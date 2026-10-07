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
import * as db from '../lib/db';
import * as geocoding from '../lib/geocoding';
import * as graphMail from '../lib/mail';
import * as bookings from '../lib/nikolaus-bookings';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import GetInternNikolausBookingsEndpoint from '../endpoints/intern-nikolaus-bookings';
import { setupSharedState } from './fixtures/shared-state';
import { mockNikolausSettings } from './fixtures/nikolaus-settings';

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

function maintenanceResponse(response: HttpResponseInit): void {
  assert.equal(response.status, 503);
  assert.equal((response.jsonBody as { code: string }).code, 'MAINTENANCE');
  assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
}

/** Fails the test if a handler touches the database. */
function forbidDatabase(t: TestContext) {
  return t.mock.method(db, 'getDb', () => {
    throw new Error('Must not access the database');
  });
}

test('maintenance mode blocks all HTTP mutations before database, provider or mail access', async (t) => {
  setupSharedState(t);
  mockNikolausSettings(t, { maintenance: true, publicActive: true });
  const database = forbidDatabase(t);
  const locate = t.mock.method(geocoding, 'geocodeAddress', async () => ({ found: false }));
  const mail = t.mock.method(graphMail, 'sendMail', async () => undefined);
  // Valid resend input proves maintenance stops the quota/lookup/mail flow itself.
  const resend = new HttpRequest({
    url: 'http://localhost/api/nikolaus/manage/resend-link',
    method: 'POST',
    body: { string: JSON.stringify({ email: 'family@example.test' }) },
  });
  maintenanceResponse(await resendHandler(resend, context(t)));
  for (const [, handler] of PUBLIC_WRITES)
    maintenanceResponse(await handler(request(), context(t)));
  for (const [, method, handler] of STAFF_WRITES)
    maintenanceResponse(await handler(request(method, PRINCIPAL), context(t)));
  assert.equal(database.mock.callCount(), 0);
  assert.equal(locate.mock.callCount(), 0);
  assert.equal(mail.mock.callCount(), 0);
});

test('switched-off staff modules refuse all requests, the Steuerung stays reachable', async (t) => {
  setupSharedState(t);
  mockNikolausSettings(t, { staffActive: false });
  const database = forbidDatabase(t);
  for (const [, method, handler] of STAFF_WRITES) {
    const response = await handler(request(method, PRINCIPAL), context(t));
    assert.equal(response.status, 403);
    assert.equal((response.jsonBody as { code: string }).code, 'NIKOLAUS_INACTIVE');
  }
  const overview = await GetInternNikolausBookingsEndpoint(request('GET', PRINCIPAL), context(t));
  assert.equal(overview.status, 403);
  assert.equal(database.mock.callCount(), 0);
  const steuerung = pflegeHandler('nikolaus-steuerung', async () => ({ status: 200 }));
  assert.equal((await steuerung(request('PUT', PRINCIPAL), context(t))).status, 200);
});

test('anonymous and wrong-tenant staff mutations never access the database', async (t) => {
  setupSharedState(t);
  const database = forbidDatabase(t);
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
  assert.equal(database.mock.callCount(), 0);
});

test('read-only management and staff GET operations work while writes are stopped', async (t) => {
  setupSharedState(t);
  mockNikolausSettings(t, { maintenance: true });
  const token = 'mock-management-token-for-read-only-tests';
  const booking: NikolausBooking = {
    id: '1',
    etag: '"0000000000000001"',
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
  }
  const handler = pflegeHandler('nikolaus-read', async () => ({ status: 200 }));
  assert.equal((await handler(request('GET', PRINCIPAL), context(t))).status, 200);
  const unrelated = pflegeHandler('qa', async () => ({ status: 204 }));
  assert.equal((await unrelated(request('POST', PRINCIPAL), context(t))).status, 204);
});

test('unexpected errors of Nikolaus writes keep no-store', async (t) => {
  setupSharedState(t);
  mockNikolausSettings(t);
  const handler = withNikolausWriteHandling(async () => {
    throw new Error('Simulated handler failure');
  });
  const response = await handler(request(), context(t));
  assert.equal(response.status, 500);
  assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
  const staffHandler = pflegeHandler('nikolaus-test', async () => {
    throw new Error('Simulated staff failure');
  });
  const staffResponse = await staffHandler(request('POST', PRINCIPAL), context(t));
  assert.equal(staffResponse.status, 500);
  assert.equal(new Headers(staffResponse.headers).get('cache-control'), 'no-store');
});
