import { HttpRequest, InvocationContext } from '@azure/functions';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as campflow from '../lib/campflow';
import { CONFIG } from '../lib/config';
import { AbrechnungZeitplanEndpoint } from '../endpoints/intern-abrechnung-zeitplan';
import { aktionTage, normalizeTime, toZeitplan } from '../lib/kurzbeschreibung-zeitplan';
import { columnIndex, excelNumber, xlsxToText } from '../lib/xlsx-text';
import { writeZip } from '../lib/zip';
import { overrideConfig } from './fixtures/config';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'leiterin',
  userDetails: 'leiterin@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function xlsx(sheets: { name: string; rows: string }[], strings: string[]): Uint8Array {
  return new Uint8Array(
    writeZip([
      {
        name: 'xl/workbook.xml',
        data: Buffer.from(
          `<workbook xmlns:r="r"><sheets>${sheets
            .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join('')}</sheets></workbook>`
        ),
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: Buffer.from(
          `<Relationships>${sheets
            .map(
              (_s, i) =>
                `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
            )
            .join('')}</Relationships>`
        ),
      },
      {
        name: 'xl/sharedStrings.xml',
        data: Buffer.from(
          `<sst>${strings.map((s) => `<si><t xml:space="preserve">${s}</t></si>`).join('')}</sst>`
        ),
      },
      ...sheets.map((s, i) => ({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: Buffer.from(`<worksheet><sheetData>${s.rows}</sheetData></worksheet>`),
      })),
    ])
  );
}

test('Excel sheets become lines with times, dates, shared and inline strings', () => {
  // Defect: Excel stores „08:00“ as 0.3333 and dates as serial numbers; handed over raw, the
  // model would have to guess the Zeitplan's times
  const text = xlsxToText(
    xlsx(
      [
        {
          name: 'Lager &amp; Plan',
          rows:
            '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
            '<row r="2"><c r="A2"><v>0.333333333333333</v></c><c r="B2"><v>0.375</v></c>' +
            '<c r="C2" t="s"><v>1</v></c></row>' +
            '<row r="3"><c r="A3"/><c r="B3" t="inlineStr"><is><t>Hike</t></is></c></row>' +
            '<row r="4"></row>',
        },
        { name: 'Material', rows: '<row r="1"><c r="A1"><v>46166</v></c></row>' },
      ],
      ['Montag', 'Frühstück &amp; Morgenrunde']
    )
  );
  assert.equal(
    text,
    '# Lager & Plan\nMontag\n08:00 | 09:00 | Frühstück & Morgenrunde\n | Hike\n\n# Material\n24.05.2026'
  );
  assert.equal(excelNumber('3'), '3');

  // Defect: dropping empty cells put an item under Dienstag in column B under Montag
  const plan = (cells: string): string =>
    xlsxToText(
      xlsx(
        [
          {
            name: 'Plan',
            rows:
              '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
              `<row r="2">${cells}</row>`,
          },
        ],
        ['Montag', 'Dienstag', 'Frühstück']
      )
    );
  assert.equal(plan('<c r="A2" t="s"><v>2</v></c>'), '# Plan\nMontag | Dienstag\nFrühstück');
  assert.equal(plan('<c r="B2" t="s"><v>2</v></c>'), '# Plan\nMontag | Dienstag\n | Frühstück');
  assert.equal(columnIndex('AB12'), 27);

  // Defect: workbooks in the 1904 date system (older Mac files) were read four years off
  assert.equal(excelNumber('44704', true), '24.05.2026');
  assert.equal(excelNumber('0.5', true), '12:00');
  const mac = Buffer.from(
    writeZip([
      {
        name: 'xl/workbook.xml',
        data: Buffer.from('<workbook><workbookPr date1904="1"/></workbook>'),
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(
          '<worksheet><sheetData><row r="1"><c r="A1"><v>44704</v></c></row></sheetData></worksheet>'
        ),
      },
    ])
  );
  assert.equal(xlsxToText(new Uint8Array(mac)), '# Tabelle 1\n24.05.2026');
  assert.equal(excelNumber('46166.75'), '24.05.2026 18:00');
});

test('the model answer is checked: times normalised, unknown days and empty blocks dropped', () => {
  const zeitplan = toZeitplan({
    einleitung: '  Wir   bringen Fantasie in den Alltag. ',
    tage: [
      {
        datum: '2026-05-25',
        bloecke: [
          { von: '8', bis: '14.00', text: 'Hike + Anreise' },
          { von: '', bis: '23:00', text: 'Ganztags' },
          { von: '20:30', bis: 'offen', text: 'Versprechen' },
          { von: '09:00', bis: '10:00', text: '   ' },
        ],
      },
      { datum: 'Montag', bloecke: [{ von: '08:00', bis: '', text: 'x' }] },
      { datum: '2026-05-24', bloecke: [{ von: '', bis: '', text: 'Hike' }] },
      { datum: '2026-05-26', bloecke: [] },
    ],
  });
  assert.deepEqual(zeitplan, {
    einleitung: 'Wir bringen Fantasie in den Alltag.',
    tage: [
      { datum: '2026-05-24', bloecke: [{ von: '', bis: '', text: 'Hike' }] },
      {
        datum: '2026-05-25',
        bloecke: [
          { von: '08:00', bis: '14:00', text: 'Hike + Anreise' },
          { von: '', bis: '', text: 'Ganztags' },
          { von: '20:30', bis: '', text: 'Versprechen' },
        ],
      },
    ],
    ausgelassen: 0,
  });
  assert.equal(toZeitplan({ einleitung: null, tage: 'x' }).tage.length, 0);
  // Defect: blocks beyond the limits were dropped without the page knowing
  const voll = toZeitplan({
    einleitung: null,
    tage: [
      {
        datum: '2026-05-24',
        bloecke: Array.from({ length: 31 }, (_b, i) => ({ von: '', bis: '', text: `P${i}` })),
      },
    ],
  });
  assert.equal(voll.tage[0].bloecke.length, 30);
  assert.equal(voll.ausgelassen, 1);
  assert.throws(() => toZeitplan('nein'));
  assert.equal(normalizeTime('24'), '00:00');
  assert.equal(normalizeTime('25:00'), '');
  assert.deepEqual(aktionTage('2026-05-30', '2026-06-01'), [
    'Samstag, 2026-05-30',
    'Sonntag, 2026-05-31',
    'Montag, 2026-06-01',
  ]);
  assert.deepEqual(aktionTage(null, null), []);
});

function request(body: unknown, id = 'evt_Lager'): HttpRequest {
  return new HttpRequest({
    url: `http://localhost/api/intern/abrechnung/${id}/zeitplan`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
    params: { id },
    body: { string: JSON.stringify(body) },
  });
}

