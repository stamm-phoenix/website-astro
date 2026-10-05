import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as sharePoint from '../lib/sharepoint-data-access';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import { QuestionsCollection, QuestionItem } from '../endpoints/intern-pflege-qa';
import { GetQuestionsAndAnswersEndpoint } from '../endpoints/qa';
import { validateQuestionAndAnswer, ValidationError } from '../lib/pflege-validation';

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
const VERSION = '"item,3"';

function setup(t: TestContext): InvocationContext {
  t.mock.method(sharePoint, 'getSharePointListColumns', async () => []);
  overrideConfig(t, CONFIG.sharepoint.lists, { qa: 'faq-list' });
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

test('FAQ operations reject anonymous and non-staff identities before accessing SharePoint', async (t) => {
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

test('staff FAQ listing includes incomplete rows and their loaded versions', async (t) => {
  const context = setup(t);
  const read = t.mock.method(sharePoint, 'getSharePointListItems', async () => [
    {
      id: '1',
      eTag: VERSION,
      fields: {
        Title: INPUT.question,
        Antwort: '<div class="ExternalClass"><p onclick="bad()">Antwort</p></div>',
        Kategorie: '__proto__',
      },
    },
    { id: '2', eTag: '"item,1"', fields: { Title: '', Antwort: '' } },
    { id: 'not-an-id', fields: {} },
    null,
  ]);
  const response = await QuestionsCollection(request('GET'), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    categories: [],
    allowCustomCategories: true,
    items: [
      {
        id: '1',
        etag: VERSION,
        question: INPUT.question,
        answer: '<div><p>Antwort</p></div>',
        category: '__proto__',
        published: true,
      },
      {
        id: '2',
        etag: '"item,1"',
        question: '',
        answer: '',
        category: 'Allgemein',
        published: true,
      },
    ],
  });
  assert.deepEqual(read.mock.calls[0].arguments, ['faq-list', { expand: 'fields' }]);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
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

test('FAQ choices are exposed to the editor and enforced unless fill-in choices are enabled', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => []);
  const choices = t.mock.method(sharePoint, 'getSharePointListColumns', async () => [
    { name: 'Kategorie', choice: { choices: ['Allgemein', 'Mitmachen'], allowTextEntry: false } },
  ]);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
  const response = await QuestionsCollection(request('GET'), context);
  assert.deepEqual(response.jsonBody, {
    items: [],
    categories: ['Allgemein', 'Mitmachen'],
    allowCustomCategories: false,
  });
  assert.equal(
    (await QuestionsCollection(request('POST', { ...INPUT, category: 'Neues Thema' }), context))
      .status,
    400
  );
  assert.equal(create.mock.callCount(), 0);
  assert.equal((await QuestionsCollection(request('POST', INPUT), context)).status, 201);
  choices.mock.mockImplementation(async () => [
    { name: 'Kategorie', choice: { choices: ['Allgemein'], allowTextEntry: true } },
  ]);
  assert.equal(
    (await QuestionsCollection(request('POST', { ...INPUT, category: 'Neues Thema' }), context))
      .status,
    201
  );
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

test('creating a FAQ writes the public fields and logs the acting staff member', async (t) => {
  const context = setup(t);
  const log = t.mock.method(context, 'log', () => undefined);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
  const response = await QuestionsCollection(request('POST', INPUT), context);
  assert.equal(response.status, 201);
  assert.deepEqual(response.jsonBody, { id: '7' });
  assert.deepEqual(create.mock.calls[0].arguments, [
    'faq-list',
    {
      Title: INPUT.question,
      Antwort: INPUT.answer,
      Kategorie: INPUT.category,
      Veroeffentlicht: true,
    },
  ]);
  assert.deepEqual(log.mock.calls[0].arguments, ['[pflege] staff@example.test POST faq']);
});

test('editing and deleting FAQ entries pass the loaded ETag to SharePoint', async (t) => {
  const context = setup(t);
  const update = t.mock.method(sharePoint, 'updateSharePointListItem', async () => undefined);
  const remove = t.mock.method(sharePoint, 'deleteSharePointListItem', async () => undefined);
  assert.equal(
    (await QuestionItem(request('PATCH', { ...INPUT, etag: VERSION }, { id: '7' }), context))
      .status,
    204
  );
  assert.deepEqual(update.mock.calls[0].arguments, [
    'faq-list',
    '7',
    {
      Title: INPUT.question,
      Antwort: INPUT.answer,
      Kategorie: INPUT.category,
      Veroeffentlicht: true,
    },
    VERSION,
  ]);
  assert.equal(
    (await QuestionItem(request('DELETE', undefined, { id: '7', etag: VERSION }), context)).status,
    204
  );
  assert.deepEqual(remove.mock.calls[0].arguments, ['faq-list', '7', VERSION]);
});

test('FAQ changes require a specific version and invalid data is never written', async (t) => {
  const context = setup(t);
  const update = t.mock.method(sharePoint, 'updateSharePointListItem', async () => undefined);
  const remove = t.mock.method(sharePoint, 'deleteSharePointListItem', async () => undefined);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
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
    (await QuestionsCollection(request('POST', { ...INPUT, answer: '' }), context)).status,
    400
  );
  assert.equal(update.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test('stale updates and deletes report conflicts without logging a successful change', async (t) => {
  const context = setup(t);
  const log = t.mock.method(context, 'log', () => undefined);
  const fail = async (): Promise<never> => {
    throw { statusCode: 412 };
  };
  t.mock.method(sharePoint, 'updateSharePointListItem', fail);
  t.mock.method(sharePoint, 'deleteSharePointListItem', fail);
  for (const req of [
    request('PATCH', { ...INPUT, etag: VERSION }, { id: '7' }),
    request('DELETE', undefined, { id: '7', etag: VERSION }),
  ]) {
    const response = await QuestionItem(req, context);
    assert.equal(response.status, 409);
    assert.equal((response.jsonBody as { code: string }).code, 'CONFLICT');
  }
  assert.equal(log.mock.callCount(), 0);
});

test('missing FAQ entries return 404 and internal failures do not disclose details', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'deleteSharePointListItem', async () => {
    throw { statusCode: 404 };
  });
  assert.equal(
    (await QuestionItem(request('DELETE', undefined, { id: '7', etag: VERSION }), context)).status,
    404
  );
  assert.equal(
    (await QuestionItem(request('PATCH', INPUT, { id: '../other-list' }), context)).status,
    404
  );
  t.mock.method(sharePoint, 'getSharePointListItems', async () => {
    throw new Error('private upstream details');
  });
  const response = await QuestionsCollection(request('GET'), context);
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.jsonBody).includes('private upstream details'), false);
});

test('drafts can be created with an empty answer and unpublished or republished with an ETag', async (t) => {
  const context = setup(t);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
  const update = t.mock.method(sharePoint, 'updateSharePointListItem', async () => undefined);
  const draft = { ...INPUT, published: false, answer: '' };
  assert.equal((await QuestionsCollection(request('POST', draft), context)).status, 201);
  assert.deepEqual(create.mock.calls[0].arguments[1], {
    Title: INPUT.question,
    Antwort: '',
    Kategorie: INPUT.category,
    Veroeffentlicht: false,
  });
  assert.equal(
    (await QuestionsCollection(request('POST', { ...draft, published: true }), context)).status,
    400
  );
  for (const published of [false, true]) {
    assert.equal(
      (
        await QuestionItem(
          request('PATCH', { ...INPUT, published, etag: VERSION }, { id: '7' }),
          context
        )
      ).status,
      204
    );
    assert.deepEqual(update.mock.calls.at(-1)?.arguments, [
      'faq-list',
      '7',
      {
        Title: INPUT.question,
        Antwort: INPUT.answer,
        Kategorie: INPUT.category,
        Veroeffentlicht: published,
      },
      VERSION,
    ]);
  }
  assert.throws(() => validateQuestionAndAnswer({ ...draft, answer: 12 }), ValidationError);
  assert.throws(
    () => validateQuestionAndAnswer({ ...draft, answer: 'x'.repeat(5001) }),
    ValidationError
  );
});

test('public FAQ excludes drafts while staff can edit every publication status', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () =>
    [true, false, undefined, null, 'false'].map((status, index) => ({
      id: String(index + 1),
      eTag: VERSION,
      fields: {
        Title: INPUT.question,
        Antwort: INPUT.answer,
        Kategorie: INPUT.category,
        Veroeffentlicht: status,
      },
    }))
  );
  const publicResponse = await GetQuestionsAndAnswersEndpoint();
  assert.deepEqual(
    publicResponse.jsonBody,
    ['1', '3', '4'].map((id) => ({
      id,
      question: INPUT.question,
      answer: INPUT.answer,
      category: INPUT.category,
    }))
  );
  const staffResponse = await QuestionsCollection(request('GET'), context);
  const items = (staffResponse.jsonBody as { items: { id: string; published: boolean }[] }).items;
  assert.deepEqual(
    items.map(({ id, published }) => ({ id, published })),
    [
      { id: '1', published: true },
      { id: '2', published: false },
      { id: '3', published: true },
      { id: '4', published: true },
      { id: '5', published: false },
    ]
  );
});
