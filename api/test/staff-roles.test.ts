import assert from 'node:assert/strict';
import test from 'node:test';
import type { InvocationContext } from '@azure/functions';
import { HttpRequest } from '@azure/functions';
import { CONFIG } from '../lib/config';
import { createGetRolesEndpoint } from '../endpoints/get-roles';
import type { ReadMemberGroups } from '../lib/staff-roles';
import { getTeamRoles } from '../lib/staff-roles';
import { overrideConfig } from './fixtures/config';

const LEITENDE = CONFIG.staff.teams.leitende.groupId;
const KASSE = CONFIG.staff.teams.kasse.groupId;
const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const TID = 'http://schemas.microsoft.com/identity/claims/tenantid';

function user(login: string, claims: { typ: string; val: string }[] = []) {
  return { identityProvider: 'aad', userDetails: login, claims };
}

function reader(groups: string[], calls: string[] = []): ReadMemberGroups {
  return async (id, groupIds) => {
    calls.push(id);
    return groupIds.filter((groupId) => groups.includes(groupId));
  };
}

const context = { error: () => {} } as unknown as InvocationContext;

function login(body: unknown): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/GetRoles',
    method: 'POST',
    body: { string: JSON.stringify(body) },
  });
}

test('maps the teams of the user to roles, asked by the object ID', async () => {
  const calls: string[] = [];
  const roles = await getTeamRoles(
    user('anna@stamm-phoenix.de', [{ typ: OID, val: 'object-1' }]),
    reader([LEITENDE, KASSE], calls)
  );
  assert.deepEqual(roles, ['team_leitende', 'team_kasse']);
  assert.deepEqual(calls, ['object-1']);
});

test('asks by the login without an object ID and gives no role outside the teams', async () => {
  const calls: string[] = [];
  assert.deepEqual(await getTeamRoles(user('gast@stamm-phoenix.de'), reader([], calls)), []);
  assert.deepEqual(calls, ['gast@stamm-phoenix.de']);
  assert.deepEqual(await getTeamRoles(user('bea@stamm-phoenix.de'), reader([LEITENDE])), [
    'team_leitende',
  ]);
});

test('gives other tenants and providers no role', async () => {
  const all = reader([LEITENDE, KASSE]);
  assert.deepEqual(
    await getTeamRoles(user('x@example.test', [{ typ: TID, val: 'other-tenant' }]), all),
    []
  );
  assert.deepEqual(
    await getTeamRoles({ identityProvider: 'github', userDetails: 'x', claims: [] }, all),
    []
  );
});

test('gives preview test accounts every role on previews only, without asking Graph', async (t) => {
  overrideConfig(t, CONFIG.staff, { previewOnlyLogins: ['claude-preview@stamm-phoenix.de'] });
  const calls: string[] = [];
  const preview = user('Claude-Preview@stamm-phoenix.de');
  assert.deepEqual(await getTeamRoles(preview, reader([LEITENDE], calls)), []);
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  assert.deepEqual(await getTeamRoles(preview, reader([], calls)), [
    'team_leitende',
    'team_kasse',
    'team_vorstand',
    'team_admin',
  ]);
  assert.deepEqual(calls, []);
});

test('GetRoles answers Static Web Apps with the roles, and none when Graph fails', async () => {
  const endpoint = createGetRolesEndpoint(reader([LEITENDE]));
  const response = await endpoint(login(user('anna@stamm-phoenix.de')), context);
  assert.deepEqual(response, { status: 200, jsonBody: { roles: ['team_leitende'] } });

  const failing = createGetRolesEndpoint(async () => {
    throw new Error('Graph down');
  });
  assert.deepEqual(await failing(login(user('anna@stamm-phoenix.de')), context), {
    status: 200,
    jsonBody: { roles: [] },
  });
  assert.deepEqual(await endpoint(login({ nonsense: true }), context), {
    status: 200,
    jsonBody: { roles: [] },
  });
});
