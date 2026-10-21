import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { CONFIG } from '../lib/config';
import * as token from '../lib/token';
import * as state from '../lib/nikolaus-state';
import { AzureMapsError, requestAzureMaps } from '../lib/azure-maps';
import { geocodeAddress } from '../lib/geocoding';
import {
  createGeocodingCache,
  parseGeocodingBudget,
  parseGeocodingCache,
  reserveGeocodingRequest,
} from '../lib/geocoding-cache';
import type { GeocodeResult } from '../lib/geocoding';
import { overrideConfig } from './fixtures/config';
import { mockNikolausSettings } from './fixtures/nikolaus-settings';

function setEnv(t: TestContext, name: string, value: string | undefined): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

/** Key login, settings and an in-memory shared cache, as in a configured environment. */
function configured(t: TestContext): {
  stored: () => unknown;
  budget: () => unknown;
  setBudget: (value: unknown) => void;
} {
  setEnv(t, 'AZURE_MAPS_API_KEY', 'test-key');
  setEnv(t, 'NIKOLAUS_STATE_SECRET', 'x'.repeat(32));
  mockNikolausSettings(t);
  const records = new Map<string, unknown>();
  t.mock.method(state, 'readNikolausState', async (key: string) =>
    records.has(key) ? { key, version: '1', data: records.get(key) } : undefined
  );
  t.mock.method(
    state,
    'mutateNikolausState',
    async (
      key: string,
      parse: (value: unknown) => unknown,
      change: (value: unknown) => unknown
    ) => {
      const next = change(parse(records.get(key)));
      if (next !== undefined) records.set(key, next);
      return next;
    }
  );
  return {
    stored: () => records.get('geocoding:azure-maps'),
    budget: () => records.get('geocoding:azure-maps:budget'),
    setBudget: (value: unknown) => records.set('geocoding:azure-maps:budget', value),
  };
}

interface Feature {
  type: string;
  lat: number;
  lon: number;
  postalCode?: string;
  streetNumber?: string;
}

function features(...items: Feature[]): unknown {
  return {
    type: 'FeatureCollection',
    features: items.map((item) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
      properties: {
        type: item.type,
        confidence: 'High',
        matchCodes: ['Good'],
        address: { postalCode: item.postalCode, streetNumber: item.streetNumber },
      },
    })),
  };
}

/** Answers each geocoding request in turn and records the query parameters. */
function geocodingAnswers(t: TestContext, ...answers: unknown[]): URLSearchParams[] {
  const queries: URLSearchParams[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    queries.push(url.searchParams);
    const answer = answers.shift();
    if (answer instanceof Response) return answer;
    return Response.json(answer ?? features());
  });
  return queries;
}

test('the key is sent as subscription-key, to the EU endpoint with the API version', async (t) => {
  setEnv(t, 'AZURE_MAPS_API_KEY', 'test-key');
  let seen: { url: URL; init: RequestInit } | undefined;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    seen = { url, init };
    return Response.json({ ok: true });
  });
  await requestAzureMaps({
    method: 'GET',
    path: '/geocode',
    apiVersion: '2026-01-01',
    query: { addressLine: 'Hauptstraße 1' },
    timeoutMs: 100,
  });
  assert.equal(seen?.url.origin, 'https://eu.atlas.microsoft.com');
  assert.equal(seen?.url.searchParams.get('api-version'), '2026-01-01');
  const headers = seen?.init.headers as Record<string, string>;
  assert.equal(headers['subscription-key'], 'test-key');
  assert.equal(headers.Authorization, undefined);
});

test('without a key the app registration signs in for the configured Maps account', async (t) => {
  setEnv(t, 'AZURE_MAPS_API_KEY', undefined);
  overrideConfig(t, CONFIG.azureMaps, { clientId: 'maps-account' });
  let scope: string | undefined;
  t.mock.method(token, 'getCredential', () => ({
    getToken: async (requested: string) => {
      scope = requested;
      return { token: 'entra-token', expiresOnTimestamp: Date.now() + 60_000 };
    },
  }));
  let headers: Record<string, string> | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
    headers = init.headers as Record<string, string>;
    return Response.json({});
  });
  await requestAzureMaps({ method: 'GET', path: '/geocode', apiVersion: 'v', timeoutMs: 100 });
  assert.equal(scope, 'https://atlas.microsoft.com/.default');
  assert.equal(headers?.Authorization, 'Bearer entra-token');
  assert.equal(headers?.['x-ms-client-id'], 'maps-account');
});

test('errors carry only the status, and a hanging answer times out', async (t) => {
  setEnv(t, 'AZURE_MAPS_API_KEY', 'test-key');
  t.mock.method(globalThis, 'fetch', async () => new Response('Hauptstraße 1', { status: 429 }));
  await assert.rejects(
    requestAzureMaps({ method: 'GET', path: '/geocode', apiVersion: 'v', timeoutMs: 100 }),
    (error: Error) =>
      error instanceof AzureMapsError && error.message === 'Azure Maps request failed: 429'
  );

  t.mock.restoreAll();
  setEnv(t, 'AZURE_MAPS_API_KEY', 'test-key');
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url: URL, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>(() => undefined);
  });
  await assert.rejects(
    requestAzureMaps({ method: 'GET', path: '/geocode', apiVersion: 'v', timeoutMs: 20 }),
    /timed out/
  );
  assert.equal(signal?.aborted, true);
});

