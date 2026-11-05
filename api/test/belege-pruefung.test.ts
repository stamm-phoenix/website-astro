/** The check of receipt photos and PDF pages before and when they are submitted. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { CONFIG } from '../lib/config';
import { getBelege } from '../lib/beleg-list';
import { overrideConfig } from './fixtures/config';
import { BelegeCollection } from '../endpoints/intern-pflege-belege';
import { BelegPruefung } from '../endpoints/intern-pflege-beleg-pruefung';
import {
  BelegCheckError,
  forgetBelegChecks,
  parseStoredBelegCheck,
  toBelegCheck,
} from '../lib/beleg-check';
import { dbTest } from './fixtures/database';
import { INPUT, jpeg, request, setup } from './fixtures/belege';

const MODEL_ANSWER = {
  isReceipt: true,
  complete: false,
  readable: true,
  issues: ['  Der untere Rand   ist abgeschnitten. ', 7],
  restrictedItems: [' Augustiner  Hell 0,5l ', null],
  shop: 'REWE',
  date: '2026-09-30',
  amount: 12.34,
};

const MODEL_ENDPOINT = 'https://example.openai.azure.com';

function withModel(t: TestContext, maxChecksPerDay = 1000): void {
  overrideConfig(t, CONFIG.belege.check, {
    endpoint: MODEL_ENDPOINT,
    deployment: 'gpt-6.1-sol-datazone',
    reasoningEffort: 'high',
    maxChecksPerDay,
  });
  // Every test asks the model afresh
  forgetBelegChecks();
  t.after(forgetBelegChecks);
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
  });
}

function mockModel(t: TestContext, answer: unknown = MODEL_ANSWER, status = 200) {
  return t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
        { status }
      )
  );
}

test('the model answer is normalized and never trusted blindly', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  assert.deepEqual(toBelegCheck(MODEL_ANSWER, now), {
    ok: false,
    isReceipt: true,
    complete: false,
    readable: true,
    unsignedEigenbeleg: false,
    issues: ['Der untere Rand ist abgeschnitten.'],
    restrictedItems: ['Augustiner Hell 0,5l'],
    shop: 'REWE',
    date: '2026-09-30',
    amountCent: 1234,
    checkedAt: '2026-10-01T10:00:00.000Z',
  });
  const notAReceipt = toBelegCheck(
    {
      isReceipt: false,
      complete: true,
      readable: true,
      issues: [],
      restrictedItems: ['Bier'],
      date: '30.9.',
      amount: -1,
    },
    now
  );
  assert.equal(notAReceipt.ok, false);
  assert.deepEqual(notAReceipt.restrictedItems, []);
  // Restricted items are a hint for the Kasse and do not make a good photo unfit
  assert.equal(toBelegCheck({ ...MODEL_ANSWER, complete: true }, now).ok, true);
  assert.equal(notAReceipt.complete, false);
  assert.equal(notAReceipt.date, null);
  assert.equal(notAReceipt.amountCent, null);
  assert.throws(() => toBelegCheck('nonsense'), BelegCheckError);
});

test('the photo check sends the image to the configured deployment', async (t) => {
  const { context } = setup(t);
  withModel(t);
  const fetch = mockModel(t);
  const response = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.equal(response.status, 200);
  const body = response.jsonBody as { available: boolean; check: { ok: boolean } };
  assert.equal(body.available, true);
  assert.equal(body.check.ok, false);
  const [url, init] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(url, 'https://example.openai.azure.com/openai/v1/chat/completions');
  assert.equal((init.headers as Record<string, string>)['api-key'], 'test-key');
  const sent = JSON.parse(String(init.body)) as {
    model: string;
    messages: { content: unknown }[];
    reasoning_effort?: string;
    temperature?: number;
    max_completion_tokens: number;
  };
  assert.equal(sent.model, 'gpt-6.1-sol-datazone');
  assert.match(JSON.stringify(sent.messages[1].content), /data:image\/jpeg;base64,/);
  // A reasoning model refuses `temperature`, and its thinking counts against the tokens
  assert.equal(sent.reasoning_effort, 'high');
  assert.equal('temperature' in sent, false);
  assert.ok(sent.max_completion_tokens >= 4000);
});

test('the pages of a PDF are checked together as one receipt', async (t) => {
  const { context } = setup(t);
  withModel(t);
  const fetch = mockModel(t);
  const page = (height: number) => Buffer.from(jpeg(1400, height)).toString('base64');
  const response = await BelegPruefung(
    request('POST', { pages: [page(2000), page(2001)] }),
    context
  );
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { available: boolean }).available, true);
  const sent = JSON.parse(String((fetch.mock.calls[0].arguments[1] as RequestInit).body)) as {
    messages: { content: { type: string; text?: string }[] }[];
  };
  const parts = sent.messages[1].content;
  assert.deepEqual(
    parts.map((part) => part.type),
    ['text', 'image_url', 'image_url']
  );
  assert.match(parts[0].text ?? '', /Seiten desselben Belegs/);

  // Too many pages, or none, are refused without asking the model
  const many = await BelegPruefung(
    request('POST', { pages: new Array(6).fill(page(2000)) }),
    context
  );
  assert.equal(many.status, 400);
  assert.equal((await BelegPruefung(request('POST', { pages: [] }), context)).status, 400);
  assert.equal(fetch.mock.callCount(), 1);
});

dbTest('submitting a PDF checks its further pages along with the first', async (t) => {
  const { context } = setup(t);
  withModel(t);
  const fetch = mockModel(t);
  const photo = Buffer.from(jpeg(1400, 2000)).toString('base64');
  const pages = [Buffer.from(jpeg(1400, 2001)).toString('base64')];
  const pdf = Buffer.from('%PDF-1.4 zwei Seiten').toString('base64');
  const response = await BelegeCollection(
    request('POST', { ...INPUT, photo, pdf, pages }),
    context
  );
  assert.equal(response.status, 201);
  assert.equal(fetch.mock.callCount(), 1);
  const sent = JSON.parse(String((fetch.mock.calls[0].arguments[1] as RequestInit).body)) as {
    messages: { content: { type: string }[] }[];
  };
  assert.equal(sent.messages[1].content.filter((part) => part.type === 'image_url').length, 2);
});

test('the form asks first only how to turn the photo, quickly and with little thinking', async (t) => {
  const { context } = setup(t);
  withModel(t);
  const fetch = mockModel(t, { rotation: 270 });
  const response = await BelegPruefung(
    request('POST', jpeg(1600, 1200), { query: '?nur=drehung' }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { available: true, rotation: 270 });
  const sent = JSON.parse(String((fetch.mock.calls[0].arguments[1] as RequestInit).body)) as {
    reasoning_effort?: string;
    response_format: { json_schema: { name: string } };
  };
  assert.equal(sent.reasoning_effort, 'low');
  assert.equal(sent.response_format.json_schema.name, 'belegdrehung');

  // Anything but a quarter turn means upright
  fetch.mock.restore();
  mockModel(t, { rotation: 45 });
  const odd = await BelegPruefung(
    request('POST', jpeg(1600, 1201), { query: '?nur=drehung' }),
    context
  );
  assert.deepEqual(odd.jsonBody, { available: true, rotation: 0 });
});

dbTest('submitting the checked photo reuses the check instead of asking again', async (t) => {
  const { context } = setup(t);
  withModel(t);
  const fetch = mockModel(t);
  const bytes = jpeg(1200, 1600);
  assert.equal((await BelegPruefung(request('POST', bytes), context)).status, 200);
  const photo = Buffer.from(bytes).toString('base64');
  assert.equal((await BelegeCollection(request('POST', { ...INPUT, photo }), context)).status, 201);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await getBelege())[0]?.aiCheck?.ok, false);

  // Another photo is checked anew
  const other = Buffer.from(jpeg(1200, 1601)).toString('base64');
  await BelegeCollection(request('POST', { ...INPUT, photo: other }), context);
  assert.equal(fetch.mock.callCount(), 2);
});

test('models without reasoning get temperature 0 as before', async (t) => {
  const { context } = setup(t);
  withModel(t);
  CONFIG.belege.check.reasoningEffort = undefined;
  const fetch = mockModel(t);
  await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  const [, init] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(sent.temperature, 0);
  assert.equal('reasoning_effort' in sent, false);
});

dbTest('without a model the check is skipped and failures never block submitting', async (t) => {
  const { context } = setup(t);
  withModel(t);
  CONFIG.belege.check.endpoint = '';
  const skipped = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.deepEqual(skipped.jsonBody, { available: false, check: null });

  CONFIG.belege.check.endpoint = MODEL_ENDPOINT;
  mockModel(t, {}, 500);
  const failed = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.equal(failed.status, 502);

  t.mock.method(context, 'warn', () => undefined);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  const created = await BelegeCollection(request('POST', { ...INPUT, photo }), context);
  assert.equal(created.status, 201);
  assert.equal((await getBelege())[0]?.aiCheck, null);
});

dbTest('submitting stores the check with the receipt', async (t) => {
  const { context } = setup(t);
  withModel(t);
  mockModel(t);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  assert.equal((await BelegeCollection(request('POST', { ...INPUT, photo }), context)).status, 201);
  const stored = (await getBelege())[0]?.aiCheck;
  assert.equal(stored?.ok, false);
  assert.deepEqual(stored?.issues, ['Der untere Rand ist abgeschnitten.']);
  assert.deepEqual(stored?.restrictedItems, ['Augustiner Hell 0,5l']);
  // Checks stored before restricted items existed still parse
  assert.deepEqual(parseStoredBelegCheck('{"ok":true,"issues":[]}')?.restrictedItems, []);
});

test('the daily limit stops calling the model', async (t) => {
  const { context } = setup(t);
  withModel(t, 0);
  const fetch = mockModel(t);
  const response = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.equal(response.status, 429);
  assert.equal(fetch.mock.callCount(), 0);
});
