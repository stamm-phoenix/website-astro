import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { city, countPersons, kjrPersons, postalCode } from '../lib/abrechnung';
import { countKjrPersons, kjrHerkunft, toKjrPerson } from '../lib/kjr-zuschuss';
import { buildKjrTeilnahmeliste, KJR_MAX_NIGHTS, KjrListeError } from '../lib/kjr-teilnahmeliste';
import type { KjrListeInput } from '../lib/kjr-teilnahmeliste';
import { readZip, writeZip } from '../lib/zip';
import {
  PostInternAbrechnungKjrListeEndpoint,
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
    address: { postcode: zip },
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

const BODY_PERSONS = [
  { lastName: 'Schaberl', firstName: 'Martin', gender: 'm', age: 33, plz: '83620' },
  { lastName: 'Ansorge', firstName: 'Emanuel', gender: 'm', age: 10, plz: '83052' },
  { lastName: 'Gast', firstName: 'Nachgetragen', gender: 'w', age: 12, plz: '80331' },
];

function request(
  body: unknown,
  principal: object | null = PRINCIPAL,
  id = 'evt_Lager'
): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/abrechnung/${id}/kjr-liste`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(principal
        ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
        : {}),
    },
    params: { id },
    body: { string: JSON.stringify(body) },
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

test("reads the Postleitzahl from CampFlow's address.postcode", () => {
  assert.equal(
    postalCode({ id: '1', address: { postcode: '83620', city: 'Feldkirchen' } }),
    '83620'
  );
  assert.equal(postalCode({ id: '2', address: { postcode: 83052 } }), '83052');
  assert.equal(postalCode({ id: '3', address: { zip: '83043' } }), '83043');
  assert.equal(postalCode({ id: '4', address: null }), '');
  assert.equal(postalCode({ id: '5' }), '');
});

test("reads the Ort from CampFlow's address", () => {
  assert.equal(
    city({ id: '1', address: { postcode: '83620', city: ' Feldkirchen ' } }),
    'Feldkirchen'
  );
  assert.equal(city({ id: '2', address: null }), '');
});

test('subsidises Betreuer*innen and Teilnehmende from the Landkreis only', () => {
  assert.deepEqual(countPersons(PERSONS, '2026-05-24'), {
    total: 6,
    teilnehmende: 5,
    betreuende: 1,
    ab27: 1,
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

test('downloads the list with the persons and header sent by the page', async (t) => {
  mockCampflow(t);

  const response = await PostInternAbrechnungKjrListeEndpoint(
    request({
      ort: 'Zeltplatz Zellhof',
      plz: '83620',
      beginn: '10:00',
      ende: '14:30',
      persons: BODY_PERSONS,
    })
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
  // Betreuer*in and role derived on the server, the added person included
  assert.equal(cells.get('B13'), 'Schaberl');
  assert.equal(cells.get('I13'), 'ja');
  assert.equal(cells.get('B41'), 'Ansorge');
  assert.equal(cells.get('B42'), 'Gast');
  assert.equal(cells.get('M42'), '7');
});

test('younger persons can be Betreuer*innen, from 27 on always', () => {
  const base = { lastName: 'A', firstName: 'B', gender: 'w' as const, plz: '99999' };
  const persons = [
    toKjrPerson({ ...base, age: 20, betreuer: true }),
    toKjrPerson({ ...base, age: 20 }),
    toKjrPerson({ ...base, age: 30, betreuer: false }),
    toKjrPerson({ ...base, age: null, betreuer: true }),
  ];
  assert.deepEqual(
    persons.map((p) => p.betreuer),
    [true, false, true, true]
  );
  assert.deepEqual(countKjrPersons(persons), {
    total: 4,
    teilnehmende: 1,
    betreuende: 3,
    ab27: 1,
    unknownAge: 0,
    // Betreuer*innen are subsidised wherever they live
    outsideLandkreis: 1,
    subsidised: 3,
  });
});

test('lists persons chosen as Betreuer*in in part I, and keeps everyone from 27 there', async (t) => {
  mockCampflow(t);
  const response = await PostInternAbrechnungKjrListeEndpoint(
    request({
      persons: [
        {
          lastName: 'Jung',
          firstName: 'Leitung',
          gender: 'w',
          age: 19,
          plz: '83620',
          betreuer: true,
        },
        {
          lastName: 'Alt',
          firstName: 'Leitung',
          gender: 'm',
          age: 40,
          plz: '83620',
          betreuer: false,
        },
        { lastName: 'Kind', firstName: 'Teil', gender: 'm', age: 10, plz: '83620' },
      ],
    })
  );
  assert.equal(response.status, 200);
  const cells = sheetCells(Buffer.from(response.body as Uint8Array));
  const partI = [cells.get('B13'), cells.get('B14')].sort();
  assert.deepEqual(partI, ['Alt', 'Jung']);
  assert.equal(cells.get('I13'), 'ja');
  assert.equal(cells.get('I14'), 'ja');
  assert.equal(cells.get('B41'), 'Kind');
});

test('rejects invalid input and anonymous requests', async (t) => {
  mockCampflow(t);
  const valid = { persons: BODY_PERSONS };
  const status = async (
    body: unknown,
    principal: object | null = PRINCIPAL,
    id = 'evt_Lager'
  ): Promise<number | undefined> =>
    (await PostInternAbrechnungKjrListeEndpoint(request(body, principal, id))).status;

  assert.equal(await status(valid, null), 401);
  assert.equal(await status(valid, PRINCIPAL, 'x'), 400);
  assert.equal(await status({ ...valid, plz: '836' }), 400);
  assert.equal(await status({ ...valid, beginn: '25:00' }), 400);
  assert.equal(await status({ ...valid, ort: 'x'.repeat(201) }), 400);
  assert.equal(await status({}), 400);
  assert.equal(await status({ persons: [{ lastName: '', firstName: '' }] }), 400);
  assert.equal(await status({ persons: [{ lastName: 'A', gender: 'x' }] }), 400);
  assert.equal(await status({ persons: [{ lastName: 'A', age: -1 }] }), 400);
  assert.equal(await status({ persons: [{ lastName: 'A', plz: '1234' }] }), 400);
  assert.equal(await status({ persons: [{ lastName: 'A', betreuer: 'ja' }] }), 400);
  assert.equal(await status(valid, PRINCIPAL, 'evt_Unbekannt'), 404);
});