test('a house in the right postal code is located exactly, with structured input', async (t) => {
  configured(t);
  const queries = geocodingAnswers(
    t,
    features(
      // Same street in another town first: its postal code does not match
      { type: 'Address', lat: 48.1, lon: 11.5, postalCode: '80331', streetNumber: '1' },
      { type: 'Address', lat: 47.9123456, lon: 11.8456789, postalCode: '83620', streetNumber: '1' }
    )
  );
  const result = await geocodeAddress('Hauptstraße 1', '83620', 'Feldkirchen');
  assert.deepEqual(result, { found: true, precision: 'address', lat: 47.912346, lon: 11.845679 });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].get('addressLine'), 'Hauptstraße 1');
  assert.equal(queries[0].get('postalCode'), '83620');
  assert.equal(queries[0].get('locality'), 'Feldkirchen');
  assert.equal(queries[0].get('countryRegion'), 'DE');
  assert.equal(queries[0].get('coordinates'), '11.84664,47.90885');
});

test('a street without the house number is located as street', async (t) => {
  configured(t);
  geocodingAnswers(t, features({ type: 'RoadBlock', lat: 47.91, lon: 11.84, postalCode: '83620' }));
  assert.deepEqual(await geocodeAddress('Neubauweg 99b', '83620', 'Feldkirchen'), {
    found: true,
    precision: 'street',
    lat: 47.91,
    lon: 11.84,
  });
});

test('without a matching address only the town is shown, or nothing is found', async (t) => {
  configured(t);
  const queries = geocodingAnswers(
    t,
    features({ type: 'Address', lat: 48.1, lon: 11.5, postalCode: '80331', streetNumber: '3' }),
    features({ type: 'Postcode1', lat: 47.92, lon: 11.85, postalCode: '83620' })
  );
  assert.deepEqual(await geocodeAddress('Irgendwo 3', '83620', 'Feldkirchen'), {
    found: true,
    precision: 'area',
    lat: 47.92,
    lon: 11.85,
  });
  assert.equal(queries[1].get('addressLine'), null);
  assert.equal(queries[1].get('postalCode'), '83620');

  geocodingAnswers(t, features(), features());
  assert.deepEqual(await geocodeAddress('Gibtsnicht 1', '83620', 'Feldkirchen'), {
    found: false,
  });
});

test('a failing service, a broken answer or a missing setup yield unavailable', async (t) => {
  configured(t);
  geocodingAnswers(t, new Response('', { status: 503 }));
  assert.deepEqual(await geocodeAddress('Fehlerweg 1', '83620', 'Feldkirchen'), {
    found: false,
    unavailable: true,
  });

  geocodingAnswers(t, { error: { code: 'x' } });
  assert.deepEqual(await geocodeAddress('Kaputtweg 1', '83620', 'Feldkirchen'), {
    found: false,
    unavailable: true,
  });

  setEnv(t, 'AZURE_MAPS_API_KEY', undefined);
  overrideConfig(t, CONFIG.azureMaps, { clientId: '' });
  const queries = geocodingAnswers(t);
  assert.deepEqual(await geocodeAddress('Ohneweg 1', '83620', 'Feldkirchen'), {
    found: false,
    unavailable: true,
  });
  assert.equal(queries.length, 0);
});

test('a located address is shared from the cache, a failure is asked again', async (t) => {
  const { stored } = configured(t);
  const queries = geocodingAnswers(
    t,
    new Response('', { status: 500 }),
    features({ type: 'Address', lat: 47.9, lon: 11.8, postalCode: '83620', streetNumber: '7' })
  );
  assert.equal((await geocodeAddress('Cacheweg 7', '83620', 'Feldkirchen')).unavailable, true);
  const located = await geocodeAddress('Cacheweg 7', '83620', 'Feldkirchen');
  // Spelled differently, still the same address
  assert.deepEqual(await geocodeAddress(' cacheweg 7', '83620', 'FELDKIRCHEN '), located);
  assert.equal(queries.length, 2);
  const cache = stored() as { version: number; entries: { key: string }[] };
  assert.equal(cache.version, 2);
  assert.equal(cache.entries.length, 1);
  // No address in clear text
  assert.doesNotMatch(JSON.stringify(cache), /cacheweg/i);
});

