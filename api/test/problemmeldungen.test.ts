import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { sql } from 'kysely';
import { ProblemMeldungSendEndpoint } from '../endpoints/problemmeldung';
import {
  ProblemMeldungAssessEndpoint,
  ProblemMeldungDiscardEndpoint,
  ProblemMeldungGithubEndpoint,
  ProblemMeldungItemEndpoint,
  ProblemMeldungenCollectionEndpoint,
} from '../endpoints/intern-pflege-problemmeldungen';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import {
  createProblemMeldung,
  purgeExpiredProblemMeldungen,
  resetProblemPurge,
} from '../lib/problemmeldungen';
import { validateProblemReport } from '../lib/problemmeldung-model';
import type { StaffProblemMeldung } from '../lib/problemmeldung-model';
import { solvedAltcha, useAltcha } from './fixtures/altcha';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

const REPORT = {
  description: 'Beim Einreichen eines Belegs kommt eine Fehlermeldung.',
  steps: '1. Belege öffnen',
  contact: 'erika@example.test',
  entry: 'fehler',
  context: {
    page: '/leitendenbereich/belege?token=geheim',
    errorCode: 'INTERNAL',
    httpStatus: 500,
    action: '/api/intern/pflege/belege',
    appVersion: 'abc1234',
    browser: 'Firefox 133 · Linux',
    viewport: '390x844',
  },
};

const ANSWER = {
  verdict: 'plausibel',
  reason: 'Konkret und nachvollziehbar.',
  title: 'Belege: Einreichen schlägt fehl',
  summary: 'Beim Einreichen eines Belegs erscheint eine Fehlermeldung.',
  steps: '1. Belege öffnen',
  expected: 'Unbekannt.',
  actual: 'Fehlermeldung (HTTP 500).',
  label: 'bug',
};

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

interface Calls {
  openai: number;
  github: { method: string; url: string; body: Record<string, unknown> | null }[];
}

/** Simulates Azure OpenAI and GitHub; no request leaves the test. */
function setup(
  t: TestContext,
  handlers: { openai?: Handler; github?: Handler } = {}
): { context: InvocationContext; calls: Calls } {
  useAltcha(t);
  const keys = { AZURE_OPENAI_API_KEY: 'test-key', GITHUB_ISSUES_TOKEN: 'test-token' } as const;
  for (const [name, value] of Object.entries(keys)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const calls: Calls = { openai: 0, github: [] };
  const openai: Handler =
    handlers.openai ??
    (() =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] })
      ));
  const github: Handler =
    handlers.github ??
    ((_url, init) =>
      init.method === 'POST'
        ? new Response(
            JSON.stringify({
              number: 301,
              html_url: 'https://github.com/stamm-phoenix/website-astro/issues/301',
            }),
            { status: 201 }
          )
        : new Response('[]'));
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (new URL(url).hostname.endsWith('.openai.azure.com')) {
      calls.openai++;
      return openai(url, init);
    }
    assert.ok(
      url.startsWith('https://api.github.com/repos/stamm-phoenix/website-astro/issues'),
      url
    );
    calls.github.push({
      method: init.method ?? 'GET',
      url,
      body:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    return github(url, init);
  });
  const context = new InvocationContext({ functionName: 'problemmeldung-test' });
  for (const level of ['log', 'warn', 'error'] as const)
    t.mock.method(context, level, () => undefined);
  return { context, calls };
}

function request(
  method: string,
  body?: unknown,
  options: { id?: string; principal?: unknown } = {}
): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? PRINCIPAL)
    ).toString('base64');
  }
  return new HttpRequest({
    url: 'http://localhost/api/problemmeldung',
    method,
    headers,
    params: options.id ? { id: options.id } : {},
    body: body === undefined || method === 'GET' ? undefined : { string: JSON.stringify(body) },
  });
}

async function submit(context: InvocationContext, extra: object = {}): Promise<string> {
  const response = await ProblemMeldungSendEndpoint(
    request('POST', { ...REPORT, altcha: await solvedAltcha(), ...extra }),
    context
  );
  assert.equal(response.status, 200);
  return (response.jsonBody as { id: string }).id.replace('PM-', '');
}

