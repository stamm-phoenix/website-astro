import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { Ich } from '../endpoints/intern-ich';
import { PersonItem, PersonenCollection } from '../endpoints/intern-pflege-personen';
import * as campflow from '../lib/campflow';
import { CampflowError } from '../lib/campflow';
import { toCampflowMitglied } from '../lib/personen';
import type { CampflowMitglied, Ich as IchBody, PersonenUebersicht } from '../lib/personen-model';
import { campflowVorschlaege } from '../lib/personen-model';
import { ValidationError, validatePerson } from '../lib/pflege-validation';
import * as taskDirectory from '../lib/task-directory';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.beobachter@stamm-phoenix.de';

function request(
  login: string,
  method: string,
  params: Record<string, string> = {},
  body?: unknown
): HttpRequest {
  const principal = {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated'],
  };
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/personen',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'personen-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

function mitglied(id: string, firstName: string, lastName: string, ausgetreten = false) {
  return { id, firstName, lastName, groups: ['🐦‍🔥 Leiter*in'], ausgetreten };
}

const leader = (login: string, campflowPersonId: string) => ({
  id: 1,
  name: login,
  login,
  gruppe: 'leitende' as const,
  campflowPersonId,
  aktiv: true,
  etag: '',
  updatedAt: '',
  updatedBy: '',
});

test('leaders need their login, CampFlow IDs must look like one', () => {
  assert.deepEqual(
    validatePerson({
      name: 'Anna Autorin',
      login: ANNA.toUpperCase(),
      gruppe: 'leitende',
      campflowPersonId: 'per_Anna1',
      aktiv: true,
    }),
    {
      name: 'Anna Autorin',
      login: ANNA,
      gruppe: 'leitende',
      campflowPersonId: 'per_Anna1',
      aktiv: true,
    }
  );
  // Rows from before the link have no CampFlow ID
  assert.equal(
    validatePerson({ name: 'Otto', login: '', gruppe: 'altleitende', aktiv: true })
      .campflowPersonId,
    ''
  );
  assert.throws(
    () =>
      validatePerson({
        name: 'Anna',
        login: '',
        gruppe: 'leitende',
        campflowPersonId: 'evt_1',
        aktiv: true,
      }),
    (error: unknown) =>
      error instanceof ValidationError &&
      Object.keys(error.fields).sort().join() === 'campflowPersonId,login'
  );
});

test('a CampFlow person is suggested only for an unambiguous name', () => {
  const konten = [
    { login: ANNA, name: 'Anna  Autorin' },
    { login: BEN, name: 'Ben Beobachter' },
    { login: 'carla.c@stamm-phoenix.de', name: 'Carla Doppelt' },
    { login: 'dora.d@stamm-phoenix.de', name: 'Dora Weg' },
    { login: 'emil.e@stamm-phoenix.de', name: 'Emil Gleich' },
    { login: 'emil.e2@stamm-phoenix.de', name: 'Emil Gleich' },
  ];
  const mitglieder: CampflowMitglied[] = [
    mitglied('per_Anna', 'anna', 'autorin'),
    mitglied('per_Ben', 'Ben', 'Beobachter'),
    mitglied('per_Carla1', 'Carla', 'Doppelt'),
    mitglied('per_Carla2', 'Carla', 'Doppelt'),
    mitglied('per_Dora', 'Dora', 'Weg', true),
    mitglied('per_Emil', 'Emil', 'Gleich'),
  ];
  // Ben is linked already
  const vorschlaege = campflowVorschlaege(konten, [leader(BEN, 'per_Ben')], mitglieder);
  assert.deepEqual(
    [...vorschlaege].map(([login, m]) => [login, m.id]),
    [[ANNA, 'per_Anna']]
  );
  // A person someone else has is never suggested
  assert.equal(campflowVorschlaege(konten, [leader(BEN, 'per_Anna')], mitglieder).has(ANNA), false);
});

test('members of CampFlow are reduced to name and groups', () => {
  const person = {
    id: 'per_1',
    name: { first_name: ' Anna ', last_name: 'Autorin' },
    primary_email: 'anna@example.org',
    group_names: ['🐦‍🔥 Leiter*in', 3],
    leave_date: '2026-10-01',
  };
  assert.deepEqual(toCampflowMitglied(person, '2026-10-20'), {
    id: 'per_1',
    firstName: 'Anna',
    lastName: 'Autorin',
    groups: ['🐦‍🔥 Leiter*in'],
    ausgetreten: true,
  });
  assert.equal(toCampflowMitglied(person, '2026-09-30').ausgetreten, false);
});

dbTest('a login and a CampFlow person belong to one row', async (t) => {
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: ANNA, name: 'Anna Autorin', givenName: 'Anna' },
  ]);
  t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: 'per_Anna', name: { first_name: 'Anna', last_name: 'Autorin' } },
  ]);
  const context = quietContext(t);
  const body = {
    name: 'Anna Autorin',
    login: ANNA,
    gruppe: 'leitende',
    campflowPersonId: 'per_Anna',
    aktiv: true,
  };
  const created = await PersonenCollection(request(ANNA, 'POST', {}, body), context);
  assert.equal(created.status, 201, JSON.stringify(created.jsonBody));

  const twice = await PersonenCollection(
    request(BEN, 'POST', {}, { ...body, name: 'Ben', login: BEN }),
    context
  );
  assert.equal(twice.status, 400);
  assert.match(
    (twice.jsonBody as { fields: Record<string, string> }).fields.campflowPersonId,
    /schon mit Anna Autorin verknüpft/
  );
  const sameLogin = await PersonenCollection(
    request(BEN, 'POST', {}, { ...body, gruppe: 'altleitende', campflowPersonId: '' }),
    context
  );
  assert.equal(sameLogin.status, 400);
  assert.match(
    (sameLogin.jsonBody as { fields: Record<string, string> }).fields.login,
    /schon bei Anna Autorin/
  );

  const overview = (await PersonenCollection(request(BEN, 'GET'), context))
    .jsonBody as PersonenUebersicht;
  assert.deepEqual(overview.leitende, [{ login: ANNA, name: 'Anna Autorin' }]);
  assert.deepEqual(overview.campflow, [
    { id: 'per_Anna', firstName: 'Anna', lastName: 'Autorin', groups: [], ausgetreten: false },
  ]);
  const [anna] = overview.personen;
  assert.equal(anna.campflowPersonId, 'per_Anna');

  // Unlinking frees the person for someone else
  const unlinked = await PersonItem(
    request(
      ANNA,
      'PATCH',
      { id: String(anna.id) },
      { ...body, campflowPersonId: '', etag: anna.etag }
    ),
    context
  );
  assert.equal(unlinked.status, 204);
  const ben = await PersonenCollection(
    request(BEN, 'POST', {}, { ...body, name: 'Ben', login: BEN }),
    context
  );
  assert.equal(ben.status, 201);
});