test('the cache survives a damaged record and a failing database', async () => {
  assert.deepEqual(parseGeocodingCache({ version: 1, cache: [] }), { version: 2, entries: [] });
  const valid = { key: 'a', expires: 1, result: { found: false } };
  assert.deepEqual(parseGeocodingCache({ version: 2, entries: [valid, { key: 'b' }] }), {
    version: 2,
    entries: [valid],
  });

  let calls = 0;
  const cache = createGeocodingCache({
    read: async () => {
      throw new Error('database down');
    },
    mutate: async () => {
      throw new Error('database down');
    },
  });
  const found: GeocodeResult = { found: true, precision: 'street', lat: 1, lon: 2 };
  const task = async (): Promise<GeocodeResult> => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return found;
  };
  // The same address twice at once needs one request
  const [first, second] = await Promise.all([cache.lookup('k', task), cache.lookup('k', task)]);
  assert.deepEqual(first, found);
  assert.deepEqual(second, found);
  assert.equal(calls, 1);
});

test('the cache keeps at most 100 addresses and drops expired ones', async () => {
  let data: unknown;
  let now = 1_000;
  const cache = createGeocodingCache({
    read: async () => data,
    mutate: async (parse, change) => {
      data = change(parse(data));
      return data;
    },
    now: () => now,
  });
  for (let i = 0; i < 105; i++) {
    await cache.lookup(`k${i}`, async () => ({ found: false }));
  }
  const entries = (data as { entries: { key: string }[] }).entries;
  assert.equal(entries.length, 100);
  assert.equal(entries[0].key, 'k5');

  now += 24 * 60 * 60_000 + 1;
  let asked = false;
  await cache.lookup('k104', async () => {
    asked = true;
    return { found: false };
  });
  assert.equal(asked, true);
  assert.equal((data as { entries: unknown[] }).entries.length, 1);
});

test('the public address search stops asking Azure Maps once the budget is used up', async (t) => {
  const { budget } = configured(t);
  overrideConfig(t, CONFIG.nikolaus, { geocodingHourlyLimit: 3, geocodingDailyLimit: 10 });
  const fetch = t.mock.method(globalThis, 'fetch', async (url: URL) =>
    Response.json(
      features({
        type: 'Address',
        lat: 47.9,
        lon: 11.8,
        postalCode: '83620',
        streetNumber: url.searchParams.get('addressLine')?.split(' ')[1],
      })
    )
  );
  // Many different addresses at once, as from a script
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      geocodeAddress(`Budgetweg ${i + 1}`, '83620', 'Feldkirchen')
    )
  );
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(results.filter((r) => r.found).length, 3);
  assert.ok(results.filter((r) => r.unavailable).length === 47);
  assert.equal((budget() as { hourCount: number }).hourCount, 3);

  // A located address still comes from the cache without using the budget
  const again = await geocodeAddress('Budgetweg 1', '83620', 'Feldkirchen');
  const located = results[0].found ? results[0] : results.find((r) => r.found);
  assert.equal(again.found || again.unavailable, true);
  assert.ok(located);
  assert.equal(fetch.mock.callCount(), 3);
});

test('both search steps count, and a damaged budget admits nothing', async (t) => {
  const { budget, setBudget } = configured(t);
  overrideConfig(t, CONFIG.nikolaus, { geocodingHourlyLimit: 100, geocodingDailyLimit: 100 });
  geocodingAnswers(t, features(), features());
  assert.deepEqual(await geocodeAddress('Zweistufig 1', '83620', 'Feldkirchen'), { found: false });
  assert.equal((budget() as { dayCount: number }).dayCount, 2);

  setBudget({ hour: 'kaputt' });
  const queries = geocodingAnswers(t);
  assert.deepEqual(await geocodeAddress('Kaputtbudget 1', '83620', 'Feldkirchen'), {
    found: false,
    unavailable: true,
  });
  assert.equal(queries.length, 0);
});

test('the budget starts over in the next hour and day', () => {
  const hour = 3_600_000;
  const at = 20 * 86_400_000 + 5 * hour;
  const used = { hour: at / hour, hourCount: 7, day: 20, dayCount: 9 };
  assert.deepEqual(parseGeocodingBudget(used, at + 10), used);
  assert.deepEqual(parseGeocodingBudget(used, at + hour), {
    hour: at / hour + 1,
    hourCount: 0,
    day: 20,
    dayCount: 9,
  });
  assert.equal(parseGeocodingBudget(used, at + 19 * hour).dayCount, 0);
});

test('a reservation that waited past the hour cannot reset the newer window', async () => {
  const hour = 3_600_000;
  const before = 20 * 86_400_000 + 5 * hour - 1;
  let stored: unknown = { hour: (before + 1) / hour, hourCount: 1, day: 20, dayCount: 1 };
  const mutate = async <T>(
    parse: (value: unknown) => T,
    change: (value: T) => T | undefined
  ): Promise<T | undefined> => {
    const next = change(parse(stored));
    if (next !== undefined) stored = next;
    return next;
  };
  // Started one millisecond before the new hour, got the lock after a newer reservation
  assert.equal(await reserveGeocodingRequest(mutate, 1, 10, before), false);
  assert.deepEqual(stored, { hour: (before + 1) / hour, hourCount: 1, day: 20, dayCount: 1 });
});
