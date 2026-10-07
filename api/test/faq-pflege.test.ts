import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as qaList from '../lib/qa-list';
import { QuestionsCollection, QuestionItem } from '../endpoints/intern-pflege-qa';
import { GetQuestionsAndAnswersEndpoint } from '../endpoints/qa';
import { validateQuestionAndAnswer, ValidationError } from '../lib/pflege-validation';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const INPUT = {
  question: 'Wie kann ich mitmachen?',
  answer: '<p>Schreib uns.</p>',
  category: 'Mitmachen',
  published: true,
};

interface StaffList {
  items: { id: string; etag: string; question: string; category: string; published: boolean }[];
  categories: string[];
  allowCustomCategories: boolean;
}

function setup(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'faq-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

function request(
  method: string,
  body?: unknown,
  options: { id?: string; etag?: string; principal?: unknown } = {}
): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? PRINCIPAL)
    ).toString('base64');
  }
  if (options.etag) headers['if-match'] = options.etag;
  return new HttpRequest({
    url: 'http://localhost/api/intern/pflege/qa',
    method,
    headers,
    params: options.id ? { id: options.id } : {},
    body: body === undefined || method === 'GET' ? undefined : { string: JSON.stringify(body) },
  });
}

async function list(context: InvocationContext): Promise<StaffList> {
  const response = await QuestionsCollection(request('GET'), context);
  assert.equal(response.status, 200);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
  return response.jsonBody as StaffList;
}

async function create(context: InvocationContext, input: object = INPUT): Promise<string> {
  const response = await QuestionsCollection(request('POST', input), context);
  assert.equal(response.status, 201);
  return (response.jsonBody as { id: string }).id;
}

test('FAQ operations reject anonymous and non-staff identities before accessing the database', async (t) => {
  const context = setup(t);
  for (const principal of [
    null,
    { ...PRINCIPAL, identityProvider: 'github' },
    { ...PRINCIPAL, userRoles: [] },
  ]) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const endpoint =
        method === 'PATCH' || method === 'DELETE' ? QuestionItem : QuestionsCollection;
      const response = await endpoint(request(method, INPUT, { id: '1', principal }), context);
      assert.equal(response.status, 401);
    }
  }
  const response = await QuestionsCollection(
    request('GET', undefined, {
      principal: { ...PRINCIPAL, claims: [{ typ: 'tid', val: 'another-tenant' }] },
    }),
    context
  );
  assert.equal(response.status, 403);
});

test('FAQ validation removes unsafe markup and defaults an empty category', () => {
  const input = validateQuestionAndAnswer({
    question: '  Was   machen wir? ',
    answer:
      '<script>secret()</script><p onclick="bad()">Gemeinsam <strong>spielen</strong>.</p><img src=x onerror="bad()">',
    category: ' ',
    published: true,
  });
  assert.deepEqual(input, {
    question: 'Was machen wir?',
    answer: '<p>Gemeinsam <strong>spielen</strong>.</p>',
    category: 'Allgemein',
    published: true,
  });
});

test('FAQ validation rejects missing, wrong-type, empty-markup and oversized input', () => {
  for (const [body, field] of [
    [{ ...INPUT, question: '' }, 'question'],
    ...[undefined, null, 'false', 0].map(
      (published) => [{ ...INPUT, published }, 'published'] as const
    ),
    [{ ...INPUT, question: 'x'.repeat(256) }, 'question'],
    [{ ...INPUT, category: 12 }, 'category'],
    [{ ...INPUT, category: 'x'.repeat(101) }, 'category'],
    [{ ...INPUT, answer: 12 }, 'answer'],
    [{ ...INPUT, answer: '<p><br>&nbsp;&#160;&#xA0;</p>' }, 'answer'],
    [{ ...INPUT, answer: '<script>hidden</script>' }, 'answer'],
    [{ ...INPUT, answer: 'x'.repeat(5001) }, 'answer'],
  ] as const) {
    assert.throws(
      () => validateQuestionAndAnswer(body),
      (error: unknown) =>
        error instanceof ValidationError && typeof error.fields[field] === 'string'
    );
  }
});