function context(t: TestContext): InvocationContext {
  const ctx = new InvocationContext({ functionName: 'zeitplan-test' });
  t.mock.method(ctx, 'log', () => undefined);
  return ctx;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');

function setup(t: TestContext, answer: unknown): { bodies: Record<string, unknown>[] } {
  overrideConfig(t, CONFIG.belege.check, {
    endpoint: 'https://openai.example.test',
    deployment: 'gpt-test',
  });
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
  });
  t.mock.method(campflow, 'getCampflowEvents', async () => [
    {
      id: 'evt_Lager',
      title: 'Stammeslager',
      // 22:30 UTC is already the next day in Berlin (summer time)
      start_date: '2026-05-23T22:30:00Z',
      end_date: '2026-05-25',
    },
  ]);
  const bodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
      { status: 200 }
    );
  });
  return { bodies };
}

test('a photo is read with the days of the Aktion and the answer prefills the Zeitplan', async (t) => {
  const { bodies } = setup(t, {
    einleitung: null,
    tage: [{ datum: '2026-05-25', bloecke: [{ von: '18:00', bis: '19:00', text: 'Abendessen' }] }],
  });
  const response = await AbrechnungZeitplanEndpoint(request({ bilder: [JPEG] }), context(t));
  assert.equal(response.status ?? 200, 200);
  assert.deepEqual(response.jsonBody, {
    available: true,
    zeitplan: {
      einleitung: null,
      tage: [
        { datum: '2026-05-25', bloecke: [{ von: '18:00', bis: '19:00', text: 'Abendessen' }] },
      ],
      ausgelassen: 0,
    },
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].reasoning_effort, 'low');
  const messages = bodies[0].messages as { content: unknown }[];
  assert.match(String(messages[0].content), /Sonntag, 2026-05-24\nMontag, 2026-05-25/);
  assert.doesNotMatch(String(messages[0].content), /2026-05-23/);
  assert.match(JSON.stringify(messages[1].content), /data:image\/jpeg;base64/);
});

test('an Excel file goes to the model as text; wrong files never reach it', async (t) => {
  const { bodies } = setup(t, { einleitung: 'Ziel', tage: [] });
  const data = Buffer.from(
    xlsx([{ name: 'Plan', rows: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }], ['Hike'])
  ).toString('base64');
  const ok = await AbrechnungZeitplanEndpoint(
    request({ tabelle: { name: 'Plan.xlsx', data } }),
    context(t)
  );
  assert.equal(ok.status ?? 200, 200);
  assert.deepEqual(bodies[0].messages && (bodies[0].messages as { content: unknown }[])[1], {
    role: 'user',
    content: [{ type: 'text', text: '# Plan\nHike' }],
  });

  for (const body of [
    { tabelle: { name: 'Plan.xls', data } },
    { tabelle: { name: 'Plan.xlsx', data: Buffer.from('kein zip').toString('base64') } },
    { bilder: [Buffer.from('GIF89a').toString('base64')] },
    { bilder: [JPEG, JPEG, JPEG, JPEG, JPEG] },
    // A long material list before the Zeitplan is refused instead of cut off
    { tabelle: { name: 'lang.csv', data: Buffer.from('x;'.repeat(20_001)).toString('base64') } },
    {},
  ]) {
    const response = await AbrechnungZeitplanEndpoint(request(body), context(t));
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(bodies.length, 1);
});

test('without a model the page is told so and nothing is sent', async (t) => {
  overrideConfig(t, CONFIG.belege.check, { endpoint: '' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No fetch expected');
  });
  const response = await AbrechnungZeitplanEndpoint(request({ bilder: [JPEG] }), context(t));
  assert.deepEqual(response.jsonBody, { available: false, zeitplan: null });
  assert.equal(fetch.mock.callCount(), 0);
});

test('a failing model answers with a message and changes nothing', async (t) => {
  setup(t, null);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }));
  const response = await AbrechnungZeitplanEndpoint(request({ bilder: [JPEG] }), context(t));
  assert.equal(response.status, 502);
});
