import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { pflegeHandler, ok } from '../lib/pflege-api';
import { PUBLIC_CONTENT_AREAS, requestSiteRebuild } from '../lib/site-rebuild';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

interface Dispatch {
  url: string;
  init: RequestInit;
}

function setup(t: TestContext, response: Response | Error = new Response(null, { status: 204 })) {
  const dispatches: Dispatch[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    dispatches.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  });
  const previous = process.env.GITHUB_REBUILD_TOKEN;
  process.env.GITHUB_REBUILD_TOKEN = 'test-token';
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_REBUILD_TOKEN;
    else process.env.GITHUB_REBUILD_TOKEN = previous;
  });
  const context = new InvocationContext({ functionName: 'rebuild-test' });
  const warnings: string[] = [];
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'warn', (message: string) => warnings.push(message));
  return { context, dispatches, warnings };
}

function request(method: string): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/intern/pflege/test',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
    body: method === 'GET' ? undefined : { string: '{}' },
  });
}

test('a successful change of public content requests one content build', async (t) => {
  const { context, dispatches } = setup(t);
  const handler = pflegeHandler('faq', async () => ok({ id: '1' }, 201));

  const response = await handler(request('POST'), context);

  assert.equal(response.status, 201);
  assert.equal(dispatches.length, 1);
  assert.equal(
    dispatches[0].url,
    'https://api.github.com/repos/stamm-phoenix/website-astro/dispatches'
  );
  assert.equal(
    (dispatches[0].init.headers as Record<string, string>).Authorization,
    'Bearer test-token'
  );
  assert.deepEqual(JSON.parse(String(dispatches[0].init.body)), {
    event_type: 'content-changed',
    client_payload: { area: 'faq' },
  });
});

test('reads, failed changes and internal areas do not start a build', async (t) => {
  const { context, dispatches } = setup(t);

  await pflegeHandler('faq', async () => ok([]))(request('GET'), context);
  await pflegeHandler('blog', async () => ({ status: 400 }))(request('PATCH'), context);
  for (const area of ['belege', 'sammelbestellungen', 'nikolaus-dispo']) {
    assert.equal(PUBLIC_CONTENT_AREAS.has(area), false);
    await pflegeHandler(area, async () => ok({}))(request('POST'), context);
  }

  assert.equal(dispatches.length, 0);
});

test('a refused or failed dispatch is logged but never fails the change', async (t) => {
  const refused = setup(t, new Response('{}', { status: 401 }));
  const response = await pflegeHandler('leitende', async () => ok({}))(
    request('PATCH'),
    refused.context
  );
  assert.equal(response.status, 200);
  assert.match(refused.warnings.join('\n'), /refused the content build for leitende: 401/);

  const failed = setup(t, new Error('network down'));
  await requestSiteRebuild('blog', failed.context);
  assert.match(failed.warnings.join('\n'), /network down/);
});

test('without a token nothing is sent', async (t) => {
  const { context, dispatches } = setup(t);
  delete process.env.GITHUB_REBUILD_TOKEN;

  await requestSiteRebuild('blog', context);

  assert.equal(dispatches.length, 0);
});