test('FAQ changes without a well-formed version are rejected before the database', async (t) => {
  const context = setup(t);
  for (const etag of [undefined, '*', ' * ', 'invalid']) {
    assert.equal(
      (await QuestionItem(request('PATCH', { ...INPUT, etag }, { id: '7' }), context)).status,
      400
    );
    assert.equal(
      (await QuestionItem(request('DELETE', undefined, { id: '7', etag }), context)).status,
      400
    );
  }
  assert.equal(
    (await QuestionItem(request('PATCH', INPUT, { id: '../other-list' }), context)).status,
    404
  );
});

test('internal FAQ failures do not disclose details', async (t) => {
  const context = setup(t);
  t.mock.method(qaList, 'getStaffQuestionsAndAnswers', async () => {
    throw new Error('private upstream details');
  });
  const response = await QuestionsCollection(request('GET'), context);
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.jsonBody).includes('private upstream details'), false);
});

dbTest('creating a FAQ stores it, logs the acting staff member and offers its topic', async (t) => {
  const context = setup(t);
  const log = t.mock.method(context, 'log', () => undefined);
  const id = await create(context);
  await create(context, { ...INPUT, question: 'Was kostet das?', category: 'Allgemein' });
  assert.deepEqual(log.mock.calls[0].arguments, ['[pflege] staff@example.test POST faq']);

  const data = await list(context);
  assert.deepEqual(data.categories, ['Allgemein', 'Mitmachen']);
  assert.equal(data.allowCustomCategories, true);
  const item = data.items.find((entry) => entry.id === id);
  assert.ok(item);
  assert.match(item.etag, /^"[0-9a-f]{16}"$/);
  assert.deepEqual({ ...item, etag: undefined }, { ...INPUT, id, etag: undefined });
});

dbTest('editing and deleting a FAQ require the loaded version', async (t) => {
  const context = setup(t);
  const id = await create(context);
  const [loaded] = (await list(context)).items;

  const edit = (etag: string) =>
    QuestionItem(request('PATCH', { ...INPUT, question: 'Neu?', etag }, { id }), context);
  assert.equal((await edit(loaded.etag)).status, 204);
  // The version changed with the edit, so the old one is stale now
  const stale = await edit(loaded.etag);
  assert.equal(stale.status, 409);
  assert.equal((stale.jsonBody as { code: string }).code, 'CONFLICT');
  assert.equal(
    (await QuestionItem(request('DELETE', undefined, { id, etag: loaded.etag }), context)).status,
    409
  );

  const [current] = (await list(context)).items;
  assert.equal(current.question, 'Neu?');
  assert.equal(
    (await QuestionItem(request('DELETE', undefined, { id, etag: current.etag }), context)).status,
    204
  );
  assert.deepEqual((await list(context)).items, []);
  assert.equal(
    (await QuestionItem(request('DELETE', undefined, { id, etag: current.etag }), context)).status,
    404
  );
});

dbTest('drafts can have an empty answer and are only shown to staff', async (t) => {
  const context = setup(t);
  const draft = { ...INPUT, published: false, answer: '' };
  const draftId = await create(context, draft);
  const publishedId = await create(context);
  assert.equal(
    (await QuestionsCollection(request('POST', { ...draft, published: true }), context)).status,
    400
  );

  const publicResponse = await GetQuestionsAndAnswersEndpoint();
  assert.deepEqual(publicResponse.jsonBody, [
    { id: publishedId, question: INPUT.question, answer: INPUT.answer, category: INPUT.category },
  ]);
  const items = (await list(context)).items;
  assert.deepEqual(
    items.map(({ id, published }) => ({ id, published })),
    [
      { id: draftId, published: false },
      { id: publishedId, published: true },
    ]
  );

  // Publishing a draft needs an answer
  const [loadedDraft] = items;
  assert.equal(
    (
      await QuestionItem(
        request('PATCH', { ...draft, published: true, etag: loadedDraft.etag }, { id: draftId }),
        context
      )
    ).status,
    400
  );
  assert.equal(
    (
      await QuestionItem(
        request('PATCH', { ...INPUT, etag: loadedDraft.etag }, { id: draftId }),
        context
      )
    ).status,
    204
  );
  assert.equal(((await GetQuestionsAndAnswersEndpoint()).jsonBody as unknown[]).length, 2);
});
