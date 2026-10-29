import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import geocodeHandler from '../endpoints/nikolaus-geocode';
import { NikolausMessageEndpoint } from '../endpoints/intern-nikolaus-message';
import { NikolausSteuerungDelete } from '../endpoints/intern-nikolaus-steuerung';
import { GetInternNikolausDispoRoutesEndpoint } from '../endpoints/intern-nikolaus-dispo';
import * as geocoding from '../lib/geocoding';
import * as bookings from '../lib/nikolaus-bookings';
import * as travelTimes from '../lib/travel-times';
import { setupSharedState } from './fixtures/shared-state';
import { mockNikolausSettings } from './fixtures/nikolaus-settings';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function staffRequest(body: unknown, method = 'POST', query = ''): HttpRequest {
  return new HttpRequest({
    url: `http://localhost/api/intern/test${query}`,
    method,
    headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64') },
    params: { id: '7' },
    body: { string: JSON.stringify(body) },
  });
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

function fieldsOf(response: HttpResponseInit): Record<string, string> {
  assert.equal(response.status, 400);
  return (response.jsonBody as { fields: Record<string, string> }).fields;
}

test('the message to a family needs a subject and a text within the limits', async (t) => {
  mockNikolausSettings(t);
  const send = async (body: unknown) => NikolausMessageEndpoint(staffRequest(body), context(t));
  assert.deepEqual(fieldsOf(await send({})), {
    subject: 'Bitte einen Betreff angeben.',
    message: 'Bitte eine Nachricht schreiben.',
  });
  assert.deepEqual(fieldsOf(await send({ subject: 4, message: ['x'] })), {
    subject: 'Bitte einen Betreff angeben.',
    message: 'Bitte eine Nachricht schreiben.',
  });
  assert.deepEqual(fieldsOf(await send({ subject: ' ', message: '<p> </p>' })), {
    subject: 'Bitte einen Betreff angeben.',
    message: 'Bitte eine Nachricht schreiben.',
  });
  assert.deepEqual(
    fieldsOf(await send({ subject: 'x'.repeat(151), message: `<p>${'y'.repeat(5001)}</p>` })),
    {
      subject: 'Der Betreff darf höchstens 150 Zeichen lang sein.',
      message: 'Die Nachricht darf höchstens 5000 Zeichen lang sein.',
    }
  );
  const lookup = t.mock.method(bookings, 'getBooking', async () => null);
  const valid = { subject: ` ${'x'.repeat(150)} `, message: `<p>${'y'.repeat(5000)}</p>` };
  assert.equal((await send(valid)).status, 404);
  assert.equal(lookup.mock.callCount(), 1);
});

test('the address lookup needs a street, a city and a postal code', async (t) => {
  setupSharedState(t);
  mockNikolausSettings(t, { publicActive: true });
  const locate = t.mock.method(geocoding, 'geocodeAddress', async () => ({ found: false }));
  const post = (body: unknown) =>
    geocodeHandler(
      new HttpRequest({
        url: 'http://localhost/api/nikolaus/geocode',
        method: 'POST',
        body: { string: JSON.stringify(body) },
      }),
      context(t)
    );
  const valid = { street: ' Hauptstr. 1 ', city: ' Aibling ', postalCode: '83052' };
  for (const patch of [
    { street: ' ' },
    { street: 5 },
    { street: 'x'.repeat(1000) },
    { city: '' },
    { city: null },
    { city: 'x'.repeat(1000) },
    { postalCode: '8305' },
    { postalCode: 83052 },
  ]) {
    const response = await post({ ...valid, ...patch });
    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, 'VALIDATION_FAILED');
  }
  assert.equal((await post(null)).status, 400);
  assert.equal(locate.mock.callCount(), 0);
  assert.equal((await post(valid)).status, 200);
  assert.deepEqual(locate.mock.calls[0].arguments, ['Hauptstr. 1', '83052', 'Aibling']);
});

test('deleting Nikolaus data needs a known scope and the typed confirmation', async (t) => {
  mockNikolausSettings(t);
  const remove = async (body: unknown) => NikolausSteuerungDelete(staffRequest(body), context(t));
  for (const scope of [undefined, 'all', 5, null]) {
    assert.deepEqual(fieldsOf(await remove({ scope })), {
      scope: 'Bitte auswählen, was gelöscht wird.',
    });
  }
  for (const scope of ['bookings', 'helpers']) {
    const fields = fieldsOf(await remove({ scope, confirmation: 'nein' }));
    assert.match(fields.confirmation, /^Bitte zur Bestätigung „.+“ eintippen\.$/);
  }
});

test('the route paths of the map accept only known teams with a list of booking IDs', async (t) => {
  mockNikolausSettings(t);
  const path = t.mock.method(travelTimes, 'getRoutePath', async () => null);
  t.mock.method(bookings, 'getAllBookings', async () => []);
  const post = (body: unknown, date = '2026-12-05') =>
    GetInternNikolausDispoRoutesEndpoint(staffRequest(body, 'POST', `?date=${date}`));
  const invalid = async (body: unknown): Promise<void> => {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.deepEqual(response.jsonBody, {
      error: 'INVALID',
      code: 'INVALID',
      message: 'Die Routen sind ungültig.',
    });
  };
  for (const routes of [
    undefined,
    null,
    'A',
    ['A'],
    { C: [] },
    { A: 'x' },
    { A: [1] },
    { A: Array.from({ length: 201 }, () => '1') },
    { A: ['1'], C: ['2'] },
  ]) {
    await invalid({ routes });
  }
  await invalid(null);
  assert.equal(path.mock.callCount(), 0);
  const response = await post({ routes: { A: Array.from({ length: 200 }, () => '1'), B: [] } });
  assert.equal(response.status, 200);
  assert.deepEqual((response.jsonBody as { paths: unknown }).paths, { A: null, B: null });
  assert.equal((await post({ routes: {} })).status, 200);
});
