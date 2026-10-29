import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as database from '../lib/db';
import { parseId, parseStringList } from '../lib/db';
import { getInstagramToken } from '../lib/instagram-token';
import { reserveNikolausMailQuota } from '../lib/nikolaus-mail-quota';
import { readDateParam } from '../lib/nikolaus-day';
import * as nikolausState from '../lib/nikolaus-state';
import { InvalidNikolausStateError } from '../lib/nikolaus-state';
import { CONFIG } from '../lib/config';
import { parseDelivery } from '../lib/protokolle';

const HOUR = 3_600_000;
const NOW = 20 * 86_400_000 + 5 * HOUR + 10;

/** Stores `initial` under every key and returns what the last reservation wrote. */
function mailQuota(t: TestContext, initial: unknown): () => unknown {
  let written: unknown;
  t.mock.method(
    nikolausState,
    'mutateNikolausState',
    async (
      _key: string,
      parse: (value: unknown) => unknown,
      change: (value: unknown) => unknown
    ) => {
      const next = change(parse(initial));
      if (next !== undefined) written = next;
      return next;
    }
  );
  return () => written;
}

test('a missing mail quota starts at zero and counts the reservation', async (t) => {
  const written = mailQuota(t, undefined);
  assert.ok(await reserveNikolausMailQuota(undefined, NOW));
  assert.deepEqual(written(), {
    hour: Math.floor(NOW / HOUR),
    hourCount: 1,
    day: 20,
    dayCount: 1,
  });
});

test('a mail quota of earlier windows counts from zero, a current one continues', async (t) => {
  const hour = Math.floor(NOW / HOUR);
  const written = mailQuota(t, { hour: hour - 1, hourCount: 4, day: 20, dayCount: 8, extra: 1 });
  assert.ok(await reserveNikolausMailQuota(undefined, NOW));
  assert.deepEqual(written(), { hour, hourCount: 1, day: 20, dayCount: 9 });
  const current = mailQuota(t, { hour, hourCount: 4, day: 20, dayCount: 8 });
  assert.ok(await reserveNikolausMailQuota(undefined, NOW));
  assert.deepEqual(current(), { hour, hourCount: 5, day: 20, dayCount: 9 });
});

test('a used up mail quota refuses', async (t) => {
  const hour = Math.floor(NOW / HOUR);
  mailQuota(t, { hour, hourCount: CONFIG.nikolaus.mailHourlyLimit, day: 20, dayCount: 0 });
  assert.equal(await reserveNikolausMailQuota({ warn: () => undefined }, NOW), undefined);
});

test('a damaged mail quota is an invalid stored state', async (t) => {
  const hour = Math.floor(NOW / HOUR);
  const good = { hour, hourCount: 1, day: 20, dayCount: 1 };
  const damaged: unknown[] = [
    null,
    'x',
    5,
    [],
    {},
    { ...good, hour: undefined },
    { ...good, hourCount: '1' },
    { ...good, dayCount: -1 },
    { ...good, day: 1.5 },
    { ...good, hourCount: null },
    { ...good, hourCount: Number.NaN },
    { ...good, hourCount: 2 ** 53 },
    { ...good, hour: hour + 1 },
    { ...good, day: 21 },
  ];
  for (const value of damaged) {
    mailQuota(t, value);
    await assert.rejects(
      () => reserveNikolausMailQuota(undefined, NOW),
      (error: unknown) =>
        error instanceof InvalidNikolausStateError &&
        /Invalid stored Nikolaus state/.test(error.message)
    );
  }
});

test('a stored mailing state is read leniently', () => {
  assert.equal(parseDelivery(undefined), null);
  assert.equal(parseDelivery(''), null);
  const attempted = { state: 'attempted', recipients: 0, at: '', by: '' };
  for (const value of ['not json', '{', 'null', '5', '"sent"', '[]', '{}', '[1,2]', 'true']) {
    assert.deepEqual(parseDelivery(value), attempted, value);
  }
  assert.deepEqual(
    parseDelivery(
      JSON.stringify({ state: 'sent', recipients: 12, at: '2026-10-07T18:00:00Z', by: 'Max' })
    ),
    { state: 'sent', recipients: 12, at: '2026-10-07T18:00:00Z', by: 'Max' }
  );
  assert.deepEqual(
    parseDelivery('{"state":"other","recipients":"3","at":5,"by":null,"x":1}'),
    attempted
  );
  assert.deepEqual(parseDelivery('{"state":"sent","recipients":-2.5}'), {
    ...attempted,
    state: 'sent',
    recipients: -2.5,
  });
});

