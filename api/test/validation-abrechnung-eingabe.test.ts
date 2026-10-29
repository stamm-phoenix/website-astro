import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { AbrechnungEingabeEndpoint } from '../endpoints/intern-abrechnung-eingabe';
import * as campflow from '../lib/campflow';
import * as eingaben from '../lib/abrechnung-eingabe';
import { emptySession } from '../lib/abrechnung-session';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'anna',
  userDetails: 'anna@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

async function put(body: string) {
  return AbrechnungEingabeEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/intern/abrechnung/evt_Test/eingaben',
      method: 'PUT',
      params: { id: 'evt_Test' },
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      body: { string: body },
    }),
    new InvocationContext()
  );
}

test('saving a draft refuses a body without a session or with a wrong version', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => [
    { id: 'evt_Test', end_date: '2099-05-31' },
  ]);
  const save = t.mock.method(eingaben, 'saveAbrechnungEingabe', async () => {
    throw new Error('must not be saved');
  });
  const session = emptySession();
  const bodies = [
    'not json',
    'null',
    '[]',
    '{}',
    JSON.stringify({ etag: null }),
    JSON.stringify({ session: null, etag: null }),
    JSON.stringify({ session: 'x', etag: null }),
    JSON.stringify({ session }),
    JSON.stringify({ session, etag: 5 }),
    JSON.stringify({ session: { ...session, kjr: { ort: 'x'.repeat(2_000_000) } }, etag: null }),
  ];
  for (const body of bodies) {
    const response = await put(body);
    assert.equal(response.status, 400, body.slice(0, 60));
    assert.deepEqual((response.jsonBody as { fields: unknown }).fields, {
      session: 'Die Eingaben konnten nicht gespeichert werden. Bitte prüfe die Felder.',
    });
  }
  // An array is an object to the first check; the content check then refuses it
  const array = await put(JSON.stringify({ session: [], etag: null }));
  assert.deepEqual((array.jsonBody as { fields: unknown }).fields, {
    session: 'Die Eingaben sind unvollständig oder ungültig. Es wurde nichts gespeichert.',
  });
  assert.equal(save.mock.callCount(), 0);
});

test('saving a draft passes the session and the version on', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => [
    { id: 'evt_Test', end_date: '2099-05-31' },
  ]);
  const save = t.mock.method(eingaben, 'saveAbrechnungEingabe', async () => ({
    etag: '"2"',
    savedAt: '2026-10-28T10:00:00Z',
    deleteAfter: '2099-09-30',
  }));
  const session = { ...emptySession(), zusatztag: true };
  for (const etag of [null, '"1"']) {
    const response = await put(JSON.stringify({ session, etag }));
    assert.equal(response.status, 200);
    assert.deepEqual(save.mock.calls.at(-1)?.arguments.slice(0, 3), [
      'anna',
      'evt_Test',
      'anna@example.test',
    ]);
    assert.deepEqual(save.mock.calls.at(-1)?.arguments[3], session);
    assert.equal(save.mock.calls.at(-1)?.arguments[4], etag);
  }
});
