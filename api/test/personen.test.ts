import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { Ich } from '../endpoints/intern-ich';
import { PersonItem, PersonenCollection } from '../endpoints/intern-pflege-personen';
import * as campflow from '../lib/campflow';
import { CampflowError } from '../lib/campflow';
import {
  ICH_CACHE_MS,
  cachedIch,
  eigeneAnmeldungen,
  eigeneBeitraege,
  getIch,
  getPersonenUebersicht,
  mitEigenerAdresse,
  rememberIch,
  toCampflowMitglied,
} from '../lib/personen';
import type { CampflowMitglied, Ich as IchBody, PersonenUebersicht } from '../lib/personen-model';
import { campflowVorschlaege, istVerknuepftePerson } from '../lib/personen-model';
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
    userRoles: ['authenticated', 'team_leitende'],
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

test('the linked person is recognized in the member list and in registrations', () => {
  const max = { id: 'per_Max1', firstName: 'Max', lastName: 'Muster' };
  // The member list: only the ID decides, a namesake is someone else
  assert.equal(
    istVerknuepftePerson(max, { id: 'per_Max1', name: 'Max Muster', mitglied: true }),
    true
  );
  assert.equal(
    istVerknuepftePerson(max, { id: 'per_Max2', name: 'Max Muster', mitglied: true }),
    false
  );
  // A registration to an event is a person of its own: the server matched its address, or the
  // name tells; the server's match also counts while the link is not loaded yet
  assert.equal(istVerknuepftePerson(max, { id: 'per_Anmeldung', ich: true }), true);
  assert.equal(istVerknuepftePerson(null, { id: 'per_Anmeldung', ich: true }), true);
  // The server compared the addresses and found someone else: a namesake is not „ich“
  assert.equal(
    istVerknuepftePerson(max, { id: 'per_Namensvetter', name: 'Max Muster', ich: false }),
    false
  );
  assert.equal(istVerknuepftePerson(max, { id: 'per_Anmeldung', name: 'max  muster' }), true);
  // Nothing the link can tell, or no link: the name of the Microsoft account decides
  assert.equal(istVerknuepftePerson(max, { id: 'per_Anmeldung', name: 'Lea Leiterin' }), undefined);
  assert.equal(istVerknuepftePerson(null, { id: 'per_Max1', mitglied: true }), undefined);
  // CampFlow was not reachable: the ID still decides, an empty name matches nobody
  const nurId = { id: 'per_Max1', firstName: '', lastName: '' };
  assert.equal(istVerknuepftePerson(nurId, { id: 'per_X', name: 'Max Muster' }), undefined);
});

