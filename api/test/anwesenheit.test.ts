import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as campflow from '../lib/campflow';
import {
  getChildren,
  getMeetingRecord,
  getMeetingSummaries,
  retentionStart,
} from '../lib/anwesenheit';
import { getDb } from '../lib/db';
import { seedPreviewAttendance } from '../lib/db-preview';
import { dateToLocalParts } from '../lib/nikolaus-config';
import {
  AnwesenheitCancelled,
  AnwesenheitChild,
  AnwesenheitGuests,
  AnwesenheitNotes,
  GetAnwesenheitTermin,
} from '../endpoints/intern-anwesenheit';
import { dbTest } from './fixtures/database';

function berlinToday(now: Date = new Date()): string {
  return dateToLocalParts(now).date;
}

/** A request of the logged-in staff member to the Termin of the Wölflinge today. */
function terminRequest(
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/anwesenheit',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      ...headers,
    },
    params: { stufe: 'woelflinge', datum: berlinToday(), ...params },
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'anwesenheit-test' });
  t.mock.method(context, 'log', () => undefined);
  return context;
}

/** CampFlow answers single persons from `PERSONS` and 404 for anyone else. */
function mockCampflowPerson(t: TestContext): void {
  t.mock.method(campflow, 'campflowGet', async (path: string) => {
    const person = PERSONS.find((p) => path.endsWith(`/${p.id}`));
    if (!person) throw new campflow.CampflowError(404, 'Not Found');
    return structuredClone(person);
  });
}

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

const PERSONS = [
  {
    id: 'per_Current',
    name: { first_name: 'Anna', last_name: 'Test' },
    group_names: ['Wölflinge'],
  },
  {
    id: 'per_Future',
    name: { first_name: 'Ben', last_name: 'Test' },
    group_names: ['Wölflinge'],
    join_date: '2099-01-01',
  },
  {
    id: 'per_Old',
    name: { first_name: 'Clara', last_name: 'Test' },
    group_names: ['Wölflinge'],
    leave_date: '2000-01-01',
  },
];

test('getChildren leaves out members who have not joined yet or have left', async (t) => {
  t.mock.method(campflow, 'campflowGetAll', async () => structuredClone(PERSONS));

  const children = await getChildren(new Date('2026-10-08T12:00:00Z'));

  assert.deepEqual(
    children.map((child) => child.id),
    ['per_Current']
  );
});

test('checking in a child that is not a current CampFlow member returns 404', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);

  for (const id of ['per_Invented', 'per_Future', 'per_Old']) {
    const response = await AnwesenheitChild(
      terminRequest('PUT', { id }, { status: 'anwesend' }),
      context
    );
    assert.equal(response.status, 404, id);
  }
});

dbTest('PUT checks a child in and DELETE checks them out again', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;

  assert.equal(
    (
      await AnwesenheitChild(
        terminRequest('PUT', { id: 'per_Current' }, { status: 'anwesend' }),
        context
      )
    ).status,
    204
  );
  assert.equal(
    (
      await AnwesenheitChild(
        terminRequest('PUT', { id: 'per_Current' }, { status: 'anwesend' }),
        context
      )
    ).status,
    204
  );
  assert.deepEqual((await getMeetingRecord(termin)).presentIds, ['per_Current']);

  assert.equal(
    (await AnwesenheitChild(terminRequest('DELETE', { id: 'per_Current' }), context)).status,
    204
  );
  assert.deepEqual((await getMeetingRecord(termin)).presentIds, []);
});

dbTest('an excused child replaces the check-in and is not counted as present', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;
  const mark = (status: string) =>
    AnwesenheitChild(terminRequest('PUT', { id: 'per_Current' }, { status }), context);

  assert.equal((await mark('anwesend')).status, 204);
  assert.equal((await mark('entschuldigt')).status, 204);

  const record = await getMeetingRecord(termin);
  assert.deepEqual(record.presentIds, []);
  assert.deepEqual(record.excusedIds, ['per_Current']);
  const [summary] = await getMeetingSummaries();
  assert.equal(summary.members, 0);
  assert.equal(summary.excused, 1);

  assert.equal((await mark('anwesend')).status, 204);
  assert.deepEqual((await getMeetingRecord(termin)).presentIds, ['per_Current']);
  assert.deepEqual((await getMeetingRecord(termin)).excusedIds, []);
  assert.equal((await mark('vielleicht')).status, 400);
});