dbTest('the overview still loads when Entra and CampFlow fail', async (t) => {
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => {
    throw new Error('Graph down');
  });
  t.mock.method(campflow, 'campflowGetAll', async () => {
    throw new CampflowError(502, 'down');
  });
  const overview = (await PersonenCollection(request(ANNA, 'GET'), quietContext(t)))
    .jsonBody as PersonenUebersicht;
  assert.deepEqual(overview, { personen: [], leitende: null, campflow: null });
});

dbTest('the logged-in person learns their CampFlow person', async (t) => {
  const context = quietContext(t);
  const ich = async (login: string): Promise<IchBody> =>
    (await Ich(request(login, 'GET'), context)).jsonBody as IchBody;
  assert.deepEqual(await ich(ANNA), { login: ANNA, campflow: null });

  for (const [login, id] of [
    [ANNA, 'per_IchAnna'],
    [BEN, 'per_IchBen'],
  ]) {
    const created = await PersonenCollection(
      request(
        ANNA,
        'POST',
        {},
        { name: login, login, gruppe: 'leitende', campflowPersonId: id, aktiv: true }
      ),
      context
    );
    assert.equal(created.status, 201);
  }
  const get = t.mock.method(campflow, 'campflowGet', async (path: string) => {
    if (path.endsWith('per_IchBen')) throw new CampflowError(502, 'down');
    return {
      id: 'per_IchAnna',
      name: { first_name: 'Anna', last_name: 'Autorin' },
      primary_email: 'Anna@Example.org',
    };
  });
  const expected = {
    login: ANNA,
    campflow: {
      id: 'per_IchAnna',
      firstName: 'Anna',
      lastName: 'Autorin',
      email: 'anna@example.org',
    },
  };
  assert.deepEqual(await ich(ANNA.toUpperCase()), expected);
  assert.equal(get.mock.calls[0].arguments[0], '/lists/member/persons/per_IchAnna');
  // Cached: CampFlow is asked once
  assert.deepEqual(await ich(ANNA), expected);
  assert.equal(get.mock.callCount(), 1);
  // Without CampFlow the ID alone still identifies the person
  assert.deepEqual(await ich(BEN), {
    login: BEN,
    campflow: { id: 'per_IchBen', firstName: '', lastName: '', email: '' },
  });
});
