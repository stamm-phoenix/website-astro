import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { getDb } from '../lib/db';
import { AktionenCollection, AktionItem } from '../endpoints/intern-pflege-aktionen';
import { GetAktionenEndpoint } from '../endpoints/aktionen';
import {
  campflowDateOnly,
  getAktionen,
  getStaffAktionen,
  resetCampflowEventCache,
} from '../lib/aktionen-list';
import { validateAktion } from '../lib/validation/content';
import { ValidationError } from '../lib/validation/errors';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};
const STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover', 'Leitende'];
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
  t.mock.method(campflow, 'getCampflowEvents', async () => events);
  const context = new InvocationContext({ functionName: 'aktionen-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

interface StoredEntry {
  id: number;
  title: string;
  stufen: string[];
  start?: string;
  end?: string;
  campflowId?: string;
}

/** Stores calendar entries as they are, e.g. linked to an event CampFlow no longer has. */
async function store(...entries: StoredEntry[]): Promise<void> {
  for (const entry of entries) {
    await getDb()
      .insertInto('content.aktion')
      .values({
        id: entry.id,
        title: entry.title,
        start_date: entry.start ?? null,
        end_date: entry.end ?? entry.start ?? null,
        campflow_id: entry.campflowId ?? null,
      })
      .execute();
    for (const stufe of entry.stufen) {
      await getDb()
        .insertInto('content.aktion_stufe')
        .values({ aktion_id: entry.id, stufe })
        .execute();
    }
  }
}

async function version(id: number): Promise<string> {
  const entry = (await getStaffAktionen()).find((candidate) => candidate.id === String(id));
  assert.ok(entry, `entry ${id}`);
  return entry.etag;
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

dbTest('publishing a CampFlow event takes title, dates and link from CampFlow', async (t) => {
  const context = setup(t);

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
  const { id } = response.jsonBody as { id: string };
  const [entry] = await getStaffAktionen();
  assert.deepEqual(
    { ...entry, etag: undefined },
    {
      id,
      etag: undefined,
      campflowId: EVENT.id,
      title: 'Sommerlager 2026',
      stufen: ['Wölflinge'],
      start: '2026-08-01',
      end: '2026-08-10',
      link: 'https://campflow.de/anmeldung/sola',
      description: '<p>Für alle</p>',
    }
  );

  const list = await AktionenCollection(request('GET'), context);
  assert.deepEqual((list.jsonBody as { stufen: string[] }).stufen, STUFEN);
});

dbTest('a CampFlow event can only be published once and must exist', async (t) => {
  const context = setup(t);
  await store({ id: 1, title: 'Sola', stufen: ['Rover'], campflowId: EVENT.id });

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
  assert.equal((await getStaffAktionen()).length, 1);
});

dbTest('two requests publishing the same event at once store it only once', async (t) => {
  const context = setup(t);
  const responses = await Promise.all(
    [1, 2].map(() =>
      AktionenCollection(request('POST', { campflowId: EVENT.id, stufen: ['Rover'] }), context)
    )
  );
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await getStaffAktionen()).length, 1);
});

dbTest('CampFlow events whose IDs differ only in case are separate events', async (t) => {
  const context = setup(t, [
    { ...EVENT, id: 'evt_AbC123', title: 'Erste' },
    { ...EVENT, id: 'evt_abc123', title: 'Zweite' },
  ]);
  for (const campflowId of ['evt_AbC123', 'evt_abc123']) {
    const response = await AktionenCollection(
      request('POST', { campflowId, stufen: ['Rover'] }),
      context
    );
    assert.equal(response.status, 201);
  }
  const linked = (await getStaffAktionen()).map((entry) => [entry.campflowId, entry.title]);
  assert.deepEqual(linked, [
    ['evt_AbC123', 'Erste'],
    ['evt_abc123', 'Zweite'],
  ]);
});

dbTest('an existing entry can be linked to a CampFlow event no other entry uses', async (t) => {
  const context = setup(t, [EVENT, { ...EVENT, id: 'evt_Anders', title: 'Andere Aktion' }]);
  await store(
    { id: 1, title: 'Sola alt', stufen: ['Rover'], start: '2026-07-01' },
    { id: 2, title: 'Andere', stufen: ['Rover'], campflowId: 'evt_Anders' }
  );
  const etag = await version(1);

  const taken = await AktionItem(
    request('PATCH', { etag, campflowId: 'evt_Anders', stufen: ['Rover'] }, { id: '1' }),
    context
  );
  assert.equal(taken.status, 409);

  const saved = await AktionItem(
    request(
      'PATCH',
      { etag, campflowId: EVENT.id, title: 'Ignoriert', stufen: ['Rover', 'Pfadfinder'] },
      { id: '1' }
    ),
    context
  );
  assert.equal(saved.status, 204);
  const entry = (await getStaffAktionen()).find((candidate) => candidate.id === '1');
  assert.equal(entry?.title, 'Sommerlager 2026');
  assert.equal(entry?.campflowId, EVENT.id);
  assert.equal(entry?.link, 'https://campflow.de/anmeldung/sola');
  assert.deepEqual(entry?.stufen, ['Pfadfinder', 'Rover']);

  // The old version cannot be saved again
  const stale = await AktionItem(
    request('PATCH', { etag, campflowId: EVENT.id, stufen: ['Rover'] }, { id: '1' }),
    context
  );
  assert.equal(stale.status, 409);
});

dbTest('an entry stays linked while its CampFlow event exists', async (t) => {
  const context = setup(t, [EVENT, { ...EVENT, id: 'evt_Anders', title: 'Andere Aktion' }]);
  await store({ id: 1, title: 'Sola', stufen: ['Rover'], campflowId: EVENT.id });
  const etag = await version(1);

  for (const campflowId of ['evt_Anders', null]) {
    const response = await AktionItem(
      request(
        'PATCH',
        { etag, campflowId, title: 'Frei', start: '2026-08-01', stufen: ['Rover'] },
        { id: '1' }
      ),
      context
    );
    assert.equal(response.status, 409);
  }
  assert.equal(await version(1), etag);
});

dbTest(
  'an entry whose CampFlow event was deleted can be relinked or kept without CampFlow',
  async (t) => {
    const context = setup(t);
    await store({ id: 1, title: 'Alt', stufen: ['Rover'], campflowId: 'evt_Geloescht' });

    const unlinked = await AktionItem(
      request(
        'PATCH',
        {
          etag: await version(1),
          campflowId: null,
          title: 'Frei',
          start: '2026-08-01',
          stufen: ['Rover'],
        },
        { id: '1' }
      ),
      context
    );
    assert.equal(unlinked.status, 204);
    assert.equal((await getStaffAktionen())[0]?.campflowId, null);

    const relinked = await AktionItem(
      request(
        'PATCH',
        { etag: await version(1), campflowId: EVENT.id, stufen: ['Rover'] },
        { id: '1' }
      ),
      context
    );
    assert.equal(relinked.status, 204);
    assert.equal((await getStaffAktionen())[0]?.campflowId, EVENT.id);
  }
);

dbTest('entries are deleted only in the loaded version', async (t) => {
  const context = setup(t);
  await store({ id: 1, title: 'Frei', stufen: ['Rover'], start: '2026-08-01' });
  const etag = await version(1);
  await AktionItem(
    request('PATCH', { etag, title: 'Neu', start: '2026-08-01', stufen: ['Rover'] }, { id: '1' }),
    context
  );
  const deleteWith = (value: string): HttpRequest =>
    new HttpRequest({
      url: 'http://localhost/api/intern/pflege/aktionen/1',
      method: 'DELETE',
      headers: {
        'if-match': value,
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params: { id: '1' },
    });
  assert.equal((await AktionItem(deleteWith(etag), context)).status, 409);
  assert.equal((await AktionItem(deleteWith(await version(1)), context)).status, 204);
  assert.deepEqual(await getStaffAktionen(), []);
});

dbTest(
  'the public calendar shows CampFlow data live and falls back to the stored copy',
  async (t) => {
    setup(t);
    await store(
      {
        id: 1,
        title: 'Alter Titel',
        stufen: ['Rover'],
        start: '2026-07-01',
        end: '2026-07-02',
        campflowId: EVENT.id,
      },
      { id: 2, title: 'Frei', stufen: ['Pfadfinder'], start: '2026-03-01' }
    );

    const live = await GetAktionenEndpoint();
    const [linked, free] = live.jsonBody as Record<string, unknown>[];
    assert.equal(linked?.title, 'Sommerlager 2026');
    assert.equal(linked?.start, '2026-08-01');
    assert.equal(linked?.end, '2026-08-10');
    assert.equal(linked?.campflow_link, EVENT.url);
    assert.equal(linked?.campflowId, undefined);
    assert.equal(free?.title, 'Frei');
    assert.deepEqual(free?.stufen, ['Pfadfinder']);

    resetCampflowEventCache();
    t.mock.method(campflow, 'getCampflowEvents', async () => {
      throw new campflow.CampflowError(503, 'down');
    });
    const fallback = await GetAktionenEndpoint();
    assert.equal((fallback.jsonBody as Record<string, unknown>[])[0]?.title, 'Alter Titel');
  }
);

test('CampFlow timestamps become their calendar day in Europe/Berlin', () => {
  assert.equal(campflowDateOnly('2026-08-01'), '2026-08-01');
  // 23:30 UTC is already the next day in Berlin (summer time)
  assert.equal(campflowDateOnly('2026-07-31T23:30:00Z'), '2026-08-01');
  assert.equal(campflowDateOnly('2026-12-24T18:00:00+01:00'), '2026-12-24');
  assert.equal(campflowDateOnly('kein Datum'), null);
  assert.equal(campflowDateOnly(null), null);
});

dbTest('publishing an event with timestamps writes valid dates', async (t) => {
  const context = setup(t, [
    { ...EVENT, start_date: '2026-07-31T23:30:00Z', end_date: '2026-08-10T08:00:00Z' },
  ]);

  const response = await AktionenCollection(
    request('POST', { campflowId: EVENT.id, stufen: ['Rover'] }),
    context
  );
  assert.equal(response.status, 201);
  const [entry] = await getStaffAktionen();
  assert.equal(entry?.start, '2026-08-01');
  assert.equal(entry?.end, '2026-08-10');
});

dbTest('a CampFlow failure without earlier result is not retried on every request', async (t) => {
  setup(t);
  await store({ id: 1, title: 'Kopie', stufen: ['Rover'], campflowId: EVENT.id });
  const load = t.mock.method(campflow, 'getCampflowEvents', async () => {
    throw new campflow.CampflowError(503, 'down');
  });

  assert.equal((await getAktionen())[0]?.title, 'Kopie');
  assert.equal((await getAktionen())[0]?.title, 'Kopie');
  assert.equal(load.mock.callCount(), 1);
});
