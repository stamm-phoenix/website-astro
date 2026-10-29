import assert from 'node:assert/strict';
import test from 'node:test';
import type { InvocationContext } from '@azure/functions';
import { HttpRequest } from '@azure/functions';
import { createGetRolesEndpoint } from '../endpoints/get-roles';
import { CONFIG } from '../lib/config';

const LEITENDE = CONFIG.staff.teams.leitende.groupId;
const context = { error: () => {} } as unknown as InvocationContext;

function post(body: string): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/GetRoles',
    method: 'POST',
    body: { string: body },
  });
}

/** The roles answered for `body`, and whom the endpoint asked Graph about. */
async function ask(body: unknown): Promise<{ roles: string[]; asked: string[] }> {
  const asked: string[] = [];
  const endpoint = createGetRolesEndpoint(async (user, groupIds) => {
    asked.push(user);
    return groupIds.filter((id) => id === LEITENDE);
  });
  const response = await endpoint(post(JSON.stringify(body)), context);
  assert.equal(response.status, 200);
  return { roles: (response.jsonBody as { roles: string[] }).roles, asked };
}

test('GetRoles answers no roles to a body that is no login', async () => {
  for (const body of [
    null,
    5,
    'x',
    [],
    {},
    { identityProvider: 'aad' },
    { userDetails: 'a@b.c' },
  ]) {
    assert.deepEqual(await ask(body), { roles: [], asked: [] });
  }
  assert.deepEqual(await ask({ identityProvider: 'aad', userDetails: 5 }), {
    roles: [],
    asked: [],
  });
  const endpoint = createGetRolesEndpoint(async () => assert.fail('Graph must not be asked'));
  assert.deepEqual(await endpoint(post('not json'), context), {
    status: 200,
    jsonBody: { roles: [] },
  });
});

test('GetRoles ignores claims that are not text pairs and asks by the login without a list', async () => {
  const base = { identityProvider: 'aad', userDetails: 'anna@stamm-phoenix.de' };
  assert.deepEqual(await ask({ ...base, claims: 'x' }), {
    roles: ['team_leitende'],
    asked: ['anna@stamm-phoenix.de'],
  });
  const claims = [
    null,
    'oid',
    { typ: 'oid', val: 5 },
    { typ: 5, val: 'x' },
    { typ: 'oid' },
    { typ: 'oid', val: 'object-1', extra: true },
  ];
  assert.deepEqual(await ask({ ...base, claims }), {
    roles: ['team_leitende'],
    asked: ['object-1'],
  });
  assert.deepEqual(await ask({ ...base, claims: claims.slice(0, 5) }), {
    roles: ['team_leitende'],
    asked: ['anna@stamm-phoenix.de'],
  });
});
