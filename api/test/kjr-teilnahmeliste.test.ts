import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { countPersons, kjrPersons } from '../lib/abrechnung';
import { kjrHerkunft } from '../lib/kjr-zuschuss';
import { buildKjrTeilnahmeliste, KJR_MAX_NIGHTS, KjrListeError } from '../lib/kjr-teilnahmeliste';
import type { KjrListeInput } from '../lib/kjr-teilnahmeliste';
import { readZip, writeZip } from '../lib/zip';
import {
  GetInternAbrechnungKjrListeEndpoint,
  kjrTemplate,
} from '../endpoints/intern-abrechnung-kjr-liste';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

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

function person(
  last: string,
  first: string,
  gender: string,
  birthdate: string,
  zip: string,
  extra: Record<string, unknown> = {}
): campflow.CampflowPerson {
  return {
    id: `prs_${last}${first}`,
    name: { first_name: first, last_name: last },
    gender,
    birthdate,
    address: { zip },
    confirmation_date: '2026-01-01T10:00:00Z',
    ...extra,
  };
}

const PERSONS = [
  person('Schaberl', 'Martin', 'm', '1993-05-01', '83620'),
  person('Auer', 'Klara', 'f', '2010-05-01', '83052'),
  person('Ansorge', 'Emanuel', 'm', '2016-05-01', '83052'),
  person('Kuntscher', 'Jonas', 'm', '2004-05-01', '90429'),
  person('Rose', 'Rita', 'd', '2012-05-01', '83022'),
  person('Ohne', 'Plz', 'f', '2013-05-01', ''),
  person('Später', 'Abgesagt', 'f', '2010-05-01', '83620', { cancellation_date: '2026-02-01' }),
];

/** The cells of the first sheet: inline strings and numbers by reference. */
function sheetCells(file: Buffer): Map<string, string> {
  const sheet = readZip(file).find((e) => e.name === 'xl/worksheets/sheet1.xml');
  assert.ok(sheet);
  const cells = new Map<string, string>();
  for (const match of sheet.data
    .toString('utf8')
    .matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(.*?)<\/c>)/gs)) {
    const value =
      /<t[^>]*>(.*?)<\/t>/s.exec(match[2] ?? '')?.[1] ?? /<v>(.*?)<\/v>/.exec(match[2] ?? '')?.[1];
    if (value !== undefined && !/<f>/.test(match[2] ?? '')) cells.set(match[1], value);
  }
  return cells;
}

function input(overrides: Partial<KjrListeInput> = {}): KjrListeInput {
  return {
    kopf: {
      antragsteller: 'DPSG Stamm Phoenix Feldkirchen-Westerham',
      titel: 'Stammeslager 2026 & Co',
      ort: 'Zeltplatz Zellhof',
      plz: '83620',
      beginn: '2026-05-24',
      beginnZeit: '10:00',
      ende: '2026-05-31',
      endeZeit: '14:30',
    },
    persons: kjrPersons(PERSONS, '2026-05-24'),
    nights: 7,
    ...overrides,
  };
}