test('a string list column keeps only the strings of a JSON array', () => {
  assert.deepEqual(parseStringList('["a","b",1,null,{},["c"],"d"]'), ['a', 'b', 'd']);
  assert.deepEqual(parseStringList('[]'), []);
  for (const value of ['', 'x', '{"a":"b"}', '"a"', 'null', '5', '[']) {
    assert.deepEqual(parseStringList(value), [], value);
  }
});

test('an id is one to nine digits', () => {
  assert.equal(parseId('0'), 0);
  assert.equal(parseId('007'), 7);
  assert.equal(parseId('123456789'), 123456789);
  for (const value of ['', '1234567890', '-1', '1.5', ' 1', '1 ', '1\n', 'a', '１']) {
    assert.equal(parseId(value), undefined, JSON.stringify(value));
  }
});

function dateRequest(query: string): HttpRequest {
  return new HttpRequest({ method: 'GET', url: `http://localhost/api/x${query}` });
}

test('the date query parameter must be a calendar date SQL Server accepts', () => {
  assert.equal(readDateParam(dateRequest('?date=2026-12-05')), '2026-12-05');
  assert.equal(readDateParam(dateRequest('?date=0001-01-01')), '0001-01-01');
  for (const query of [
    '',
    '?date=',
    '?date=2026-02-30',
    '?date=2026-13-01',
    '?date=5.12.2026',
    '?date=2026-12-05x',
    '?date=0000-12-31',
    '?date=%202026-12-05',
  ]) {
    assert.equal(readDateParam(dateRequest(query)), null, query);
  }
});

const DAY = 86_400_000;

/** A database that holds one Instagram token row and answers every statement. */
function instagramTable(t: TestContext, refreshedAt: Date | null): void {
  const chain = (result: unknown): unknown =>
    new Proxy(() => undefined, {
      get: (_target, name) =>
        name === 'executeTakeFirst' || name === 'execute'
          ? async () => result
          : () => chain(result),
    });
  t.mock.method(database, 'getDb', () => ({
    selectFrom: () => chain({ token: 'old-token', refreshed_at: refreshedAt }),
    updateTable: () => chain({ numUpdatedRows: 1n }),
    insertInto: () => chain(undefined),
  }));
}

async function refreshWith(
  t: TestContext,
  now: number,
  answer: () => Promise<Response>
): Promise<{ token: string; warnings: string[] }> {
  t.mock.method(Date, 'now', () => now);
  instagramTable(t, new Date(now - 30 * DAY));
  t.mock.method(globalThis, 'fetch', answer);
  const warnings: string[] = [];
  const context = new InvocationContext();
  context.warn = (...args: unknown[]) => void warnings.push(String(args[0]));
  context.log = () => undefined;
  return { token: await getInstagramToken(context), warnings };
}

test('the refreshed Instagram token is read from the answer', async (t) => {
  const result = await refreshWith(t, 1000 * DAY, async () =>
    Response.json({ access_token: 'new-token', token_type: 'bearer' })
  );
  assert.deepEqual(result, { token: 'new-token', warnings: [] });
});

test('a failed Instagram refresh keeps the stored token and names the reason', async (t) => {
  const cases: [() => Promise<Response>, string][] = [
    [
      async () =>
        Response.json({ error: { message: 'Token expired', code: 190 } }, { status: 400 }),
      'Instagram responded with 400 Token expired',
    ],
    [
      async () => Response.json({ error: { message: 5 } }, { status: 400 }),
      'Instagram responded with 400',
    ],
    [async () => Response.json({ error: 'nope' }, { status: 500 }), 'Instagram responded with 500'],
    [async () => new Response('not json', { status: 502 }), 'Instagram responded with 502'],
    [async () => Response.json(null, { status: 200 }), 'Instagram responded with 200'],
    [
      async () => Response.json({ access_token: 5 }, { status: 200 }),
      'Instagram responded with 200',
    ],
    [
      async () => Response.json({ access_token: 'x' }, { status: 403 }),
      'Instagram responded with 403',
    ],
    [async () => Response.json([{ access_token: 'x' }]), 'Instagram responded with 200'],
  ];
  let day = 2000;
  for (const [answer, reason] of cases) {
    const result = await refreshWith(t, day++ * DAY, answer);
    assert.equal(result.token, 'old-token', reason);
    assert.deepEqual(result.warnings, [`Refreshing the Instagram access token failed: ${reason}`]);
  }
});
