import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as campflow from '../lib/campflow';
import * as env from '../lib/environment';
import { CONFIG } from '../lib/config';
import { costUnitForEvent, countPersons, summarizeEntries } from '../lib/abrechnung';
import { betreuungsschluessel, countNights, kjrZuschuss } from '../lib/kjr-zuschuss';
import type { Einzelnachweis } from '../lib/playwright-api';
import { GetInternAbrechnungEndpoint } from '../endpoints/intern-abrechnung';
import { GetInternAbrechnungKostenstellenEndpoint } from '../endpoints/intern-abrechnung-kostenstellen';
import { GetInternAbrechnungBelegBildEndpoint } from '../endpoints/intern-abrechnung-beleg-bild';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function entry(category: string | null, amountEur: number): Einzelnachweis {
  return {
    receiptNumber: '2026-1',
    type: amountEur > 0 ? 'Beitrag' : 'Ausgabebeleg',
    description: 'Test',
    costUnit: 'Stammeslager 2026',
    category,
    paidBy: null,
    date: '2026-05-01',
    currency: 'EUR',
    amount: amountEur,
    amountEur,
    unassignedAmount: 0,
    unassignedAmountEur: 0,
  };
}

/** The sums of the template „Abrechnungsmappe“ (Stammeslager 2026). */
const MAPPE: Einzelnachweis[] = [
  entry('Teilnehmerbeiträge', 1000),
  entry('Teilnehmerbeiträge', 965),
  entry('Unterkunft', -10.2),
  entry('Unterkunft', -1329.2),
  entry('Transport', -1335.06),
  entry('Verpflegung', -983.37),
  entry('Material', -49.45),
];

function confirmed(
  birthdate: string | null,
  extra: Record<string, unknown> = {}
): campflow.CampflowPerson {
  return { id: `p_${Math.random()}`, birthdate, confirmation_date: '2026-01-01', ...extra };
}