async function list(context: InvocationContext): Promise<StaffProblemMeldung[]> {
  const response = await ProblemMeldungenCollectionEndpoint(request('GET'), context);
  assert.equal(response.status, 200);
  return (response.jsonBody as { items: StaffProblemMeldung[] }).items;
}

async function load(context: InvocationContext, id: string): Promise<StaffProblemMeldung> {
  const item = (await list(context)).find((entry) => entry.id === id);
  assert.ok(item);
  return item;
}

const send = (context: InvocationContext, id: string, etag: string) =>
  ProblemMeldungGithubEndpoint(request('POST', { etag }, { id }), context);

dbTest('a report is stored cleaned, assessed and shown to leaders', async (t) => {
  const { context, calls } = setup(t);
  const id = await submit(context);
  assert.equal(calls.openai, 1);
  assert.equal(calls.github.length, 0);

  const item = await load(context, id);
  assert.equal(item.status, 'neu');
  assert.equal(item.entry, 'fehler');
  assert.equal(item.environment, 'produktion');
  assert.equal(item.contact, 'erika@example.test');
  assert.equal(item.context.page, '/leitendenbereich/belege');
  assert.equal(item.context.httpStatus, 500);
  assert.equal(item.ai.status, 'fertig');
  assert.equal(item.ai.verdict, 'plausibel');
  assert.equal(item.draft.title, ANSWER.title);
  assert.match(item.draft.body, /## Zusammenfassung/);
  assert.equal(item.github.number, null);
});

dbTest('a failing assessment never loses the report and can be started again', async (t) => {
  let failing = true;
  const { context, calls } = setup(t, {
    openai: () =>
      failing
        ? new Response('boom', { status: 500 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] })
          ),
  });
  const id = await submit(context);
  const failed = await load(context, id);
  assert.equal(failed.ai.status, 'fehler');
  assert.match(failed.ai.error, /500/);
  assert.ok(!failed.ai.error.includes('Belegs'));
  assert.equal(failed.draft.title, '');

  failing = false;
  const retry = await ProblemMeldungAssessEndpoint(request('POST', {}, { id }), context);
  assert.equal(retry.status, 200);
  const assessed = await load(context, id);
  assert.equal(assessed.ai.status, 'fertig');
  assert.equal(assessed.draft.title, ANSWER.title);
  assert.equal(calls.openai, 2);

  const again = await ProblemMeldungAssessEndpoint(request('POST', {}, { id }), context);
  assert.equal(again.status, 409);
  assert.equal(calls.openai, 2);
});

dbTest('an assessment never overwrites a draft a leader started', async (t) => {
  let failing = true;
  const { context } = setup(t, {
    openai: () =>
      failing
        ? new Response('boom', { status: 503 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] })
          ),
  });
  const id = await submit(context);
  const item = await load(context, id);
  const saved = await ProblemMeldungItemEndpoint(
    request(
      'PATCH',
      { title: 'Mein Titel', body: 'Mein Text', label: 'question', etag: item.etag },
      { id }
    ),
    context
  );
  assert.equal(saved.status, 200);

  failing = false;
  await ProblemMeldungAssessEndpoint(request('POST', {}, { id }), context);
  const after = await load(context, id);
  assert.equal(after.ai.status, 'fertig');
  assert.deepEqual(after.draft, { title: 'Mein Titel', body: 'Mein Text', label: 'question' });
});

dbTest(
  'the public form rejects a honeypot, bad input, a bad proof and too many reports',
  async (t) => {
    const { context, calls } = setup(t);
    const post = async (body: object) => ProblemMeldungSendEndpoint(request('POST', body), context);

    assert.equal(
      (await post({ ...REPORT, website: 'http://spam', altcha: await solvedAltcha() })).status,
      200
    );
    assert.equal((await post({ description: 'kurz', altcha: await solvedAltcha() })).status, 400);
    assert.equal((await post({ ...REPORT })).status, 403);
    assert.equal((await list(context)).length, 0);
    assert.equal(calls.openai, 0);

    overrideConfig(t, CONFIG, {
      problemmeldung: { ...CONFIG.problemmeldung, hourlyLimit: 1 },
    });
    await submit(context);
    assert.equal((await post({ ...REPORT, altcha: await solvedAltcha() })).status, 429);
    assert.equal((await list(context)).length, 1);
  }
);

