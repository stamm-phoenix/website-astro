import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as campflow from '../lib/campflow';
import {
  getAktionenOhneZuschuss,
  isZuschussfaehig,
  setZuschussfaehig,
} from '../lib/aktion-zuschuss';
import { seedPreviewAktionenOhneZuschuss } from '../lib/db-preview';
import { GetInternAktionenEndpoint } from '../endpoints/intern-aktionen';
import { GetInternAktionEndpoint } from '../endpoints/intern-aktion';
import { AktionZuschussEndpoint } from '../endpoints/intern-pflege-aktion-zuschuss';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function event(id: string, title: string): campflow.CampflowEvent {
  return {
    id,
    title,
    published: true,
    start_date: '2026-05-24',
    end_date: '2026-05-31',
    max_persons: null,
    archived: false,
    url: null,
    collection: null,
  };
}

const EVENTS = [event('evt_Lager', 'Stammeslager'), event('evt_Dioezese', 'Diözesanlager')];

function request(
  method: string,
  route: string,
  params: Record<string, string>,
  body?: unknown,
  principal: object | null = PRINCIPAL
): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/${route}`,
    method,
    headers: {
      'content-type': 'application/json',
      ...(principal
        ? {
            'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
          }
        : {}),
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'aktion-zuschuss-test' });
  t.mock.method(context, 'log', () => undefined);
  return context;
}

function toggle(t: TestContext, id: string, body: unknown, principal: object | null = PRINCIPAL) {
  return AktionZuschussEndpoint(
    request('PUT', `intern/pflege/aktionen-zuschuss/${id}`, { id }, body, principal),
    quietContext(t)
  );
}

dbTest('every Aktion gets the KJR grant until it is switched off', async () => {
  assert.equal(await isZuschussfaehig('evt_Neu'), true);

  await setZuschussfaehig('evt_Neu', false, 'a@example.test');
  // Switching off twice keeps one row
  await setZuschussfaehig('evt_Neu', false, 'b@example.test');
  assert.equal(await isZuschussfaehig('evt_Neu'), false);
  assert.deepEqual([...(await getAktionenOhneZuschuss())], ['evt_Neu']);

  await setZuschussfaehig('evt_Neu', true, 'a@example.test');
  await setZuschussfaehig('evt_Neu', true, 'a@example.test');
  assert.equal(await isZuschussfaehig('evt_Neu'), true);
  assert.equal((await getAktionenOhneZuschuss()).size, 0);
});

dbTest('the switch is saved for Aktionen that exist in CampFlow only', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => structuredClone(EVENTS));

  const off = await toggle(t, 'evt_Dioezese', { zuschussfaehig: false });
  assert.equal(off.status, 200);
  assert.deepEqual(off.jsonBody, { zuschussfaehig: false });
  assert.equal(await isZuschussfaehig('evt_Dioezese'), false);

  assert.equal((await toggle(t, 'evt_Dioezese', { zuschussfaehig: 'nein' })).status, 400);
  assert.equal((await toggle(t, 'evt_Dioezese', {})).status, 400);
  assert.equal((await toggle(t, 'evt_Unbekannt', { zuschussfaehig: false })).status, 404);
  assert.equal(await isZuschussfaehig('evt_Unbekannt'), true);
  assert.equal((await toggle(t, '../x', { zuschussfaehig: false })).status, 404);
  assert.equal((await toggle(t, 'evt_Lager', { zuschussfaehig: false }, null)).status, 401);
  assert.equal(await isZuschussfaehig('evt_Lager'), true);

  const on = await toggle(t, 'evt_Dioezese', { zuschussfaehig: true });
  assert.equal(on.status, 200);
  assert.equal(await isZuschussfaehig('evt_Dioezese'), true);
});

dbTest('the Aktionen of the Leitendenbereich say whether they get the KJR grant', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => structuredClone(EVENTS));
  t.mock.method(campflow, 'campflowGetAll', async () => []);
  await setZuschussfaehig('evt_Dioezese', false, 'a@example.test');

  const list = await GetInternAktionenEndpoint(request('GET', 'intern/aktionen', {}));
  assert.equal(list.status, 200);
  assert.deepEqual(
    (list.jsonBody as { id: string; zuschussfaehig: boolean }[]).map((e) => [
      e.id,
      e.zuschussfaehig,
    ]),
    [
      ['evt_Lager', true],
      ['evt_Dioezese', false],
    ]
  );

  const detail = await GetInternAktionEndpoint(
    request('GET', 'intern/aktionen/evt_Dioezese', { id: 'evt_Dioezese' })
  );
  assert.equal(detail.status, 200);
  assert.equal(
    (detail.jsonBody as { event: { zuschussfaehig: boolean } }).event.zuschussfaehig,
    false
  );
  await setZuschussfaehig('evt_Dioezese', true, 'a@example.test');
});

dbTest('the preview seed adds an invented Aktion without grant once', async () => {
  await seedPreviewAktionenOhneZuschuss();
  await seedPreviewAktionenOhneZuschuss();
  assert.deepEqual([...(await getAktionenOhneZuschuss())], ['evt_PreviewExtern']);
  await setZuschussfaehig('evt_PreviewExtern', true, 'a@example.test');
});