test('name and address of a CampFlow person leave the memory after ten minutes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const anna = {
    id: 'per_Timer',
    firstName: 'Anna',
    lastName: 'Autorin',
    email: 'a@example.org',
    adresseGeteilt: false,
  };
  rememberIch('per_Timer', anna, 0);
  t.mock.timers.tick(ICH_CACHE_MS / 2);
  // Loaded again: the newer entry keeps its own ten minutes
  rememberIch('per_Timer', anna, ICH_CACHE_MS / 2);
  t.mock.timers.tick(ICH_CACHE_MS / 2);
  assert.equal(cachedIch('per_Timer')?.at, ICH_CACHE_MS / 2);
  t.mock.timers.tick(ICH_CACHE_MS / 2);
  assert.equal(cachedIch('per_Timer'), undefined);
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
  t.mock.method(campflow, 'getCampflowMembers', async () => [
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
    /Microsoft-Konto steht schon bei Anna Autorin/
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

dbTest('CampFlow IDs that differ only in case belong to different persons', async (t) => {
  const context = quietContext(t);
  for (const [name, campflowPersonId] of [
    ['Anna', 'per_AbC'],
    ['Ben', 'per_abc'],
  ]) {
    const created = await PersonenCollection(
      request(
        ANNA,
        'POST',
        {},
        { name, login: '', gruppe: 'weitere', campflowPersonId, aktiv: true }
      ),
      context
    );
    assert.equal(created.status, 201, JSON.stringify(created.jsonBody));
  }
});

dbTest('the overview still loads when Entra and CampFlow fail', async (t) => {
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => {
    throw new Error('Graph down');
  });
  t.mock.method(campflow, 'getCampflowMembers', async () => {
    throw new CampflowError(502, 'down');
  });
  const overview = (await PersonenCollection(request(ANNA, 'GET'), quietContext(t)))
    .jsonBody as PersonenUebersicht;
  assert.deepEqual(overview, { personen: [], leitende: null, campflow: null });
});

dbTest('a slow CampFlow member list leaves only its part out of the overview', async (t) => {
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: ANNA, name: 'Anna Leiterin', givenName: 'Anna' },
  ]);
  // Every page in time, all of them together too slow
  t.mock.method(campflow, 'getCampflowMembers', () => new Promise(() => undefined));
  const overview = await getPersonenUebersicht(20);
  assert.deepEqual(overview, {
    personen: [],
    leitende: [{ login: ANNA, name: 'Anna Leiterin' }],
    campflow: null,
  });
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
  // Nobody else in the member list has Anna's address
  t.mock.method(campflow, 'getCampflowMembers', async () => [
    { id: 'per_IchAnna', primary_email: 'anna@example.org' },
    { id: 'per_Andere', primary_email: 'andere@example.org' },
  ]);
  const expected = {
    login: ANNA,
    campflow: {
      id: 'per_IchAnna',
      firstName: 'Anna',
      lastName: 'Autorin',
    },
  };
  assert.deepEqual(await ich(ANNA.toUpperCase()), expected);
  assert.equal(get.mock.calls[0].arguments[0], '/lists/member/persons/per_IchAnna');
  // Cached: CampFlow is asked once
  assert.deepEqual(await ich(ANNA), expected);
  assert.equal(get.mock.callCount(), 1);
  // Any change of the list forgets what is in memory, so CampFlow is asked again
  const anna = (
    (await PersonenCollection(request(ANNA, 'GET'), context)).jsonBody as PersonenUebersicht
  ).personen.find((person) => person.login === ANNA)!;
  const changed = await PersonItem(
    request(ANNA, 'PATCH', { id: String(anna.id) }, { ...anna, name: 'Anna A.', etag: anna.etag }),
    context
  );
  assert.equal(changed.status, 204);
  assert.deepEqual(await ich(ANNA), expected);
  assert.equal(get.mock.callCount(), 2);
  // Without CampFlow the ID alone still identifies the person
  assert.deepEqual(await ich(BEN), {
    login: BEN,
    campflow: { id: 'per_IchBen', firstName: '', lastName: '' },
  });
  // The address stays on the server: it finds own registrations by it and returns their IDs
  const anmeldungen = [
    { id: 'per_Anmeldung1', primary_email: ' anna@EXAMPLE.org' },
    { id: 'per_Anmeldung2', primary_email: 'jemand@example.org' },
    { id: 'per_Anmeldung3' },
  ];
  assert.deepEqual(await eigeneAnmeldungen(ANNA, anmeldungen), ['per_Anmeldung1']);
  assert.deepEqual(
    (
      await mitEigenerAdresse(ANNA, [{ email: 'anna@example.org' }, { email: 'b@example.org' }])
    ).map((recipient) => recipient.ich),
    [true, false]
  );
  // Without a link, or without an address in CampFlow, nothing could be compared: `null`
  assert.equal(await eigeneAnmeldungen('niemand@stamm-phoenix.de', anmeldungen), null);
  assert.equal(await eigeneAnmeldungen(BEN, [{ id: 'per_X', primary_email: '' }]), null);
  // A checked answer, even without a match, is a list
  assert.deepEqual(
    await eigeneAnmeldungen(ANNA, [{ id: 'per_Y', primary_email: 'b@example.org' }]),
    []
  );
});

dbTest('a family address marks only the registration with the own first name', async (t) => {
  const context = quietContext(t);
  const created = await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      {
        name: 'Lea Leiterin',
        login: ANNA,
        gruppe: 'leitende',
        campflowPersonId: 'per_IchLea',
        aktiv: true,
      }
    ),
    context
  );
  assert.equal(created.status, 201);
  t.mock.method(campflow, 'campflowGet', async () => ({
    id: 'per_IchLea',
    name: { first_name: 'Lea', last_name: 'Leiterin' },
    primary_email: 'familie@example.org',
  }));
  // Her child is in the member list with the same address
  t.mock.method(campflow, 'getCampflowMembers', async () => [
    { id: 'per_IchLea', primary_email: 'familie@example.org' },
    { id: 'per_Kind', primary_email: 'Familie@example.org' },
  ]);
  const anmeldungen = [
    {
      id: 'per_AnmeldungKind',
      primary_email: 'familie@example.org',
      name: { first_name: 'Kim', last_name: 'Leiterin' },
    },
    {
      id: 'per_AnmeldungLea',
      primary_email: 'familie@example.org',
      name: { first_name: ' lea', last_name: 'L.' },
    },
  ];
  assert.deepEqual(await eigeneAnmeldungen(ANNA, anmeldungen), ['per_AnmeldungLea']);
  // The minutes go to the address itself, so it is marked as the own one
  assert.deepEqual(
    (await mitEigenerAdresse(ANNA, [{ email: 'familie@example.org' }])).map((r) => r.ich),
    [true]
  );
});

