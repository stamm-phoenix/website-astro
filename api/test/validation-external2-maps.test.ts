import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG } from '../lib/config';
import { parseAttribution, parseTileAddress } from '../lib/map-tiles';
import { parseMatrix, parseRoutePath } from '../lib/travel-times';

const cell = (
  originIndex: unknown,
  destinationIndex: unknown,
  rest: Record<string, unknown> = {}
): unknown => ({ originIndex, destinationIndex, ...rest });

test('a matrix answer needs a list of cells', () => {
  for (const value of [
    null,
    undefined,
    'x',
    [],
    {},
    { properties: null },
    { properties: {} },
    { properties: { matrix: {} } },
  ]) {
    assert.throws(() => parseMatrix(value, 2, 2), /Azure Maps returned no matrix/);
  }
  assert.deepEqual(parseMatrix({ properties: { matrix: [] } }, 1, 2), [[undefined, undefined]]);
});

test('matrix cells give minutes, preferring the traffic time', () => {
  const matrix = {
    properties: {
      matrix: [
        cell(0, 1, { statusCode: 200, durationInSeconds: 120, durationTrafficInSeconds: 180 }),
        cell(1, 0, { durationInSeconds: 90 }),
        cell(1, 1, { statusCode: 200, durationInSeconds: 0 }),
        cell(0, 0, { durationTrafficInSeconds: 30, durationInSeconds: 600 }),
      ],
    },
  };
  assert.deepEqual(parseMatrix(matrix, 2, 2), [
    [0.5, 3],
    [1.5, 0],
  ]);
});

test('matrix cells without a route are null, failed or broken ones stay unknown', () => {
  const rows = parseMatrix(
    {
      properties: {
        matrix: [
          cell(0, 0, { statusCode: 400, durationInSeconds: 60 }),
          cell(0, 1, { statusCode: 404 }),
          cell(0, 2, { statusCode: 408 }),
          cell(1, 0, { statusCode: 429 }),
          cell(1, 1, { statusCode: 500 }),
          cell(1, 2, { statusCode: '200', durationInSeconds: 60 }),
          cell(2, 0, { statusCode: 200, durationInSeconds: -1 }),
          cell(2, 1, { statusCode: 200, durationInSeconds: '60' }),
          cell(2, 2, { statusCode: 200, durationTrafficInSeconds: -5, durationInSeconds: 60 }),
        ],
      },
    },
    3,
    3
  );
  assert.deepEqual(rows, [
    [null, null, undefined],
    [undefined, undefined, undefined],
    [undefined, undefined, undefined],
  ]);
});

test('matrix cells outside the requested points or of a wrong shape are skipped', () => {
  const rows = parseMatrix(
    {
      properties: {
        matrix: [
          null,
          'x',
          5,
          [],
          cell(2, 0, { durationInSeconds: 60 }),
          cell(0, 2, { durationInSeconds: 60 }),
          cell(-1, 0, { durationInSeconds: 60 }),
          cell(0, -1, { durationInSeconds: 60 }),
          cell(0.5, 0, { durationInSeconds: 60 }),
          cell('0', 0, { durationInSeconds: 60 }),
          cell(undefined, 0, { durationInSeconds: 60 }),
          cell(null, 0, { durationInSeconds: 60 }),
          { destinationIndex: 0, durationInSeconds: 60 },
          cell(1, 1, { durationInSeconds: 120 }),
        ],
      },
    },
    2,
    2
  );
  assert.deepEqual(rows, [
    [undefined, undefined],
    [undefined, 2],
  ]);
});

test('the last answer for a matrix cell wins', () => {
  const rows = parseMatrix(
    {
      properties: {
        matrix: [cell(0, 0, { durationInSeconds: 60 }), cell(0, 0, { durationInSeconds: 120 })],
      },
    },
    1,
    1
  );
  assert.deepEqual(rows, [[2]]);
});

const feature = (type: unknown, geometry: unknown): unknown => ({
  type: 'Feature',
  geometry,
  properties: { type },
});
const line = (coordinates: unknown): unknown => ({ type: 'LineString', coordinates });

