import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as sharePointRest from '../lib/sharepoint-rest';
import * as campflow from '../lib/campflow';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import { AktionenCollection, AktionItem } from '../endpoints/intern-pflege-aktionen';
import { GetAktionenEndpoint } from '../endpoints/aktionen';
import { resetCampflowEventCache } from '../lib/aktionen-list';
import { validateAktion, ValidationError } from '../lib/pflege-validation';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover', 'Leitende'];
const VERSION = '"item,3"';
const EVENT: campflow.CampflowEvent = {
  id: 'evt_Sola26',
  title: 'Sommerlager 2026',
  published: true,
  start_date: '2026-08-01',
  end_date: '2026-08-10',
  max_persons: 40,
  archived: false,
  url: 'https://campflow.de/anmeldung/sola',
  collection: null,
};

function setup(t: TestContext, events: campflow.CampflowEvent[] = [EVENT]): InvocationContext {
  resetCampflowEventCache();
  overrideConfig(t, CONFIG.sharepoint.lists, { calendar: 'calendar-list' });
  t.mock.method(sharePoint, 'getSharePointChoiceValues', async () => STUFEN);
  t.mock.method(campflow, 'getCampflowEvents', async () => events);
  const context = new InvocationContext({ functionName: 'aktionen-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

function request(method: string, body?: unknown, options: { id?: string } = {}): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/intern/pflege/aktionen',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
    params: options.id ? { id: options.id } : {},
    body: body === undefined || method === 'GET' ? undefined : { string: JSON.stringify(body) },
  });
}

test('free calendar entries need title and valid dates', () => {
  assert.throws(
    () => validateAktion({ stufen: [], start: '2026-02-30', end: '' }, STUFEN),
    (error: unknown) =>
      error instanceof ValidationError &&
      Boolean(error.fields.title && error.fields.start && error.fields.stufen)
  );
  assert.throws(
    () =>
      validateAktion(
        {
          title: 'Ausflug',
          stufen: ['Rover'],
          start: '2026-05-02',
          end: '2026-05-01',
          link: 'http://x',
        },
        STUFEN
      ),
    (error: unknown) =>
      error instanceof ValidationError && Boolean(error.fields.end && error.fields.link)
  );
  const input = validateAktion(
    {
      title: ' Ausflug ',
      stufen: ['Rover', 'Rover'],
      start: '2026-05-01',
      description: '<p onclick="x()">Hallo</p>',
    },
    STUFEN
  );
  assert.deepEqual(input, {
    campflowId: null,
    stufen: ['Rover'],
    description: '<p>Hallo</p>',
    title: 'Ausflug',
    start: '2026-05-01',
    end: '2026-05-01',
    link: '',
  });
});

test('publishing a CampFlow event takes title, dates and link from CampFlow', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => []);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
  const link = t.mock.method(sharePointRest, 'validateUpdateListItem', async () => undefined);

  const response = await AktionenCollection(
    request('POST', {
      campflowId: EVENT.id,
      title: 'Ignoriert',
      start: '2020-01-01',
      stufen: ['Wölflinge'],
      description: '<p>Für alle</p>',
    }),
    context
  );

  assert.equal(response.status, 201);
  assert.deepEqual(create.mock.calls[0].arguments, [
    'calendar-list',
    {
      Title: 'Sommerlager 2026',
      'Stufen@odata.type': 'Collection(Edm.String)',
      Stufen: ['Wölflinge'],
      Beschreibung: '<p>Für alle</p>',
      Start: '2026-08-01T12:00:00Z',
      End: '2026-08-10T12:00:00Z',
      CampFlowId: EVENT.id,
    },
  ]);
  assert.deepEqual(link.mock.calls[0].arguments, [
    'calendar-list',
    '7',
    { CampFlow_x002d_Anmeldung: 'https://campflow.de/anmeldung/sola, Anmeldung' },
  ]);
});

test('a CampFlow event can only be published once and must exist', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => [
    { id: '1', fields: { Title: 'Sola', Stufen: ['Rover'], CampFlowId: EVENT.id } },
  ]);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '8');

  const duplicate = await AktionenCollection(
    request('POST', { campflowId: EVENT.id, stufen: ['Rover'] }),
    context
  );
  assert.equal(duplicate.status, 409);

  const unknown = await AktionenCollection(
    request('POST', { campflowId: 'evt_Unbekannt', stufen: ['Rover'] }),
    context
  );
  assert.equal(unknown.status, 400);
  assert.equal(create.mock.callCount(), 0);
});

test('editing a linked entry cannot switch its CampFlow event', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItem', async () => ({
    id: '1',
    fields: { CampFlowId: EVENT.id },
  }));
  const update = t.mock.method(sharePoint, 'updateSharePointListItem', async () => undefined);
  t.mock.method(sharePointRest, 'validateUpdateListItem', async () => undefined);

  const switched = await AktionItem(
    request('PATCH', { etag: VERSION, campflowId: 'evt_Anders', stufen: ['Rover'] }, { id: '1' }),
    context
  );
  assert.equal(switched.status, 400);

  const saved = await AktionItem(
    request('PATCH', { etag: VERSION, campflowId: EVENT.id, stufen: ['Rover'] }, { id: '1' }),
    context
  );
  assert.equal(saved.status, 204);
  const [, , fields, etag] = update.mock.calls[0].arguments;
  assert.equal((fields as Record<string, unknown>).Title, 'Sommerlager 2026');
  assert.equal(etag, VERSION);
});

test('the public calendar shows CampFlow data live and falls back to the stored copy', async (t) => {
  const stored = [
    {
      id: '1',
      fields: {
        Title: 'Alter Titel',
        Stufen: ['Rover'],
        Start: '2026-07-01T12:00:00Z',
        End: '2026-07-02T12:00:00Z',
        CampFlowId: EVENT.id,
      },
    },
    { id: '2', fields: { Title: 'Frei', Stufen: 'Pfadfinder', Start: '2026-03-01T12:00:00Z' } },
  ];
  setup(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => stored);

  const live = await GetAktionenEndpoint();
  const [linked, free] = live.jsonBody as Record<string, unknown>[];
  assert.equal(linked?.title, 'Sommerlager 2026');
  assert.equal(linked?.start, '2026-08-01');
  assert.equal(linked?.end, '2026-08-10');
  assert.equal(linked?.campflow_link, EVENT.url);
  assert.equal(linked?.campflowId, undefined);
  assert.equal(free?.title, 'Frei');

  resetCampflowEventCache();
  t.mock.method(campflow, 'getCampflowEvents', async () => {
    throw new campflow.CampflowError(503, 'down');
  });
  const fallback = await GetAktionenEndpoint();
  assert.equal((fallback.jsonBody as Record<string, unknown>[])[0]?.title, 'Alter Titel');
});