dbTest('a cancelled Gruppenstunde loses its attendance and takes no new one', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;
  let etag: string | null = null;
  const cancel = async (cancelled: boolean, entries = 0) => {
    const response = await AnwesenheitCancelled(
      terminRequest('PUT', {}, { cancelled, etag, entries }),
      context
    );
    if (response.status === 200) etag = (response.jsonBody as { etag: string }).etag;
    return response;
  };
  const check = () =>
    AnwesenheitChild(terminRequest('PUT', { id: 'per_Current' }, { status: 'anwesend' }), context);

  assert.equal((await check()).status, 204);
  assert.equal(
    (await AnwesenheitGuests(terminRequest('POST', {}, { name: 'Testgast' }), context)).status,
    201
  );
  // Ticking created the Termin, but its notes are empty, so no version is needed yet
  assert.equal((await cancel(true, 2)).status, 200);

  const record = await getMeetingRecord(termin);
  assert.equal(record.cancelled, true);
  assert.deepEqual(record.presentIds, []);
  assert.deepEqual(record.guests, []);
  assert.equal((await check()).status, 400);
  assert.equal(
    (await AnwesenheitGuests(terminRequest('POST', {}, { name: 'Testgast' }), context)).status,
    400
  );

  assert.equal((await cancel(false)).status, 200);
  assert.equal((await check()).status, 204);
  assert.equal((await getMeetingRecord(termin)).cancelled, false);
});

dbTest('cancelling refuses when someone added an entry after the page loaded', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;
  // Leader A loads an existing Termin without entries, leader B checks a child in afterwards
  const loaded = (
    (await AnwesenheitNotes(terminRequest('PUT', {}, { notes: 'Plan.', etag: null }), context))
      .jsonBody as { etag: string }
  ).etag;
  await AnwesenheitChild(
    terminRequest('PUT', { id: 'per_Current' }, { status: 'anwesend' }),
    context
  );

  const cancel = await AnwesenheitCancelled(
    terminRequest('PUT', {}, { cancelled: true, etag: loaded, entries: 0 }),
    context
  );
  assert.equal(cancel.status, 409);
  const record = await getMeetingRecord(termin);
  assert.equal(record.cancelled, false);
  assert.deepEqual(record.presentIds, ['per_Current']);
});

dbTest('cancelling against an old version refuses, so stale notes cannot win', async (t) => {
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;
  const saveNotes = (notes: string, etag: string | null) =>
    AnwesenheitNotes(terminRequest('PUT', {}, { notes, etag }), context);
  // Leader A loads the Termin, leader B changes the notes afterwards
  const loaded = (
    (await saveNotes('Knoten geübt.', null)).jsonBody as {
      etag: string;
    }
  ).etag;
  assert.equal((await saveNotes('Von B geändert.', loaded)).status, 200);

  const cancel = await AnwesenheitCancelled(
    terminRequest('PUT', {}, { cancelled: true, etag: loaded }),
    context
  );
  assert.equal(cancel.status, 409);
  const missing = await AnwesenheitCancelled(
    terminRequest('PUT', {}, { cancelled: true, etag: null }),
    context
  );
  assert.equal(missing.status, 409);
  const record = await getMeetingRecord(termin);
  assert.equal(record.cancelled, false);
  assert.equal(record.notes, 'Von B geändert.');
});

dbTest('DELETE removes the Termin of the loaded version with its attendance', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;
  const remove = (etag?: string) =>
    AnwesenheitNotes(
      terminRequest('DELETE', {}, undefined, etag ? { 'if-match': etag } : {}),
      context
    );
  await AnwesenheitChild(
    terminRequest('PUT', { id: 'per_Current' }, { status: 'anwesend' }),
    context
  );
  const loaded = (await getMeetingRecord(termin)).etag ?? '';
  // Someone changes the notes after the Termin was opened for deleting
  const changed = await AnwesenheitNotes(
    terminRequest('PUT', {}, { notes: 'Neu.', etag: loaded }),
    context
  );
  const current = (changed.jsonBody as { etag: string }).etag;

  assert.equal((await remove()).status, 409);
  assert.equal((await remove(loaded)).status, 409);
  assert.equal((await getMeetingRecord(termin)).notes, 'Neu.');

  assert.equal((await remove(current)).status, 204);
  assert.deepEqual(await getMeetingSummaries(), []);
  assert.equal(
    (await getDb().selectFrom('gruppenstunde.attendance').selectAll().execute()).length,
    0
  );
  assert.equal((await remove(current)).status, 204);
});

dbTest('notes are only saved against the version that was loaded', async (t) => {
  const context = quietContext(t);
  const save = (notes: string, etag: string | null) =>
    AnwesenheitNotes(terminRequest('PUT', {}, { notes, etag }), context);

  const first = await save('Knoten geübt.', null);
  assert.equal(first.status, 200);
  const { etag } = first.jsonBody as { etag: string };
  assert.equal((await save('Ohne Version.', null)).status, 409);

  const second = await save('Seilbrücke gebaut.', etag);
  assert.equal(second.status, 200);
  assert.equal((await save('Mit alter Version.', etag)).status, 409);
  assert.equal(
    (await getMeetingRecord({ stufe: 'Wölflinge', date: berlinToday() })).notes,
    'Seilbrücke gebaut.'
  );
});

