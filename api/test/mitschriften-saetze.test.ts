import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as azureOpenAi from '../lib/azure-openai';
import { getMitschrift } from '../lib/mitschriften';
import type { MitschriftAbschnitt, MitschriftDetail } from '../lib/mitschriften-model';
import { findRuns, toJoins, wordsOf } from '../lib/mitschriften-saetze';
import {
  MitschriftFinish,
  MitschriftLive,
  MitschriftSmooth,
  MitschriftenCollection,
} from '../endpoints/intern-mitschriften';
import { dbTest } from './fixtures/database';

function part(
  id: number,
  startMs: number,
  text: string,
  options: Partial<MitschriftAbschnitt> = {}
): MitschriftAbschnitt {
  return {
    id,
    sprecherId: 1,
    source: 'raum',
    startMs,
    endMs: startMs + 2000,
    text,
    etag: `"${id}"`,
    ...options,
  };
}

test('candidates are sentences of the same source and speaker after a short pause', () => {
  const abschnitte = [
    part(1, 0, 'Wir müssen noch.'),
    part(2, 3000, 'Die Anzahlung überweisen.'),
    // Another speaker, a long pause, another source
    part(3, 6000, 'Ja.', { sprecherId: 2 }),
    part(4, 20_000, 'Später.', { sprecherId: 2 }),
    part(5, 3500, 'Aus Teams.', { source: 'teams' }),
    part(6, 6000, 'Weiter.', { source: 'teams' }),
  ];
  const { runs, nextFromMs, resumeFromMs } = findRuns(abschnitte, 0, null);
  assert.deepEqual(
    runs.map((run) => run.parts.map((p) => p.id)),
    [
      [1, 2],
      [5, 6],
    ]
  );
  assert.equal(nextFromMs, null);
  // The last sentence of each source may still be continued
  assert.equal(resumeFromMs, 6000);

  const limited = findRuns(abschnitte, 0, null, 1);
  assert.equal(limited.runs.length, 1);
  // The room is done; the pair from Teams follows in the next request
  assert.equal(limited.nextFromMs, 3500);
  assert.deepEqual(findRuns(abschnitte, 0, 3000).runs, []);
});

test('a join is only taken over with exactly the words of its parts', () => {
  const runs = [
    { parts: [part(1, 0, 'Wir müssen noch.'), part(2, 3000, 'Die Anzahlung überweisen.')] },
    { parts: [part(3, 9000, 'Das ist gut.'), part(4, 12_000, 'Machen wir.')] },
  ];
  const joins = toJoins(
    {
      joins: [
        { run: 0, from: 0, to: 1, text: 'Wir müssen noch die Anzahlung überweisen.' },
        // A changed word, a run that does not exist, a part used twice
        { run: 1, from: 0, to: 1, text: 'Das ist sehr gut, machen wir.' },
        { run: 5, from: 0, to: 1, text: 'x' },
        { run: 0, from: 0, to: 1, text: 'Wir müssen noch die Anzahlung überweisen.' },
      ],
    },
    runs
  );
  assert.deepEqual(
    joins.map((join) => [join.parts.map((p) => p.id), join.text]),
    [[[1, 2], 'Wir müssen noch die Anzahlung überweisen.']]
  );
  assert.equal(wordsOf('Die Jurten, 2 Stück!'), 'die jurten 2 stück');
});

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

async function call(
  t: TestContext,
  handler: (
    r: HttpRequest,
    c: InvocationContext
  ) => Promise<{ status?: number; jsonBody?: unknown }>,
  params: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const context = new InvocationContext({ functionName: 'mitschriften-saetze-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  const response = await handler(
    new HttpRequest({
      url: 'https://example.test/api/intern/pflege/mitschriften',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params,
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
    }),
    context
  );
  return {
    status: response.status ?? 200,
    body: (response.jsonBody ?? {}) as Record<string, unknown>,
  };
}

dbTest('cut sentences are joined as the model suggests, window by window', async (t) => {
  const created = await call(
    t,
    MitschriftenCollection,
    {},
    {
      title: 'Leitendenrunde',
      date: '2026-10-08',
      mode: 'live',
      consent: true,
    }
  );
  const meeting = created.body as unknown as MitschriftDetail;
  const params = { id: String(meeting.id) };
  const sentence = (clientId: string, startMs: number, text: string) => ({
    clientId,
    source: 'raum',
    speakerKey: 'l1:Guest-1',
    startMs,
    endMs: startMs + 2000,
    text,
  });
  await call(t, MitschriftLive, params, {
    abschnitte: [
      sentence('client-0001', 0, 'Wir müssen noch.'),
      sentence('client-0002', 3000, 'Die Anzahlung überweisen.'),
      sentence('client-0003', 6000, 'Habt ihr Fragen?'),
    ],
  });
  await call(t, MitschriftFinish, params);

  const requests: unknown[] = [];
  t.mock.method(azureOpenAi, 'requestStructuredOutput', async (_d: unknown, request: unknown) => {
    requests.push(request);
    return {
      joins: [{ run: 0, from: 0, to: 1, text: 'Wir müssen noch die Anzahlung überweisen.' }],
    };
  });
  const result = await call(t, MitschriftSmooth, params, { fromMs: 0 });
  assert.equal(result.status, 200);
  assert.equal(result.body.merged, 1);
  assert.equal(result.body.nextFromMs, null);
  assert.equal(requests.length, 1);

  const detail = (await getMitschrift(meeting.id))!;
  assert.deepEqual(
    detail.abschnitte.map((a) => [a.startMs, a.endMs, a.text]),
    [
      [0, 5000, 'Wir müssen noch die Anzahlung überweisen.'],
      [6000, 8000, 'Habt ihr Fragen?'],
    ]
  );
});