dbTest('a slow CampFlow never holds up a page, it only leaves out the marks', async (t) => {
  const context = quietContext(t);
  await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      {
        name: 'Sina Langsam',
        login: ANNA,
        gruppe: 'leitende',
        campflowPersonId: 'per_IchSina',
        aktiv: true,
      }
    ),
    context
  );
  // CampFlow does not answer at all
  t.mock.method(campflow, 'campflowGet', () => new Promise(() => undefined));
  const started = Date.now();
  const anmeldungen = [{ id: 'per_S', primary_email: 'sina@example.org' }];
  assert.equal(await eigeneAnmeldungen(ANNA, anmeldungen, Date.now(), 50), null);
  // `/intern/ich` still knows the link, only without the name
  assert.deepEqual(await getIch(ANNA, Date.now(), 50), {
    login: ANNA,
    campflow: { id: 'per_IchSina', firstName: '', lastName: '' },
  });
  assert.ok(Date.now() - started < 2000);
});

dbTest('without the member list an address counts as shared', async (t) => {
  const context = quietContext(t);
  await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      {
        name: 'Otto Offen',
        login: ANNA,
        gruppe: 'leitende',
        campflowPersonId: 'per_IchOtto',
        aktiv: true,
      }
    ),
    context
  );
  t.mock.method(campflow, 'campflowGet', async () => ({
    id: 'per_IchOtto',
    name: { first_name: 'Otto', last_name: 'Offen' },
    primary_email: 'otto@example.org',
  }));
  t.mock.method(campflow, 'getCampflowMembers', async () => {
    throw new CampflowError(502, 'down');
  });
  const anmeldungen = [
    {
      id: 'per_A',
      primary_email: 'otto@example.org',
      name: { first_name: 'Otto', last_name: 'O.' },
    },
    {
      id: 'per_B',
      primary_email: 'otto@example.org',
      name: { first_name: 'Ole', last_name: 'Offen' },
    },
  ];
  assert.deepEqual(await eigeneAnmeldungen(ANNA, anmeldungen), ['per_A']);
});

