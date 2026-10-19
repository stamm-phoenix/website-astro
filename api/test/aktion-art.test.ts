import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { getAktionArt, getKeineAktionen, setKeineAktion, withAktionArt } from '../lib/aktion-art';
import { setZuschussfaehig } from '../lib/aktion-zuschuss';
import { getAktionen, resetCampflowEventCache } from '../lib/aktionen-list';
import { getDb } from '../lib/db';
import { seedPreviewKeineAktionen } from '../lib/db-preview';
import { GetInternAktionenEndpoint } from '../endpoints/intern-aktionen';
import { AktionArtEndpoint } from '../endpoints/intern-pflege-aktion-art';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
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

const EVENTS = [event('evt_Lager', 'Stammeslager'), event('evt_Pulli', 'Stammespulli')];

function request(id: string, body: unknown, principal: object | null = PRINCIPAL): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/pflege/aktionen-art/${id}`,
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(principal
        ? {
            'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
          }
        : {}),
    },
    params: { id },
    body: { string: JSON.stringify(body) },
  });
}

function mark(t: TestContext, id: string, body: unknown, principal: object | null = PRINCIPAL) {
  const context = new InvocationContext({ functionName: 'aktion-art-test' });
  t.mock.method(context, 'log', () => undefined);
  return AktionArtEndpoint(request(id, body, principal), context);
}

dbTest('every event is an Aktion until it is marked', async () => {
  assert.deepEqual(await getAktionArt('evt_Neu'), { zuschussfaehig: true, keineAktion: false });

  await setKeineAktion('evt_Neu', true, 'a@example.test');
  // Marking twice keeps one row
  await setKeineAktion('evt_Neu', true, 'b@example.test');
  assert.deepEqual([...(await getKeineAktionen())], ['evt_Neu']);
  // No Aktion means no KJR grant, whatever the grant switch says
  assert.deepEqual(await getAktionArt('evt_Neu'), { zuschussfaehig: false, keineAktion: true });

  await setKeineAktion('evt_Neu', false, 'a@example.test');
  await setKeineAktion('evt_Neu', false, 'a@example.test');
  assert.equal((await getKeineAktionen()).size, 0);
});

dbTest('taking the mark back restores the stored KJR choice', async () => {
  await setZuschussfaehig('evt_Extern', false, 'a@example.test');
  await setKeineAktion('evt_Extern', true, 'a@example.test');
  await setKeineAktion('evt_Extern', false, 'a@example.test');
  assert.deepEqual(await getAktionArt('evt_Extern'), { zuschussfaehig: false, keineAktion: false });
  await setZuschussfaehig('evt_Extern', true, 'a@example.test');

  assert.deepEqual(
    (await withAktionArt(EVENTS)).map((e) => [e.id, e.zuschussfaehig, e.keineAktion]),
    [
      ['evt_Lager', true, false],
      ['evt_Pulli', true, false],
    ]
  );
});

dbTest('the mark is saved for events that exist in CampFlow only', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => structuredClone(EVENTS));

  const on = await mark(t, 'evt_Pulli', { keineAktion: true });
  assert.equal(on.status, 200);
  assert.deepEqual(on.jsonBody, { zuschussfaehig: false, keineAktion: true });

  assert.equal((await mark(t, 'evt_Pulli', { keineAktion: 'ja' })).status, 400);
  assert.equal((await mark(t, 'evt_Pulli', {})).status, 400);
  assert.equal((await mark(t, 'evt_Unbekannt', { keineAktion: true })).status, 404);
  assert.equal((await mark(t, '../x', { keineAktion: true })).status, 404);
  assert.equal((await mark(t, 'evt_Lager', { keineAktion: true }, null)).status, 401);
  assert.deepEqual([...(await getKeineAktionen())], ['evt_Pulli']);

  const list = await GetInternAktionenEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/intern/aktionen',
      method: 'GET',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
    })
  );
  assert.deepEqual(
    (list.jsonBody as { id: string; keineAktion: boolean; zuschussfaehig: boolean }[]).map((e) => [
      e.id,
      e.keineAktion,
      e.zuschussfaehig,
    ]),
    [
      ['evt_Lager', false, true],
      ['evt_Pulli', true, false],
    ]
  );

  const off = await mark(t, 'evt_Pulli', { keineAktion: false });
  assert.deepEqual(off.jsonBody, { zuschussfaehig: true, keineAktion: false });
});

dbTest('the public calendar leaves out entries of events that are no Aktion', async (t) => {
  resetCampflowEventCache();
  t.mock.method(campflow, 'getCampflowEvents', async () => structuredClone(EVENTS));
  await getDb()
    .insertInto('content.aktion')
    .values([
      { id: 1, title: 'Lager', start_date: '2026-05-24', campflow_id: 'evt_Lager' },
      { id: 2, title: 'Pulli', start_date: '2026-05-24', campflow_id: 'evt_Pulli' },
      { id: 3, title: 'Ausflug', start_date: '2026-06-01', campflow_id: null },
    ])
    .execute();
  await setKeineAktion('evt_Pulli', true, 'a@example.test');

  assert.deepEqual(
    (await getAktionen()).map((a) => a.title),
    ['Stammeslager', 'Ausflug']
  );

  await setKeineAktion('evt_Pulli', false, 'a@example.test');
  await getDb().deleteFrom('content.aktion').execute();
});

dbTest('the preview seed adds an invented event that is no Aktion once', async () => {
  await seedPreviewKeineAktionen();
  await seedPreviewKeineAktionen();
  assert.deepEqual([...(await getKeineAktionen())], ['evt_PreviewPulli']);
});