test('a route answer needs a route path with coordinates', () => {
  const broken: unknown[] = [
    null,
    undefined,
    'x',
    {},
    { features: {} },
    { features: [] },
    { features: [feature('Waypoint', line([[1, 2]]))] },
    { features: [{ geometry: line([[1, 2]]) }] },
    { features: [feature('RoutePath', undefined)] },
    { features: [feature('RoutePath', null)] },
    { features: [feature('RoutePath', { type: 'LineString' })] },
    { features: [feature('RoutePath', { coordinates: {} })] },
    { features: [feature('RoutePath', line([]))] },
    { features: [feature('RoutePath', line([[1, 2]]))] },
    { features: [feature('RoutePath', line([[1, 2], ['a', 'b'], [3]]))] },
    // The first route path counts, a later valid one is not looked at
    {
      features: [
        feature('RoutePath', line([[1, 2]])),
        feature(
          'RoutePath',
          line([
            [1, 2],
            [3, 4],
          ])
        ),
      ],
    },
  ];
  for (const value of broken) {
    assert.throws(() => parseRoutePath(value), /Azure Maps returned no route/);
  }
});

test('a route path keeps valid points as [lat, lon] and skips broken ones', () => {
  const path = parseRoutePath({
    features: [
      null,
      'x',
      { properties: null },
      feature(
        'RoutePath',
        line([[10, 50, 300], null, 'x', [1], ['1', '2'], [null, 2], {}, [11, 51], [12, 52]])
      ),
    ],
  });
  assert.deepEqual(path, [
    [50, 10],
    [51, 11],
    [52, 12],
  ]);
  // Anything that is not a LineString is read as a list of lines; non-lines are skipped
  assert.deepEqual(
    parseRoutePath({
      features: [
        feature('RoutePath', {
          type: 'MultiLineString',
          coordinates: [
            [[1, 2]],
            'x',
            null,
            [
              [3, 4],
              [5, 6],
            ],
          ],
        }),
      ],
    }),
    [
      [2, 1],
      [4, 3],
      [6, 5],
    ]
  );
  const lines = [
    [
      [1, 2],
      [3, 4],
    ],
  ];
  const untyped = parseRoutePath({ features: [feature('RoutePath', { coordinates: lines })] });
  assert.deepEqual(untyped, [
    [2, 1],
    [4, 3],
  ]);
});

test('tile addresses read style, zoom and the png suffix of the row', () => {
  assert.deepEqual(parseTileAddress('dunkel', '3', '7', '0.png'), {
    style: 'dunkel',
    z: 3,
    x: 7,
    y: 0,
  });
  assert.deepEqual(parseTileAddress('hell', '0', '0', '0'), { style: 'hell', z: 0, x: 0, y: 0 });
  assert.deepEqual(parseTileAddress('hell', '04', '0007', '000002'), {
    style: 'hell',
    z: 4,
    x: 7,
    y: 2,
  });
});

test('tile addresses outside the grid or in a wrong format are refused', () => {
  const max = String(CONFIG.mapTiles.maxZoom);
  assert.ok(parseTileAddress('hell', max, '0', '0'));
  assert.equal(parseTileAddress('hell', String(CONFIG.mapTiles.maxZoom + 1), '0', '0'), null);
  assert.equal(parseTileAddress('hell', '1', '1', '2'), null);
  assert.ok(parseTileAddress('hell', '1', '1', '1'));
  for (const [style, z, x, y] of [
    [undefined, '1', '0', '0'],
    ['', '1', '0', '0'],
    ['Hell', '1', '0', '0'],
    ['hell', undefined, '0', '0'],
    ['hell', '1', undefined, '0'],
    ['hell', '1', '0', undefined],
    ['hell', '', '0', '0'],
    ['hell', '1', '0.png', '0'],
    ['hell', '1', '0', '.png'],
    ['hell', '1', '0', '0.png.png'],
    ['hell', '1', '0', '0.PNG'],
    ['hell', '1', ' 0', '0'],
    ['hell', '1', '0', '0 '],
    ['hell', '1', '0\n', '0'],
    ['hell', '1', '1e1', '0'],
    ['hell', '1', '+1', '0'],
    ['hell', '1', '0.5', '0'],
    ['hell', '1', '12345678', '0'],
    ['hell', '12345678', '0', '0'],
    ['hell', '1', '0', '-0'],
  ]) {
    assert.equal(parseTileAddress(style, z, x, y), null, `${style}/${z}/${x}/${y}`);
  }
});

test('copyright notices need a list and keep only distinct plain texts', () => {
  for (const value of [null, undefined, 'x', {}, [], { copyrights: 'x' }, { copyrights: {} }]) {
    assert.throws(() => parseAttribution(value), /Azure Maps returned no attribution/);
  }
  assert.deepEqual(parseAttribution({ copyrights: [] }), []);
  assert.deepEqual(
    parseAttribution({
      copyrights: [
        null,
        5,
        {},
        '  <b>A &amp;\n B</b>  ',
        '',
        '<a></a>',
        '   ',
        'A & B',
        '&copy;1 X',
        '&copy;1 X',
      ],
    }),
    ['A & B', '©1 X']
  );
});
