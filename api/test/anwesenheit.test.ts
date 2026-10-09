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
  AnwesenheitChild,
  AnwesenheitNotes,
  GetAnwesenheitTermin,
} from '../endpoints/intern-anwesenheit';
import { dbTest } from './fixtures/database';

function berlinToday(now: Date = new Date()): string {
  return dateToLocalParts(now).date;
}

/** A request of the logged-in staff member to the Termin of the Wölflinge today. */
function terminRequest(method: string, params: Record<string, string> = {}, body?: unknown) {
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/anwesenheit',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
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
    const response = await AnwesenheitChild(terminRequest('PUT', { id }), context);
    assert.equal(response.status, 404, id);
  }
});

dbTest('PUT checks a child in and DELETE checks them out again', async (t) => {
  mockCampflowPerson(t);
  const context = quietContext(t);
  const termin = { stufe: 'Wölflinge', date: berlinToday() } as const;

  assert.equal(
    (await AnwesenheitChild(terminRequest('PUT', { id: 'per_Current' }), context)).status,
    204
  );
  assert.equal(
    (await AnwesenheitChild(terminRequest('PUT', { id: 'per_Current' }), context)).status,
    204
  );
  assert.deepEqual((await getMeetingRecord(termin)).presentIds, ['per_Current']);

  assert.equal(
    (await AnwesenheitChild(terminRequest('DELETE', { id: 'per_Current' }), context)).status,
    204
  );
  assert.deepEqual((await getMeetingRecord(termin)).presentIds, []);
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
  assert.ok(first.every((meeting) => meeting.date <= berlinToday(now) && meeting.members > 0));
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
