import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeocodingFeatures } from '../lib/geocoding';
import { parseGeocodingBudget, parseGeocodingCache } from '../lib/geocoding-cache';

function point(coordinates: unknown, properties: unknown = { type: 'Address' }): unknown {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties };
}

test('geocoding answers without a feature list are refused', () => {
  for (const value of [null, undefined, 'x', 5, [], {}, { features: {} }, { features: null }]) {
    assert.throws(() => parseGeocodingFeatures(value), /Invalid geocoding response/);
  }
  assert.deepEqual(parseGeocodingFeatures({ features: [] }), []);
});

test('geocoding features are read as lat/lon with trimmed optional text', () => {
  const [feature] = parseGeocodingFeatures({
    features: [
      point([10.5, 51.25, 300], {
        type: 'Address',
        confidence: 'High',
        address: { postalCode: ' 37269 ', streetNumber: '12a', locality: 'Eschwege' },
      }),
    ],
  });
  assert.deepEqual(feature, {
    lat: 51.25,
    lon: 10.5,
    type: 'Address',
    postalCode: '37269',
    streetNumber: '12a',
  });
});

test('geocoding features fall back to an empty type and no text', () => {
  const answer = parseGeocodingFeatures({
    features: [
      point([1, 2], {}),
      point([1, 2], { type: 7, address: [] }),
      point([1, 2], { type: 'Address', address: { postalCode: '  ', streetNumber: 12 } }),
      point([1, 2], { type: 'Address', address: 'Weg 1' }),
    ],
  });
  assert.equal(answer.length, 4);
  assert.equal(answer[0].type, '');
  assert.equal(answer[1].type, '');
  for (const feature of answer) {
    assert.equal(feature.postalCode, undefined);
    assert.equal(feature.streetNumber, undefined);
  }
});

test('geocoding features without valid coordinates or shape are left out', () => {
  const valid = point([10, 50]);
  const answer = parseGeocodingFeatures({
    features: [
      null,
      'x',
      [],
      { geometry: { coordinates: [1, 2] } },
      { properties: {} },
      { geometry: [], properties: {} },
      { geometry: { coordinates: [1, 2] }, properties: [] },
      point(undefined),
      point('1,2'),
      point({ 0: 1, 1: 2 }),
      point([1]),
      point([]),
      point(['1', '2']),
      point([1, null]),
      point([181, 0]),
      point([-181, 0]),
      point([0, 90.5]),
      point([0, -90.5]),
      point([Number.POSITIVE_INFINITY, 0]),
      valid,
      point([180, -90]),
      point([-180, 90]),
    ],
  });
  assert.deepEqual(
    answer.map((feature) => [feature.lat, feature.lon]),
    [
      [50, 10],
      [-90, 180],
      [90, -180],
    ]
  );
});

const HOUR = 3_600_000;
const NOW = 20 * 86_400_000 + 5 * HOUR + 10;

test('a missing budget starts empty', () => {
  assert.deepEqual(parseGeocodingBudget(undefined, NOW), {
    hour: NOW / HOUR - 10 / HOUR,
    hourCount: 0,
    day: 20,
    dayCount: 0,
  });
});

test('a damaged budget is refused instead of reset', () => {
  const hour = Math.floor(NOW / HOUR);
  const good = { hour, hourCount: 1, day: 20, dayCount: 1 };
  assert.deepEqual(parseGeocodingBudget({ ...good, extra: true }, NOW), good);
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
    assert.throws(() => parseGeocodingBudget(value, NOW), /Invalid geocoding budget/);
  }
});

test('a budget of an earlier window counts from zero', () => {
  const hour = Math.floor(NOW / HOUR);
  const old = { hour: hour - 1, hourCount: 4, day: 19, dayCount: 8 };
  assert.deepEqual(parseGeocodingBudget(old, NOW), { hour, hourCount: 0, day: 20, dayCount: 0 });
  assert.deepEqual(parseGeocodingBudget({ ...old, day: 20 }, NOW), {
    hour,
    hourCount: 0,
    day: 20,
    dayCount: 8,
  });
});

test('cached lookups are checked one by one and the newest 100 are kept', () => {
  const found = { found: true, precision: 'address', lat: 1, lon: 2, extra: 'kept' };
  const entry = (key: unknown, result: unknown, expires: unknown = 5): unknown => ({
    key,
    expires,
    result,
  });
  const good = [
    entry('a', { found: false }),
    entry('b', found),
    entry('c', { found: true, precision: 'area', lat: -90, lon: 180 }),
    entry('d', { found: false, other: 1 }),
  ];
  const bad = [
    null,
    'x',
    [],
    entry(1, { found: false }),
    entry('a', { found: false }, '5'),
    entry('a', { found: false }, Number.POSITIVE_INFINITY),
    entry('a', null),
    entry('a', { found: 'yes' }),
    entry('a', { found: false, unavailable: true }),
    entry('a', { found: false, unavailable: null }),
    entry('a', { found: true }),
    entry('a', { found: true, precision: 'house', lat: 1, lon: 2 }),
    entry('a', { found: true, precision: 'area', lat: '1', lon: 2 }),
    entry('a', { found: true, precision: 'area', lat: 91, lon: 2 }),
    entry('a', { found: true, precision: 'area', lat: 1, lon: -181 }),
    entry('a', { found: true, precision: 'area', lat: 1, lon: Number.NaN }),
    { expires: 1, result: { found: false } },
  ];
  assert.deepEqual(parseGeocodingCache({ version: 2, entries: [...bad, ...good, ...bad] }), {
    version: 2,
    entries: good,
  });
  const many = Array.from({ length: 150 }, (_, i) => entry(`k${i}`, { found: false }));
  const kept = parseGeocodingCache({ version: 2, entries: many }).entries;
  assert.equal(kept.length, 100);
  assert.equal(kept[0].key, 'k50');
  assert.equal(kept[99].key, 'k149');
});

test('anything but a version 2 record starts an empty cache', () => {
  const empty = { version: 2, entries: [] };
  for (const value of [undefined, null, 'x', [], {}, { version: 2 }, { version: 3, entries: [] }]) {
    assert.deepEqual(parseGeocodingCache(value), empty);
  }
  assert.deepEqual(parseGeocodingCache({ version: 2, entries: {} }), empty);
});
