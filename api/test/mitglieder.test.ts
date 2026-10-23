import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { GetInternMitgliederEndpoint } from '../endpoints/intern-mitglieder';

const STAFF = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function request(principal: object | null = STAFF): HttpRequest {
  return new HttpRequest({
    url: 'https://example.test/api/intern/mitglieder',
    method: 'GET',
    headers: principal
      ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
      : {},
  });
}

const MEMBER: campflow.CampflowPerson = {
  id: 'per_Anna',
  name: { first_name: 'Anna', last_name: 'Muster' },
  group_names: ['🟠 Wölfling'],
  bank_account: { iban: 'DE02700100800030876808' },
  sepa_mandate: { reference: 'MR1' },
  col_Konfession: 'rk',
};

const COLUMNS: campflow.CampflowColumn[] = [
  {
    id: 'col_Konfession',
    name: 'Konfession',
    type: 'string',
    allowed_values: null,
    external_id: null,
  },
];

interface Body {
  columns: campflow.CampflowColumn[];
  persons: campflow.CampflowPerson[];
}

test('the member list comes with its custom fields and without payment details', async (t) => {
  t.mock.method(campflow, 'getCampflowMembers', async () => [MEMBER]);
  const getAll = t.mock.method(campflow, 'campflowGetAll', async () => COLUMNS);

  const response = await GetInternMitgliederEndpoint(request());

  assert.equal(response.status, 200);
  assert.equal(getAll.mock.calls[0].arguments[0], '/lists/member/custom_columns');
  const body = response.jsonBody as Body;
  assert.deepEqual(body.columns, COLUMNS);
  assert.deepEqual(body.persons, [
    {
      id: 'per_Anna',
      name: { first_name: 'Anna', last_name: 'Muster' },
      group_names: ['🟠 Wölfling'],
      col_Konfession: 'rk',
    },
  ]);
  // The shared load of the member list stays untouched
  assert.ok(MEMBER.bank_account);
});

test('the member list still loads when its custom fields cannot be read', async (t) => {
  t.mock.method(campflow, 'getCampflowMembers', async () => [MEMBER]);
  t.mock.method(campflow, 'campflowGetAll', async () => {
    throw new campflow.CampflowError(404, 'not found');
  });

  const response = await GetInternMitgliederEndpoint(request());

  assert.equal(response.status, 200);
  assert.deepEqual((response.jsonBody as Body).columns, []);
});

test('a failing CampFlow is reported with what to do', async (t) => {
  t.mock.method(campflow, 'campflowGetAll', async () => COLUMNS);
  t.mock.method(campflow, 'getCampflowMembers', async () => {
    throw new campflow.CampflowError(504, 'timeout');
  });
  const unavailable = await GetInternMitgliederEndpoint(request());
  assert.equal(unavailable.status, 502);
  assert.match(JSON.stringify(unavailable.jsonBody), /admin@stamm-phoenix\.de/);

  t.mock.method(campflow, 'getCampflowMembers', async () => {
    throw new campflow.CampflowError(403, 'forbidden');
  });
  const forbidden = await GetInternMitgliederEndpoint(request());
  assert.equal(forbidden.status, 502);
  assert.match(JSON.stringify(forbidden.jsonBody), /CAMPFLOW_FORBIDDEN/);
});

test('only Leitende see the member list', async (t) => {
  const members = t.mock.method(campflow, 'getCampflowMembers', async () => [MEMBER]);

  const anonymous = await GetInternMitgliederEndpoint(request(null));
  const other = await GetInternMitgliederEndpoint(
    request({ ...STAFF, userRoles: ['authenticated'] })
  );

  assert.equal(anonymous.status, 401);
  assert.equal(other.status, 403);
  assert.equal(members.mock.callCount(), 0);
});