dbTest('the leader endpoints refuse everyone but leaders', async (t) => {
  const { context } = setup(t);
  const id = await submit(context);
  for (const principal of [null, { ...PRINCIPAL, userRoles: [] }]) {
    for (const [endpoint, method] of [
      [ProblemMeldungenCollectionEndpoint, 'GET'],
      [ProblemMeldungItemEndpoint, 'PATCH'],
      [ProblemMeldungDiscardEndpoint, 'POST'],
      [ProblemMeldungGithubEndpoint, 'POST'],
      [ProblemMeldungAssessEndpoint, 'POST'],
    ] as const) {
      const response = await endpoint(request(method, {}, { id, principal }), context);
      assert.equal(response.status, 401);
    }
  }
});

dbTest('saving the draft needs the loaded version and moves the report into review', async (t) => {
  const { context } = setup(t);
  const id = await submit(context);
  const item = await load(context, id);
  const patch = (etag: string, title = 'Neuer Titel') =>
    ProblemMeldungItemEndpoint(
      request('PATCH', { title, body: 'Text', label: 'enhancement', etag }, { id }),
      context
    );

  assert.equal((await patch(item.etag, '')).status, 400);
  assert.equal((await patch('"0000000000000000"')).status, 409);
  assert.equal((await patch(item.etag)).status, 200);
  const saved = await load(context, id);
  assert.equal(saved.status, 'in_pruefung');
  assert.equal(saved.reviewedBy, 'staff@example.test');
  assert.deepEqual(saved.draft, { title: 'Neuer Titel', body: 'Text', label: 'enhancement' });

  assert.equal((await patch(item.etag)).status, 409);
});

dbTest('a draft that is too long is refused instead of cut', async (t) => {
  const { context } = setup(t);
  const id = await submit(context);
  const item = await load(context, id);
  const response = await ProblemMeldungItemEndpoint(
    request(
      'PATCH',
      { title: 'T', body: 'ab '.repeat(2700), label: 'bug', etag: item.etag },
      { id }
    ),
    context
  );
  assert.equal(response.status, 400);
  assert.ok((response.jsonBody as { fields: Record<string, string> }).fields.body);
  assert.equal((await load(context, id)).draft.title, ANSWER.title);
});

dbTest('discarding keeps the reason, deletes the contact and blocks the hand-over', async (t) => {
  const { context, calls } = setup(t);
  const id = await submit(context);
  const item = await load(context, id);
  const discard = await ProblemMeldungDiscardEndpoint(
    request('POST', { reason: 'Kein Fehler.', etag: item.etag }, { id }),
    context
  );
  assert.equal(discard.status, 200);
  const discarded = await load(context, id);
  assert.equal(discarded.status, 'verworfen');
  assert.equal(discarded.discardReason, 'Kein Fehler.');
  assert.equal(discarded.contact, '');
  assert.ok(discarded.reviewedAt);

  assert.equal((await send(context, id, discarded.etag)).status, 409);
  assert.equal(
    (
      await ProblemMeldungDiscardEndpoint(
        request('POST', { etag: discarded.etag }, { id }),
        context
      )
    ).status,
    409
  );
  assert.equal(calls.github.length, 0);
});