dbTest('the preview seed adds invented Termine once and stores no CampFlow ID', async () => {
  const now = new Date('2026-10-08T12:00:00Z');
  await seedPreviewAttendance(now);
  const first = await getMeetingSummaries();
  await seedPreviewAttendance(now);

  assert.deepEqual(await getMeetingSummaries(), first);
  assert.equal(first.length, 40);
  assert.ok(first.every((meeting) => meeting.date <= berlinToday(now)));
  const cancelled = first.filter((meeting) => meeting.cancelled);
  const held = first.filter((meeting) => !meeting.cancelled);
  assert.equal(cancelled.length, 4);
  assert.ok(cancelled.every((meeting) => meeting.members + meeting.excused + meeting.guests === 0));
  assert.ok(held.every((meeting) => meeting.members > 0 && meeting.excused > 0));
  assert.ok(first.some((meeting) => meeting.notes === ''));
  assert.ok(first.some((meeting) => meeting.date < retentionStart(now)));
  const rows = await getDb()
    .selectFrom('gruppenstunde.attendance as a')
    .innerJoin('gruppenstunde.meeting as m', 'm.id', 'a.meeting_id')
    .select(['a.person_id', 'a.guest_name', 'm.date'])
    .execute();
  assert.ok(rows.every((row) => row.person_id === null));
  const expired = retentionStart(now);
  const named = rows.filter((row) => row.guest_name !== null);
  assert.ok(named.length > 0);
  assert.ok(
    named.every((row) => new Date(row.date).toISOString().slice(0, 10) >= expired),
    'guests before the retention start have no name'
  );
});

dbTest('a Termin is read with the children of its Stufe from CampFlow', async (t) => {
  t.mock.method(campflow, 'campflowGetAll', async () => structuredClone(PERSONS));
  const response = await GetAnwesenheitTermin(
    new HttpRequest({
      url: 'https://example.test/api/intern/anwesenheit',
      method: 'GET',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params: { stufe: 'woelflinge', datum: berlinToday() },
    }),
    new InvocationContext({ functionName: 'anwesenheit-test' })
  );

  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const body = response.jsonBody as { children: { id: string }[]; etag: string | null };
  assert.deepEqual(
    body.children.map((child) => child.id),
    ['per_Current']
  );
  assert.equal(body.etag, null);
});

dbTest(
  'a Termin before the retention start shows only its counts, no current children',
  async (t) => {
    const persons = t.mock.method(campflow, 'campflowGetAll', async () => structuredClone(PERSONS));
    const date = '2000-01-07';
    await getDb()
      .insertInto('gruppenstunde.meeting')
      .values({ stufe: 'Wölflinge', date, updated_by: 'test' })
      .execute();
    const response = await GetAnwesenheitTermin(
      terminRequest('GET', { datum: date }),
      quietContext(t)
    );

    assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
    const body = response.jsonBody as { children: unknown[]; editable: boolean };
    assert.equal(body.editable, false);
    assert.deepEqual(body.children, []);
    assert.equal(persons.mock.callCount(), 0);
  }
);

for (const [name, setup, code] of [
  [
    'a missing CampFlow token',
    (t: TestContext) => {
      const token = process.env.CAMPFLOW_API_TOKEN;
      delete process.env.CAMPFLOW_API_TOKEN;
      t.after(() => {
        if (token !== undefined) process.env.CAMPFLOW_API_TOKEN = token;
      });
    },
    'CAMPFLOW_FORBIDDEN',
  ],
  [
    'an unreachable CampFlow',
    (t: TestContext) => {
      const token = process.env.CAMPFLOW_API_TOKEN;
      process.env.CAMPFLOW_API_TOKEN = 'test-token';
      t.after(() => {
        if (token === undefined) delete process.env.CAMPFLOW_API_TOKEN;
        else process.env.CAMPFLOW_API_TOKEN = token;
      });
      t.mock.method(globalThis, 'fetch', async () => {
        throw new TypeError('fetch failed');
      });
    },
    'CAMPFLOW_UNAVAILABLE',
  ],
] as const) {
  dbTest(`reading a Termin with ${name} explains the problem`, async (t) => {
    setup(t);
    const response = await GetAnwesenheitTermin(
      new HttpRequest({
        url: 'https://example.test/api/intern/anwesenheit',
        method: 'GET',
        headers: {
          'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
        },
        params: { stufe: 'woelflinge', datum: berlinToday() },
      }),
      new InvocationContext({ functionName: 'anwesenheit-test' })
    );

    assert.equal(response.status, 502);
    assert.equal((response.jsonBody as { code: string }).code, code);
  });
}
