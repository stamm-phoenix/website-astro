import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { NikolausCoordinates } from '../lib/nikolaus-config';
import {
  UNKNOWN_TRIP_MINUTES,
  getRoutePath,
  getTravelMatrix,
  matrixBlocks,
  parseRoutePath,
} from '../lib/travel-times';

function setKey(t: TestContext, value: string | undefined): void {
  const previous = process.env.AZURE_MAPS_API_KEY;
  if (value === undefined) delete process.env.AZURE_MAPS_API_KEY;
  else process.env.AZURE_MAPS_API_KEY = value;
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_MAPS_API_KEY;
    else process.env.AZURE_MAPS_API_KEY = previous;
  });
}

/** Points no other test uses, so the module's caches do not mix between tests. */
let next = 0;
function points(count: number): NikolausCoordinates[] {
  next++;
  return Array.from({ length: count }, (_, i) => ({ lat: 47 + next / 100, lon: 11 + i / 1000 }));
}

interface MatrixRequest {
  origins: number[][];
  destinations: number[][];
  departAt?: string;
  traffic?: string;
}

function readMatrixRequest(init: RequestInit): MatrixRequest {
  const body = JSON.parse(String(init.body)) as {
    features: { geometry: { coordinates: number[][] }; properties: { pointType: string } }[];
    departAt?: string;
    traffic?: string;
  };
  const of = (type: string) =>
    body.features.find((f) => f.properties.pointType === type)?.geometry.coordinates ?? [];
  return {
    origins: of('origins'),
    destinations: of('destinations'),
    departAt: body.departAt,
    traffic: body.traffic,
  };
}

/** Answers matrices with 60 s per 0.001° of longitude between the points. */
function matrixService(t: TestContext, fail = () => false): MatrixRequest[] {
  const requests: MatrixRequest[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.pathname, '/route/matrix');
    assert.equal(url.searchParams.get('api-version'), '2025-01-01');
    const request = readMatrixRequest(init);
    requests.push(request);
    if (fail()) return new Response('', { status: 500 });
    const matrix = request.origins.flatMap((from, originIndex) =>
      request.destinations.map((to, destinationIndex) => ({
        originIndex,
        destinationIndex,
        statusCode: 200,
        durationInSeconds: Math.round(Math.abs(from[0] - to[0]) * 60_000),
      }))
    );
    return Response.json({ type: 'Feature', geometry: null, properties: { matrix } });
  });
  return requests;
}

test('requests stay within 200 cells and cover every pair', () => {
  const keys = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
  for (const [origins, destinations] of [
    [49, 49],
    [1, 49],
    [3, 250],
    [10, 10],
  ]) {
    const blocks = matrixBlocks(keys(origins), keys(destinations));
    const cells = new Set<string>();
    for (const block of blocks) {
      assert.ok(block.origins.length * block.destinations.length <= 200);
      for (const o of block.origins) for (const d of block.destinations) cells.add(`${o}>${d}`);
    }
    assert.equal(cells.size, origins * destinations);
  }
  assert.equal(matrixBlocks(keys(10), keys(10)).length, 1);
});

test('driving times come from Azure Maps with parking time and the evening traffic', async (t) => {
  setKey(t, 'test-key');
  const requests = matrixService(t);
  const [a, b, c] = points(3);
  const departAt = new Date(Date.now() + 86_400_000).toISOString();
  const result = await getTravelMatrix([a, b, null, c], { departAt });
  assert.equal(result.source, 'route');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].departAt, departAt);
  assert.equal(requests[0].traffic, 'historical');
  // a → b: 0.001° = 1 minute, plus 2 minutes parking
  assert.equal(result.minutes[0][1], 3);
  assert.equal(result.minutes[0][3], 4);
  assert.equal(result.minutes[1][1], 0);
  assert.equal(result.minutes[0][2], UNKNOWN_TRIP_MINUTES);
});

test('a departure that has passed is not sent', async (t) => {
  setKey(t, 'test-key');
  const requests = matrixService(t);
  await getTravelMatrix(points(2), { departAt: '2020-12-05T16:00:00Z' });
  assert.equal(requests[0].departAt, undefined);
});

