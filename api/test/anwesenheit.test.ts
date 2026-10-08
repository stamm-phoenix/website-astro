import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { berlinToday, getChildren } from '../lib/anwesenheit';
import { AnwesenheitChild } from '../endpoints/intern-anwesenheit';

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
  t.mock.method(campflow, 'campflowGetAll', async () => structuredClone(PERSONS));
  const context = new InvocationContext({ functionName: 'anwesenheit-test' });
  t.mock.method(context, 'log', () => undefined);

  for (const id of ['per_Invented', 'per_Future']) {
    const response = await AnwesenheitChild(
      new HttpRequest({
        url: 'https://example.test/api/intern/pflege/anwesenheit',
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
        },
        params: { stufe: 'woelflinge', datum: berlinToday(), id },
        body: { string: JSON.stringify({ present: true }) },
      }),
      context
    );
    assert.equal(response.status, 404, id);
  }
});