dbTest(
  'nothing reaches GitHub without a leader, and then only title, text and technical details',
  async (t) => {
    const { context, calls } = setup(t);
    const id = await submit(context);
    assert.equal(calls.github.length, 0);

    const item = await load(context, id);
    const response = await send(context, id, item.etag);
    assert.equal(response.status, 200);
    assert.equal(calls.github.length, 1);
    const [created] = calls.github;
    assert.equal(created.method, 'POST');
    assert.equal(created.body?.title, ANSWER.title);
    assert.deepEqual(created.body?.labels, ['bug']);
    const body = String(created.body?.body);
    assert.match(body, /## Zusammenfassung/);
    assert.match(body, /\| HTTP-Status \| 500 \|/);
    assert.match(body, new RegExp(`Problemmeldung PM-${id} ·`));
    assert.ok(!body.includes('erika@example.test'));
    assert.ok(!body.includes('geheim'));
    assert.ok(!body.includes(REPORT.description));

    const sent = await load(context, id);
    assert.equal(sent.status, 'uebermittelt');
    assert.equal(sent.github.number, 301);
    assert.equal(sent.github.url, 'https://github.com/stamm-phoenix/website-astro/issues/301');
    assert.equal(sent.contact, '');

    assert.equal((await send(context, id, sent.etag)).status, 409);
    assert.equal(calls.github.length, 1);
  }
);

dbTest('repeated clicks and two leaders at once create a single issue', async (t) => {
  const { context, calls } = setup(t, {
    github: async (_url, init) => {
      if (init.method !== 'POST') return new Response('[]');
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(
        JSON.stringify({
          number: 302,
          html_url: 'https://github.com/stamm-phoenix/website-astro/issues/302',
        }),
        { status: 201 }
      );
    },
  });
  const id = await submit(context);
  const item = await load(context, id);
  const results = await Promise.all([
    send(context, id, item.etag),
    send(context, id, item.etag),
    send(context, id, item.etag),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409, 409]);
  assert.equal(calls.github.filter((call) => call.method === 'POST').length, 1);
});

dbTest('a send that ends unclear is checked on GitHub before the next attempt', async (t) => {
  let outcome: 'down' | 'found' | 'missing' = 'down';
  const { context, calls } = setup(t, {
    github: (_url, init) => {
      if (outcome === 'down') throw new Error('socket hang up');
      if (init.method === 'GET') {
        const marker = `Problemmeldung PM-${currentId} ·`;
        return new Response(
          JSON.stringify(
            outcome === 'found'
              ? [
                  { number: 5, html_url: 'x', body: 'fremd' },
                  {
                    number: 77,
                    html_url: 'https://github.com/stamm-phoenix/website-astro/issues/77',
                    body: `Text\n\n_${marker} gemeldet_`,
                  },
                ]
              : [{ number: 5, html_url: 'x', body: 'fremd' }]
          )
        );
      }
      return new Response(
        JSON.stringify({
          number: 78,
          html_url: 'https://github.com/stamm-phoenix/website-astro/issues/78',
        }),
        { status: 201 }
      );
    },
  });
  const currentId = Number(await submit(context));
  const id = String(currentId);
  const item = await load(context, id);

  const unclear = await send(context, id, item.etag);
  assert.equal(unclear.status, 502);
  assert.equal((unclear.jsonBody as { code: string }).code, 'GITHUB_UNCLEAR');
  const pending = await load(context, id);
  assert.equal(pending.status, 'in_pruefung');
  assert.equal(pending.github.pending, true);
  assert.equal(pending.draft.title, ANSWER.title);

  // Too soon: the first attempt may still be running
  assert.equal((await send(context, id, pending.etag)).status, 409);

  await sql`UPDATE problem.meldung SET github_started_at = DATEADD(minute, -3, SYSUTCDATETIME()) WHERE id = ${currentId}`.execute(
    getDb()
  );
  outcome = 'found';
  const before = calls.github.length;
  const found = await send(context, id, (await load(context, id)).etag);
  assert.equal(found.status, 200);
  assert.deepEqual(
    calls.github.slice(before).map((call) => call.method),
    ['GET']
  );
  const sent = await load(context, id);
  assert.equal(sent.status, 'uebermittelt');
  assert.equal(sent.github.number, 77);
});

dbTest('an unclear send without a trace on GitHub is created on the next attempt', async (t) => {
  let down = true;
  const { context, calls } = setup(t, {
    github: (_url, init) => {
      if (down && init.method === 'POST') throw new Error('timeout');
      return init.method === 'GET'
        ? new Response('[]')
        : new Response(
            JSON.stringify({
              number: 79,
              html_url: 'https://github.com/stamm-phoenix/website-astro/issues/79',
            }),
            { status: 201 }
          );
    },
  });
  const id = await submit(context);
  const item = await load(context, id);
  assert.equal((await send(context, id, item.etag)).status, 502);
  await sql`UPDATE problem.meldung SET github_started_at = DATEADD(minute, -3, SYSUTCDATETIME()) WHERE id = ${Number(id)}`.execute(
    getDb()
  );
  down = false;
  assert.equal((await send(context, id, (await load(context, id)).etag)).status, 200);
  assert.deepEqual(
    calls.github.map((call) => call.method),
    ['POST', 'GET', 'POST']
  );
  assert.equal((await load(context, id)).github.number, 79);
});

dbTest('a refused issue keeps report and draft and can be sent again at once', async (t) => {
  let refuse = true;
  const { context } = setup(t, {
    github: (_url, init) =>
      refuse && init.method === 'POST'
        ? new Response('{"message":"Validation Failed"}', { status: 422 })
        : new Response(
            JSON.stringify({
              number: 80,
              html_url: 'https://github.com/stamm-phoenix/website-astro/issues/80',
            }),
            { status: 201 }
          ),
  });
  const id = await submit(context);
  const item = await load(context, id);
  const refused = await send(context, id, item.etag);
  assert.equal(refused.status, 502);
  assert.equal((refused.jsonBody as { code: string }).code, 'GITHUB_REJECTED');
  const after = await load(context, id);
  assert.equal(after.status, 'in_pruefung');
  assert.equal(after.github.pending, false);
  assert.equal(after.draft.title, ANSWER.title);

  refuse = false;
  assert.equal((await send(context, id, after.etag)).status, 200);
});

dbTest('without a token or a draft nothing is sent and the report stays', async (t) => {
  const { context, calls } = setup(t, {
    openai: () => new Response('boom', { status: 500 }),
  });
  const id = await submit(context);
  const item = await load(context, id);

  const noDraft = await send(context, id, item.etag);
  assert.equal(noDraft.status, 400);

  await ProblemMeldungItemEndpoint(
    request('PATCH', { title: 'T', body: 'B', label: 'bug', etag: item.etag }, { id }),
    context
  );
  delete process.env.GITHUB_ISSUES_TOKEN;
  const response = await send(context, id, (await load(context, id)).etag);
  assert.equal(response.status, 503);
  assert.equal((await load(context, id)).status, 'in_pruefung');
  assert.equal(calls.github.length, 0);
});

dbTest('reports are deleted after their retention', async (t) => {
  setup(t);
  resetProblemPurge();
  const { report } = validateProblemReport({ description: 'Eine ältere Meldung zum Testen.' });
  assert.ok(report);
  const ids = {
    openOld: await createProblemMeldung(report),
    openNew: await createProblemMeldung(report),
    discardedOld: await createProblemMeldung(report),
    discardedNew: await createProblemMeldung(report),
    sentOld: await createProblemMeldung(report),
    sentNew: await createProblemMeldung(report),
  };
  const db = getDb();
  await sql`
    UPDATE problem.meldung SET created_at = DATEADD(day, -181, SYSUTCDATETIME()) WHERE id = ${ids.openOld};
    UPDATE problem.meldung SET status = N'verworfen', reviewed_at = DATEADD(day, -31, SYSUTCDATETIME()) WHERE id = ${ids.discardedOld};
    UPDATE problem.meldung SET status = N'verworfen', reviewed_at = DATEADD(day, -29, SYSUTCDATETIME()) WHERE id = ${ids.discardedNew};
    UPDATE problem.meldung SET status = N'uebermittelt', github_number = 1, github_at = DATEADD(day, -91, SYSUTCDATETIME()) WHERE id = ${ids.sentOld};
    UPDATE problem.meldung SET status = N'uebermittelt', github_number = 2, github_at = DATEADD(day, -89, SYSUTCDATETIME()) WHERE id = ${ids.sentNew};
  `.execute(db);

  assert.equal(await purgeExpiredProblemMeldungen(), 3);
  assert.equal(await purgeExpiredProblemMeldungen(), null);
  const left = await db.selectFrom('problem.meldung').select('id').execute();
  assert.deepEqual(
    left.map((row) => row.id).sort((a, b) => a - b),
    [ids.openNew, ids.discardedNew, ids.sentNew].sort((a, b) => a - b)
  );
});

dbTest('later failed searches do not move the search window of the first attempt', async (t) => {
  let phase: 'down' | 'search-fails' | 'found' = 'down';
  let currentId = 0;
  const { context, calls } = setup(t, {
    github: (_url, init) => {
      if (phase === 'down') throw new Error('socket hang up');
      if (init.method === 'GET') {
        if (phase === 'search-fails') return new Response('boom', { status: 503 });
        return new Response(
          JSON.stringify([
            {
              number: 88,
              html_url: 'https://github.com/stamm-phoenix/website-astro/issues/88',
              body: `Text\n\n_Problemmeldung PM-${currentId} · gemeldet_`,
            },
          ])
        );
      }
      throw new Error('No new issue expected');
    },
  });
  currentId = Number(await submit(context));
  const id = String(currentId);
  const backdate = () =>
    sql`UPDATE problem.meldung SET github_started_at = DATEADD(minute, -3, SYSUTCDATETIME()) WHERE id = ${currentId}`.execute(
      getDb()
    );

  assert.equal((await send(context, id, (await load(context, id)).etag)).status, 502);
  const first = await getDb()
    .selectFrom('problem.meldung')
    .select('github_first_at')
    .where('id', '=', currentId)
    .executeTakeFirstOrThrow();
  assert.ok(first.github_first_at);

  await backdate();
  phase = 'search-fails';
  assert.equal((await send(context, id, (await load(context, id)).etag)).status, 502);
  await backdate();
  phase = 'found';
  assert.equal((await send(context, id, (await load(context, id)).etag)).status, 200);

  const since = calls.github
    .filter((call) => call.method === 'GET')
    .map((call) => new URL(call.url).searchParams.get('since'));
  assert.equal(since.length, 2);
  assert.equal(since[0], since[1]);
  assert.equal((await load(context, id)).github.number, 88);
});

dbTest('the search for an earlier issue reads every page', async (t) => {
  let currentId = 0;
  let down = true;
  const { context, calls } = setup(t, {
    github: (url, init) => {
      if (down && init.method === 'POST') throw new Error('timeout');
      if (init.method !== 'GET') throw new Error('No new issue expected');
      const page = Number(new URL(url).searchParams.get('page'));
      const others = Array.from({ length: 100 }, (_, index) => ({
        number: 1000 + index,
        html_url: 'x',
        body: 'fremd',
      }));
      return new Response(
        JSON.stringify(
          page === 1
            ? others
            : [
                {
                  number: 89,
                  html_url: 'https://github.com/stamm-phoenix/website-astro/issues/89',
                  body: `Text\n\n_Problemmeldung PM-${currentId} · gemeldet_`,
                },
              ]
        )
      );
    },
  });
  currentId = Number(await submit(context));
  const id = String(currentId);
  assert.equal((await send(context, id, (await load(context, id)).etag)).status, 502);
  await sql`UPDATE problem.meldung SET github_started_at = DATEADD(minute, -3, SYSUTCDATETIME()) WHERE id = ${currentId}`.execute(
    getDb()
  );
  down = false;
  assert.equal((await send(context, id, (await load(context, id)).etag)).status, 200);
  assert.equal((await load(context, id)).github.number, 89);
  assert.equal(calls.github.filter((call) => call.method === 'POST').length, 1);
});

dbTest('reports that arrive at once cannot pass the same count', async (t) => {
  const { context } = setup(t);
  overrideConfig(t, CONFIG, {
    problemmeldung: { ...CONFIG.problemmeldung, hourlyLimit: 2 },
  });
  const proofs = await Promise.all(Array.from({ length: 5 }, () => solvedAltcha()));
  const responses = await Promise.all(
    proofs.map((altcha) =>
      ProblemMeldungSendEndpoint(request('POST', { ...REPORT, altcha }), context)
    )
  );
  assert.equal(responses.filter((response) => response.status === 200).length, 2);
  assert.equal(responses.filter((response) => response.status === 429).length, 3);
  assert.equal((await list(context)).length, 2);
});