function request(id: string, query = '', principal: object | null = PRINCIPAL): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/abrechnung/${id}${query}`,
    method: 'GET',
    headers: principal
      ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
      : {},
    params: { id },
  });
}

const EVENT: campflow.CampflowEvent = {
  id: 'evt_Lager',
  title: 'Stammeslager 2026',
  published: true,
  start_date: '2026-05-24',
  end_date: '2026-05-31',
  max_persons: null,
  archived: false,
  url: null,
  collection: null,
};

function mockCampflow(t: TestContext, persons: campflow.CampflowPerson[]): void {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  t.mock.method(campflow, 'getCampflowEvents', async () => [EVENT]);
  t.mock.method(campflow, 'campflowGetAll', async () => persons);
}

function mockPlaywright(t: TestContext, status: number, body: unknown) {
  return t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  );
}

test('sums income and expenses per category like the Abrechnungsmappe', () => {
  const bilanz = summarizeEntries(MAPPE);
  assert.equal(bilanz.incomeCent, 196500);
  assert.equal(bilanz.expenseCent, 370728);
  assert.equal(bilanz.resultCent, -174228);
  assert.deepEqual(bilanz.income, [{ category: 'Teilnehmerbeiträge', cent: 196500, count: 2 }]);
  assert.deepEqual(
    bilanz.expenses.map((row) => [row.category, row.cent]),
    [
      ['Unterkunft', 133940],
      ['Transport', 133506],
      ['Verpflegung', 98337],
      ['Material', 4945],
    ]
  );
  assert.equal(bilanz.entryCount, 7);
});

test('collects entries without category and ignores zero amounts', () => {
  const bilanz = summarizeEntries([entry(null, -5), entry('  ', -2.5), entry('Material', 0)]);
  assert.deepEqual(bilanz.expenses, [{ category: 'Ohne Kategorie', cent: 750, count: 2 }]);
  assert.equal(bilanz.income.length, 0);
  assert.equal(bilanz.resultCent, -750);
});

test('counts only confirmed persons and splits them at 27 on the first day', () => {
  const counts = countPersons(
    [
      confirmed('1999-05-24'), // 27 on the first day
      confirmed('1999-05-25'), // 26 on the first day
      confirmed('2015-01-01'),
      confirmed(null, { age: 30 }),
      confirmed(null),
      confirmed('2010-01-01', { cancellation_date: '2026-03-01' }),
      { id: 'registered', birthdate: '2010-01-01' },
    ],
    '2026-05-24'
  );
  assert.deepEqual(counts, {
    total: 5,
    teilnehmende: 2,
    betreuende: 2,
    ab27: 2,
    unknownAge: 1,
    // Without a Postleitzahl, Teilnehmende are not subsidised; Betreuer*innen always are
    outsideLandkreis: 3,
    subsidised: 2,
  });
});

test('calculates the KJR grant like the Abrechnungsmappe and caps it at the deficit', () => {
  assert.equal(countNights('2026-05-24', '2026-05-31'), 7);
  assert.equal(countNights('2026-05-24', '2026-05-24'), 0);
  assert.equal(countNights(null, '2026-05-24'), 0);

  assert.deepEqual(kjrZuschuss({ persons: 30, nights: 7, zusatztag: false, resultCent: -174228 }), {
    rateCent: 800,
    days: 7,
    computedCent: 168000,
    deficitCent: 174228,
    eligibleCent: 168000,
    resultAfterCent: -6228,
  });

  const zusatztag = kjrZuschuss({ persons: 30, nights: 7, zusatztag: true, resultCent: -174228 });
  assert.equal(zusatztag.days, 8);
  assert.equal(zusatztag.computedCent, 192000);
  assert.equal(zusatztag.eligibleCent, 174228);
  assert.equal(zusatztag.resultAfterCent, 0);

  const singleDay = kjrZuschuss({ persons: 12, nights: 0, zusatztag: true, resultCent: -10000 });
  assert.equal(singleDay.rateCent, 500);
  assert.equal(singleDay.days, 1);
  assert.equal(singleDay.computedCent, 6000);
  assert.equal(singleDay.eligibleCent, 6000);

  const surplus = kjrZuschuss({ persons: 30, nights: 2, zusatztag: false, resultCent: 500 });
  assert.equal(surplus.computedCent, 48000);
  assert.equal(surplus.eligibleCent, 0);
  assert.equal(surplus.resultAfterCent, 500);
});

test('warns about a Betreuungsschlüssel worse than 1:8', () => {
  assert.deepEqual(betreuungsschluessel(29, 1), { label: '1:29', warning: true });
  assert.deepEqual(betreuungsschluessel(16, 2), { label: '1:8', warning: false });
  assert.deepEqual(betreuungsschluessel(17, 2), { label: '1:8,5', warning: true });
  assert.deepEqual(betreuungsschluessel(10, 0), { label: '0:10', warning: true });
  assert.deepEqual(betreuungsschluessel(0, 3), { label: '–', warning: false });
});

test('prefers a Kostenstelle linked to the event over its title', () => {
  assert.equal(costUnitForEvent(EVENT), 'Stammeslager 2026');
  assert.equal(costUnitForEvent({ ...EVENT, cost_unit: { id: 'cun_1', name: 'Lager' } }), 'cun_1');
});

test('returns the overview of an Aktion without personal data', async (t) => {
  mockCampflow(t, [confirmed('2015-01-01'), confirmed('1990-01-01')]);
  const fetch = mockPlaywright(t, 200, {
    costUnit: { id: 'cun_1', name: 'Stammeslager 2026' },
    entries: MAPPE,
    exportedAt: '2026-10-05T12:34:56.789Z',
  });

  const response = await GetInternAbrechnungEndpoint(request('evt_Lager'));

  assert.equal(response.status, 200);
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.origin, new URL(CONFIG.playwrightApi.url).origin);
  assert.equal(url.pathname, '/campflow/einzelnachweise');
  assert.equal(url.searchParams.get('costUnit'), 'Stammeslager 2026');
  // Without ?refresh=true the Playwright API serves its last export
  assert.equal(url.searchParams.has('refresh'), false);
  const init = fetch.mock.calls[0].arguments[1] as RequestInit;
  assert.equal((init.headers as Record<string, string>)['x-api-key'], 'test-key');

  const body = response.jsonBody as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    'bilanz',
    'costUnit',
    'event',
    'exportedAt',
    'leihgebuehren',
    'nachweise',
    'persons',
  ]);
  const persons = body.persons as Record<string, unknown>[];
  assert.equal(persons.length, 2);
  // Only the fields relevant for the Abrechnung, no further CampFlow data
  assert.deepEqual(Object.keys(persons[0]).sort(), [
    'age',
    'betreuer',
    'firstName',
    'gender',
    'herkunft',
    'id',
    'lastName',
    'plz',
  ]);
  assert.deepEqual(
    persons.map((p) => [p.age, p.betreuer]),
    [
      [11, false],
      [36, true],
    ]
  );
  assert.equal((body.bilanz as { resultCent: number }).resultCent, -174228);
  const nachweise = body.nachweise as { category: string; cent: number }[];
  assert.equal(nachweise.length, MAPPE.length);
  assert.ok(nachweise.some((n) => n.category === 'Transport' && n.cent === -133506));
  assert.doesNotMatch(JSON.stringify(body), /birthdate|confirmation_date|address/);
  assert.deepEqual(body.leihgebuehren, CONFIG.abrechnung.leihgebuehren);
  assert.equal(body.exportedAt, '2026-10-05T12:34:56.789Z');
});

test('the Leihgebühren in the config are complete and unambiguous', () => {
  const { beschlossenVon, stand, material } = CONFIG.abrechnung.leihgebuehren;
  assert.ok(beschlossenVon.trim());
  assert.match(stand, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(`${stand}T00:00:00Z`)));
  assert.ok(material.length > 0);
  assert.equal(new Set(material.map((m) => m.id)).size, material.length);
  for (const item of material) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.name.trim());
    assert.ok(Number.isInteger(item.priceCentPerDay) && item.priceCentPerDay > 0, item.id);
  }
});

test('exports the Einzelnachweise again on ?refresh=true', async (t) => {
  mockCampflow(t, [confirmed('2015-01-01')]);
  const fetch = mockPlaywright(t, 200, {
    costUnit: { id: 'cun_1', name: 'Stammeslager 2026' },
    entries: MAPPE,
  });

  const response = await GetInternAbrechnungEndpoint(request('evt_Lager', '?refresh=true'));

  assert.equal(response.status, 200);
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.searchParams.get('refresh'), 'true');
  // An older Playwright API without the timestamp
  assert.equal((response.jsonBody as { exportedAt: unknown }).exportedAt, null);
});

test('uses the chosen Kostenstelle and reports a missing one', async (t) => {
  mockCampflow(t, []);
  const fetch = mockPlaywright(t, 404, { error: 'Not Found' });

  const response = await GetInternAbrechnungEndpoint(
    request('evt_Lager', '?kostenstelle=Lager%2026')
  );

  assert.equal(response.status, 404);
  assert.equal((response.jsonBody as { code: string }).code, 'KOSTENSTELLE_NOT_FOUND');
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.searchParams.get('costUnit'), 'Lager 26');
});

test('maps an unavailable Playwright API to 502', async (t) => {
  mockCampflow(t, []);
  mockPlaywright(t, 504, { error: 'Timeout' });

  const response = await GetInternAbrechnungEndpoint(request('evt_Lager'));

  assert.equal(response.status, 502);
  assert.equal((response.jsonBody as { code: string }).code, 'EINZELNACHWEISE_UNAVAILABLE');
});

test('rejects anonymous requests, invalid IDs and unknown events', async (t) => {
  mockCampflow(t, []);
  const fetch = mockPlaywright(t, 200, {});

  assert.equal((await GetInternAbrechnungEndpoint(request('evt_Lager', '', null))).status, 401);
  assert.equal((await GetInternAbrechnungEndpoint(request('../x'))).status, 400);
  assert.equal(
    (await GetInternAbrechnungEndpoint(request('evt_Lager', `?kostenstelle=${'x'.repeat(201)}`)))
      .status,
    400
  );
  assert.equal((await GetInternAbrechnungEndpoint(request('evt_Unbekannt'))).status, 404);
  assert.equal(fetch.mock.callCount(), 0);
});

test('lists the Kostenstellen, active ones first', async (t) => {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  mockPlaywright(t, 200, {
    data: [
      { id: 'cun_3', name: 'Alt', archived: true, color: '#000', categories: [] },
      { id: 'cun_2', name: 'Zeltlager', archived: false, categories: [] },
      { id: 'cun_1', name: 'Hike', archived: false, categories: [] },
    ],
  });

  const response = await GetInternAbrechnungKostenstellenEndpoint(request('kostenstellen'));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, [
    { id: 'cun_1', name: 'Hike', archived: false },
    { id: 'cun_2', name: 'Zeltlager', archived: false },
    { id: 'cun_3', name: 'Alt', archived: true },
  ]);
});

test('a missing API key is a configuration error, not an unavailable upstream', async (t) => {
  t.mock.method(env, 'getEnvironment', () => {
    throw new Error('Missing environment variable: PLAYWRIGHT_API_KEY');
  });
  const fetch = mockPlaywright(t, 200, { data: [] });

  await assert.rejects(
    GetInternAbrechnungKostenstellenEndpoint(request('kostenstellen')),
    /PLAYWRIGHT_API_KEY/
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test('passes receipt images through with their page count', async (t) => {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(png, { status: 200, headers: { 'x-campflow-pages': '3' } })
  );
  const bild = (nummer: string, query = '', principal: object | null = PRINCIPAL) =>
    GetInternAbrechnungBelegBildEndpoint(
      new HttpRequest({
        url: `https://example.test/api/intern/abrechnung/belege/${nummer}/bild${query}`,
        method: 'GET',
        headers: principal
          ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
          : {},
        params: { nummer },
      })
    );

  const response = await bild('2026-94', '?page=2');
  assert.equal(response.status, 200);
  const headers = response.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'image/png');
  assert.equal(headers['x-campflow-pages'], '3');
  assert.deepEqual([...(response.body as Uint8Array)], [...png]);
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.pathname, '/campflow/belege/2026-94/bild');
  assert.equal(url.searchParams.get('page'), '2');

  assert.equal((await bild('2026-94', '', null)).status, 401);
  assert.equal((await bild('../x')).status, 400);
  assert.equal((await bild('2026-94', '?page=0')).status, 400);
  assert.equal(fetch.mock.callCount(), 1);
});

test('reports a receipt CampFlow does not know', async (t) => {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  mockPlaywright(t, 404, { error: 'Not Found' });

  const response = await GetInternAbrechnungBelegBildEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/intern/abrechnung/belege/2026-1/bild',
      method: 'GET',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params: { nummer: '2026-1' },
    })
  );

  assert.equal(response.status, 404);
  assert.equal((response.jsonBody as { code: string }).code, 'BELEG_NOT_FOUND');
});