test('a new booking only asks for its own row and column', async (t) => {
  setKey(t, 'test-key');
  const requests = matrixService(t);
  const known = points(4);
  await getTravelMatrix(known);
  assert.equal(requests.length, 1);
  const cellsOf = (from: number) =>
    requests.slice(from).reduce((sum, r) => sum + r.origins.length * r.destinations.length, 0);

  const added = { lat: known[0].lat, lon: 11.5 };
  const result = await getTravelMatrix([...known, added]);
  assert.equal(result.source, 'route');
  // One row of 5 and one column of 4, instead of 25 cells
  assert.equal(cellsOf(1), 9);

  // Two bookings at one address and the same points again: nothing to ask
  const before = requests.length;
  await getTravelMatrix([...known, added, { ...added }]);
  assert.equal(requests.length, before);
});

test('large days are split, and a failing part falls back to the estimate', async (t) => {
  setKey(t, 'test-key');
  let calls = 0;
  const requests = matrixService(t, () => ++calls === 3);
  const many = points(30);
  const result = await getTravelMatrix(many);
  assert.ok(requests.length > 1);
  assert.ok(requests.every((r) => r.origins.length * r.destinations.length <= 200));
  assert.equal(result.source, 'estimate');
  assert.ok(result.minutes[0][29] > 2);

  // The next load asks only for what failed, and then has the routes
  const retried = await getTravelMatrix(many);
  assert.equal(retried.source, 'route');
  assert.equal(retried.minutes[0][29], 31);
});

test('a pair without a route is estimated, without the service nothing is asked', async (t) => {
  setKey(t, 'test-key');
  const [a, b] = points(2);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      properties: {
        matrix: [
          {
            originIndex: 0,
            destinationIndex: 1,
            statusCode: 400,
            error: { code: 'OUT_OF_REGION' },
          },
          { originIndex: 1, destinationIndex: 0, statusCode: 200, durationInSeconds: 600 },
        ],
      },
    })
  );
  const routed = await getTravelMatrix([a, b]);
  assert.equal(routed.minutes[1][0], 12);
  assert.ok(routed.minutes[0][1] > 2 && routed.minutes[0][1] < 12);

  t.mock.restoreAll();
  setKey(t, undefined);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const estimated = await getTravelMatrix(points(2));
  assert.equal(estimated.source, 'estimate');
  assert.equal(fetch.mock.callCount(), 0);
});

test('a timeout falls back to the estimate', async (t) => {
  setKey(t, 'test-key');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(() => undefined));
  const pending = getTravelMatrix(points(2));
  // Let the request start before the clock moves past the deadline
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(8_001);
  assert.equal((await pending).source, 'estimate');
});

test('the route path is read from the RoutePath feature as [lat, lon]', () => {
  const body = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [11, 47] },
        properties: { type: 'Waypoint' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [11, 47],
              [11.1, 47.1],
            ],
            [
              [11.1, 47.1],
              [11.2, 47.2],
            ],
          ],
        },
        properties: { type: 'RoutePath' },
      },
    ],
  };
  assert.deepEqual(parseRoutePath(body), [
    [47, 11],
    [47.1, 11.1],
    [47.1, 11.1],
    [47.2, 11.2],
  ]);
  assert.throws(() => parseRoutePath({ features: [] }));
});

test('routes are asked with all waypoints, and are null without service or on errors', async (t) => {
  setKey(t, 'test-key');
  let sent:
    | { features: { properties: { pointIndex: number } }[]; routeOutputOptions: string[] }
    | undefined;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.pathname, '/route/directions');
    sent = JSON.parse(String(init.body));
    return Response.json({
      features: [
        {
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [11, 47],
                [11.2, 47.2],
              ],
            ],
          },
          properties: { type: 'RoutePath' },
        },
      ],
    });
  });
  const stops = points(3);
  assert.deepEqual(await getRoutePath(stops), [
    [47, 11],
    [47.2, 11.2],
  ]);
  assert.deepEqual(sent?.routeOutputOptions, ['routePath']);
  assert.deepEqual(
    sent?.features.map((f) => f.properties.pointIndex),
    [0, 1, 2]
  );
  assert.equal(await getRoutePath(points(151)), null);

  t.mock.restoreAll();
  setKey(t, 'test-key');
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 400 }));
  assert.equal(await getRoutePath(points(2)), null);

  setKey(t, undefined);
  assert.equal(await getRoutePath(points(2)), null);
});