dbTest('own Beiträge: the member by ID, registrations to Aktionen by address', async (t) => {
  const context = quietContext(t);
  const fees = [
    // Mitgliedsbeitrag: the payer is the person of the member list
    { id: 'fee_Mitglied', payerId: 'per_IchMia', eventId: null, mitgliedsbeitrag: true },
    { id: 'fee_Andere', payerId: 'per_Andere', eventId: null, mitgliedsbeitrag: true },
    // Aktionen: the payer is the registration, a person of its own
    { id: 'fee_Lager', payerId: 'per_AnmeldungMia', eventId: 'evt_Lager', mitgliedsbeitrag: false },
    { id: 'fee_Kind', payerId: 'per_AnmeldungKai', eventId: 'evt_Lager', mitgliedsbeitrag: false },
    { id: 'fee_Fahrt', payerId: 'per_FahrtMia', eventId: 'evt_Fahrt', mitgliedsbeitrag: false },
    // A registration without an address cannot be compared: the page decides by the name
    {
      id: 'fee_OhneAdresse',
      payerId: 'per_AnmeldungOhne',
      eventId: 'evt_Lager',
      mitgliedsbeitrag: false,
    },
    // Without a payer ID the page decides by the name
    { id: 'fee_OhneId', payerId: null, eventId: 'evt_Lager', mitgliedsbeitrag: false },
    // Neither a Mitgliedsbeitrag nor an Aktion: the payer may be anyone, the page decides
    { id: 'fee_Manuell', payerId: 'per_Kontakt', eventId: null, mitgliedsbeitrag: false },
  ];
  // Without a link nothing could be compared: the page goes by the names
  assert.equal(await eigeneBeitraege(ANNA, fees), null);

  await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      {
        name: 'Mia Meier',
        login: ANNA,
        gruppe: 'leitende',
        campflowPersonId: 'per_IchMia',
        aktiv: true,
      }
    ),
    context
  );
  t.mock.method(campflow, 'campflowGet', async () => ({
    id: 'per_IchMia',
    name: { first_name: 'Mia', last_name: 'Meier' },
    primary_email: 'mia@example.org',
  }));
  t.mock.method(campflow, 'getCampflowMembers', async () => [
    { id: 'per_IchMia', primary_email: 'mia@example.org' },
  ]);
  const lists = t.mock.method(campflow, 'campflowGetAll', async (path: string) => {
    // The list of the Fahrt does not answer: the page decides its Beiträge by the names
    if (path.includes('evt_Fahrt')) throw new CampflowError(502, 'down');
    return [
      { id: 'per_AnmeldungMia', primary_email: 'Mia@example.org' },
      { id: 'per_AnmeldungKai', primary_email: 'kai@example.org' },
      { id: 'per_AnmeldungOhne', primary_email: '' },
    ];
  });
  assert.deepEqual(await eigeneBeitraege(ANNA, fees), {
    fee_Mitglied: true,
    fee_Andere: false,
    fee_Lager: true,
    fee_Kind: false,
  });
  // Each Aktion is asked once, the Mitgliedsbeiträge need none
  assert.deepEqual(lists.mock.calls.map((call) => call.arguments[0]).sort(), [
    '/lists/evt_Fahrt/persons',
    '/lists/evt_Lager/persons',
  ]);
  // An older Playwright API without payer IDs: only the names can tell
  assert.equal(
    await eigeneBeitraege(
      ANNA,
      fees.map((fee) => ({ ...fee, payerId: null }))
    ),
    null
  );
});

dbTest('without CampFlow the link still finds the own Mitgliedsbeitrag', async (t) => {
  const context = quietContext(t);
  await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      {
        name: 'Paul Pech',
        login: ANNA,
        gruppe: 'leitende',
        campflowPersonId: 'per_IchPaul',
        aktiv: true,
      }
    ),
    context
  );
  // Name and address of the linked person cannot be loaded
  t.mock.method(campflow, 'campflowGet', async () => {
    throw new CampflowError(502, 'down');
  });
  const lists = t.mock.method(campflow, 'campflowGetAll', async () => []);
  const fees = [
    { id: 'fee_Mitglied', payerId: 'per_IchPaul', eventId: null, mitgliedsbeitrag: true },
    { id: 'fee_Lager', payerId: 'per_P', eventId: 'evt_1', mitgliedsbeitrag: false },
  ];
  // The Aktion cannot be compared without the address, so the page decides it by the name
  assert.deepEqual(await eigeneBeitraege(ANNA, fees), { fee_Mitglied: true });
  assert.equal(lists.mock.callCount(), 0);
});

dbTest('slow lists of the Aktionen leave the names to decide', async (t) => {
  const context = quietContext(t);
  await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      {
        name: 'Rita Rasch',
        login: ANNA,
        gruppe: 'leitende',
        campflowPersonId: 'per_IchRita',
        aktiv: true,
      }
    ),
    context
  );
  t.mock.method(campflow, 'campflowGet', async () => ({
    id: 'per_IchRita',
    name: { first_name: 'Rita', last_name: 'Rasch' },
    primary_email: 'rita@example.org',
  }));
  t.mock.method(campflow, 'getCampflowMembers', async () => []);
  t.mock.method(campflow, 'campflowGetAll', () => new Promise(() => undefined));
  const fees = [
    { id: 'fee_1', payerId: 'per_R', eventId: 'evt_1', mitgliedsbeitrag: false },
    { id: 'fee_2', payerId: 'per_IchRita', eventId: null, mitgliedsbeitrag: true },
  ];
  const started = Date.now();
  assert.deepEqual(await eigeneBeitraege(ANNA, fees, Date.now() + 500), { fee_2: true });
  assert.ok(Date.now() - started < 2000);
  // No time left at all: CampFlow is not asked, the page goes by the names
  const lists = t.mock.method(campflow, 'campflowGetAll', async () => []);
  assert.equal(await eigeneBeitraege(ANNA, fees, Date.now()), null);
  assert.equal(lists.mock.callCount(), 0);
});