function request(query = '', principal: object | null = PRINCIPAL, id = 'evt_Lager'): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/abrechnung/${id}/kjr-liste${query}`,
    method: 'GET',
    headers: principal
      ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
      : {},
    params: { id },
  });
}

function mockCampflow(t: TestContext): void {
  t.mock.method(campflow, 'getCampflowEvents', async () => [EVENT]);
  t.mock.method(campflow, 'campflowGetAll', async () => PERSONS);
}

test('sorts Postleitzahlen like the KJR: Landkreis, Stadt Rosenheim, others', () => {
  assert.equal(kjrHerkunft('83620'), 'landkreis');
  assert.equal(kjrHerkunft(' 83052 '), 'landkreis');
  assert.equal(kjrHerkunft('83022'), 'stadt');
  assert.equal(kjrHerkunft('90429'), 'andere');
  assert.equal(kjrHerkunft(''), 'unbekannt');
  assert.equal(kjrHerkunft('8362'), 'unbekannt');
});

test('subsidises Betreuer*innen and Teilnehmende from the Landkreis only', () => {
  assert.deepEqual(countPersons(PERSONS, '2026-05-24'), {
    total: 6,
    under27: 5,
    from27: 1,
    unknownAge: 0,
    outsideLandkreis: 3,
    subsidised: 3,
  });
});

test('maps confirmed registrations to the fields of the Teilnahmeliste', () => {
  const persons = kjrPersons(PERSONS, '2026-05-24');
  assert.deepEqual(
    persons.map((p) => [p.lastName, p.gender, p.age, p.plz, p.herkunft, p.betreuer]),
    [
      ['Ansorge', 'm', 10, '83052', 'landkreis', false],
      ['Auer', 'w', 16, '83052', 'landkreis', false],
      ['Kuntscher', 'm', 22, '90429', 'andere', false],
      ['Ohne', 'w', 13, '', 'unbekannt', false],
      ['Rose', 'd', 14, '83022', 'stadt', false],
      ['Schaberl', 'm', 33, '83620', 'landkreis', true],
    ]
  );
});

test('fills header, Betreuer*innen and Teilnehmende into the KJR template', () => {
  const cells = sheetCells(buildKjrTeilnahmeliste(kjrTemplate(), input()));

  assert.equal(cells.get('D5'), 'DPSG Stamm Phoenix Feldkirchen-Westerham');
  assert.equal(cells.get('D6'), 'Stammeslager 2026 &amp; Co');
  assert.equal(cells.get('D7'), 'Zeltplatz Zellhof');
  assert.equal(cells.get('D8'), '83620');
  assert.equal(cells.get('D9'), '46166'); // 24.05.2026
  assert.equal(cells.get('F9'), '46173');
  assert.equal(cells.get('E9'), '0.416666667');
  assert.equal(cells.get('G9'), '0.604166667');

  // Part I: Betreuer*innen, always „ja“ as ehrenamtlich tätig
  assert.deepEqual(
    ['B13', 'C13', 'D13', 'E13', 'F13', 'H13', 'I13'].map((ref) => cells.get(ref)),
    ['Schaberl', 'Martin', 'm', '33', '83620', '7', 'ja']
  );
  assert.equal(cells.get('B14'), undefined);

  // Part II: nights in the column for where they live
  assert.deepEqual(
    ['B41', 'C41', 'D41', 'E41', 'F41', 'I41'].map((ref) => cells.get(ref)),
    ['Ansorge', 'Emanuel', 'm', '10', '83052', '7']
  );
  assert.equal(cells.get('M43'), '7'); // Kuntscher, other Landkreis
  assert.equal(cells.get('F44'), undefined); // Ohne Plz
  assert.equal(cells.get('I44') ?? cells.get('K44') ?? cells.get('M44'), undefined);
  assert.equal(cells.get('K45'), '7'); // Rose, Stadt Rosenheim
  assert.equal(cells.get('B47'), undefined);
});

test('keeps the template intact apart from the filled sheet and the recalculation flag', () => {
  const template = readZip(kjrTemplate());
  const filled = readZip(buildKjrTeilnahmeliste(kjrTemplate(), input()));
  assert.deepEqual(
    filled.map((e) => e.name),
    template.map((e) => e.name)
  );
  for (const entry of filled) {
    const original = template.find((e) => e.name === entry.name);
    if (entry.name === 'xl/worksheets/sheet1.xml') continue;
    if (entry.name === 'xl/workbook.xml') {
      assert.match(entry.data.toString('utf8'), /<calcPr[^>]* fullCalcOnLoad="1"\/>/);
      continue;
    }
    assert.ok(original?.data.equals(entry.data), entry.name);
  }
  // The template's formulas stay, e.g. lfd. Nr. and Ort
  const sheet = filled.find((e) => e.name === 'xl/worksheets/sheet1.xml')!.data.toString('utf8');
  assert.match(sheet, /<c r="A41"[^>]*><f>IF\(OR\(B41/);
  assert.match(sheet, /<c r="G41"[^>]*><f>VLOOKUP\(F41/);
});

test('counts one day of presence without overnight stay and caps the nights', () => {
  const singleDay = sheetCells(buildKjrTeilnahmeliste(kjrTemplate(), input({ nights: 0 })));
  assert.equal(singleDay.get('H13'), '1');
  assert.equal(singleDay.get('I41'), '1');

  const long = sheetCells(buildKjrTeilnahmeliste(kjrTemplate(), input({ nights: 20 })));
  assert.equal(long.get('H13'), String(KJR_MAX_NIGHTS));
});

test('refuses more persons than the template has rows', () => {
  const many = Array.from({ length: 121 }, (_, i) => ({
    ...kjrPersons(PERSONS, '2026-05-24')[0],
    lastName: `Person ${i}`,
  }));
  assert.throws(
    () => buildKjrTeilnahmeliste(kjrTemplate(), input({ persons: many })),
    KjrListeError
  );
});

test('packs and unpacks ZIP archives', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('Hallo Phoenix') },
    { name: 'ordner/ü.xml', data: Buffer.alloc(10_000, 'x') },
  ];
  assert.deepEqual(readZip(writeZip(entries)), entries);
});

test('downloads the filled list with the header from the page', async (t) => {
  mockCampflow(t);

  const response = await GetInternAbrechnungKjrListeEndpoint(
    request('?ort=Zeltplatz%20Zellhof&plz=83620&beginn=10:00&ende=14:30')
  );

  assert.equal(response.status, 200);
  const headers = response.headers as Record<string, string>;
  assert.equal(
    headers['Content-Type'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.match(headers['Content-Disposition'], /KJR-Teilnahmeliste%20Stammeslager%202026\.xlsx/);
  assert.equal(headers['Cache-Control'], 'no-store');
  const cells = sheetCells(Buffer.from(response.body as Uint8Array));
  assert.equal(cells.get('D6'), 'Stammeslager 2026');
  assert.equal(cells.get('D7'), 'Zeltplatz Zellhof');
  assert.equal(cells.get('B13'), 'Schaberl');
});

test('rejects invalid header fields and anonymous requests', async (t) => {
  mockCampflow(t);

  assert.equal((await GetInternAbrechnungKjrListeEndpoint(request('', null))).status, 401);
  assert.equal(
    (await GetInternAbrechnungKjrListeEndpoint(request('', PRINCIPAL, 'x'))).status,
    400
  );
  assert.equal((await GetInternAbrechnungKjrListeEndpoint(request('?plz=836'))).status, 400);
  assert.equal((await GetInternAbrechnungKjrListeEndpoint(request('?beginn=25:00'))).status, 400);
  assert.equal(
    (await GetInternAbrechnungKjrListeEndpoint(request(`?ort=${'x'.repeat(201)}`))).status,
    400
  );
  assert.equal(
    (await GetInternAbrechnungKjrListeEndpoint(request('', PRINCIPAL, 'evt_Unbekannt'))).status,
    404
  );
});
