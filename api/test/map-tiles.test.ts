import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import { CONFIG } from '../lib/config';
import { GetKarteKachelEndpoint, GetKarteQuelleEndpoint } from '../endpoints/karte-kachel';
import { isTileInArea, parseAttribution, parseTileAddress, resetMapTiles } from '../lib/map-tiles';
import { overrideConfig } from './fixtures/config';
import { TEST_SETTINGS, mockNikolausSettings } from './fixtures/nikolaus-settings';
import * as settingsModule from '../lib/nikolaus-settings';

/** The tile of the starting point of the test settings at zoom 13. */
const HOME = { z: '13', x: '4365', y: '2848.png' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function setup(t: TestContext, switches: { publicActive?: boolean; staffActive?: boolean } = {}) {
  const previous = process.env.AZURE_MAPS_API_KEY;
  process.env.AZURE_MAPS_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_MAPS_API_KEY;
    else process.env.AZURE_MAPS_API_KEY = previous;
  });
  resetMapTiles();
  t.after(resetMapTiles);
  mockNikolausSettings(t, { publicActive: true, staffActive: false, ...switches });
}

function tileRequest(params: Record<string, string>): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/karte/${Object.values(params).join('/')}`,
    method: 'GET',
    params,
  });
}

function tileService(t: TestContext, status = 200, cacheControl = 'public, max-age=150000') {
  return t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.origin, 'https://eu.atlas.microsoft.com');
    assert.equal(url.pathname, '/map/tile');
    return new Response(status === 200 ? PNG : 'error', {
      status,
      headers: {
        'Content-Type': status === 200 ? 'image/png' : 'text/plain',
        'Cache-Control': cacheControl,
      },
    });
  });
}

test('tile addresses are checked strictly', () => {
  assert.deepEqual(parseTileAddress('hell', '13', '4365', '2848.png'), {
    style: 'hell',
    z: 13,
    x: 4365,
    y: 2848,
  });
  assert.equal(parseTileAddress('dunkel', '0', '0', '0')?.style, 'dunkel');
  for (const [style, z, x, y] of [
    ['satellit', '13', '1', '1'],
    ['hell', '20', '1', '1'],
    ['hell', '2', '4', '0'],
    ['hell', '2', '-1', '0'],
    ['hell', '2', '1', '1.jpg'],
    ['hell', '2', '1', undefined],
  ]) {
    assert.equal(parseTileAddress(style, z, x, y), null, `${style}/${z}/${x}/${y}`);
  }
});

test('only tiles around the starting point belong to the area', () => {
  const base = TEST_SETTINGS.area.base;
  assert.equal(isTileInArea({ z: 13, x: 4365, y: 2848 }, base, 40), true);
  // Munich (about 35 km) is inside, Nuremberg (about 180 km) is not
  assert.equal(isTileInArea({ z: 13, x: 4359, y: 2839 }, base, 40), true);
  assert.equal(isTileInArea({ z: 13, x: 4342, y: 2794 }, base, 40), false);
  // The whole world at zoom 0 touches every area
  assert.equal(isTileInArea({ z: 0, x: 0, y: 0 }, base, 40), true);
});

test('a tile of the area comes from Azure Maps, kept only by the browser', async (t) => {
  setup(t);
  const fetch = tileService(t);
  const first = await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(first.status, 200);
  assert.deepEqual(first.headers, {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=86400',
  });
  assert.deepEqual(new Uint8Array(first.body as Buffer), PNG);
  const url = fetch.mock.calls[0].arguments[0] as URL;
  assert.equal(url.searchParams.get('tilesetId'), 'microsoft.base.road');
  assert.equal(url.searchParams.get('zoom'), '13');
  assert.equal(url.searchParams.get('language'), 'de-DE');

  // No shared cache: the next user gets the tile from Azure Maps again
  const dark = await GetKarteKachelEndpoint(tileRequest({ style: 'dunkel', ...HOME }));
  await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(dark.status, 200);
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(
    (fetch.mock.calls[1].arguments[0] as URL).searchParams.get('tilesetId'),
    'microsoft.base.darkgrey'
  );
});

test('the browser keeps a tile no longer than Azure Maps allows', async (t) => {
  setup(t);
  tileService(t, 200, 'public, max-age=600');
  const response = await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(
    (response.headers as Record<string, string>)['Cache-Control'],
    'private, max-age=600'
  );
});

test('tiles outside the area, too deep or while the maps are off are not fetched', async (t) => {
  setup(t);
  const fetch = tileService(t);
  for (const params of [
    { style: 'hell', z: '13', x: '4342', y: '2794.png' },
    { style: 'hell', z: '20', x: '1', y: '1.png' },
    { style: 'satellit', ...HOME },
  ]) {
    const response = await GetKarteKachelEndpoint(tileRequest(params));
    assert.equal(response.status, 404);
  }

  t.mock.restoreAll();
  setup(t, { publicActive: false, staffActive: false });
  const off = tileService(t);
  const switchedOff = await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(switchedOff.status, 404);
  // Switched on again, the tile must come at once: nobody may keep this answer
  assert.equal((switchedOff.headers as Record<string, string>)['Cache-Control'], 'no-store');
  assert.equal(fetch.mock.callCount() + off.mock.callCount(), 0);
});

test('outside the area the empty square may be kept for a day', async (t) => {
  setup(t);
  tileService(t);
  const outside = await GetKarteKachelEndpoint(
    tileRequest({ style: 'hell', z: '13', x: '4342', y: '2794.png' })
  );
  assert.equal(outside.status, 404);
  assert.equal(
    (outside.headers as Record<string, string>)['Cache-Control'],
    'public, max-age=86400'
  );
});

test('a passing failure of the settings is not kept, the next tile comes again', async (t) => {
  setup(t);
  let failing = true;
  t.mock.method(settingsModule, 'getNikolausSettings', async () => {
    if (failing) throw new Error('database down');
    return { ...TEST_SETTINGS, publicActive: true };
  });
  const fetch = tileService(t);
  const failed = await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(failed.status, 503);
  assert.equal((failed.headers as Record<string, string>)['Cache-Control'], 'no-store');
  assert.equal(fetch.mock.callCount(), 0);

  failing = false;
  assert.equal((await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }))).status, 200);
});

test('a failing service or the daily limit answer 503 without caching', async (t) => {
  setup(t, { publicActive: false, staffActive: true });
  tileService(t, 500);
  const failed = await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(failed.status, 503);
  assert.equal((failed.headers as Record<string, string>)['Cache-Control'], 'no-store');

  overrideConfig(t, CONFIG.mapTiles, { maxRequestsPerDay: 0 });
  const fetch = tileService(t);
  const limited = await GetKarteKachelEndpoint(tileRequest({ style: 'hell', ...HOME }));
  assert.equal(limited.status, 503);
  assert.equal(fetch.mock.callCount(), 0);
});

test('the copyright notice is plain text, per zoom level and kept for an hour', async (t) => {
  assert.deepEqual(
    parseAttribution({
      copyrights: [
        '<a data-azure-maps-attribution-tileset="x">&copy;2026 OSM</a>',
        '<a>&copy;2026 TomTom</a>',
        '<a>&copy;2026 TomTom</a>',
        '<img src=x onerror=alert(1)>',
        '<scr<script>ipt>alert(1)</script>',
      ],
    }),
    ['©2026 OSM', '©2026 TomTom', 'iptalert(1)']
  );
  for (const text of parseAttribution({ copyrights: ['<<a>b>c', '<scr<script>ipt>'] })) {
    assert.doesNotMatch(text, /[<>]/);
  }

  setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.pathname, '/map/attribution');
    assert.equal(url.searchParams.get('tilesetId'), 'microsoft.base.road');
    assert.match(url.searchParams.get('bounds') ?? '', /^11\.3\d+,47\.5\d+,12\.3\d+,48\.2\d+$/);
    return Response.json({ copyrights: ['<a>&copy;2026 TomTom</a>'] });
  });
  const request = new HttpRequest({
    url: 'https://example.test/api/karte-quelle/hell/13',
    method: 'GET',
    params: { style: 'hell', z: '13' },
  });
  const first = await GetKarteQuelleEndpoint(request);
  assert.deepEqual(first.jsonBody, { copyrights: ['©2026 TomTom'] });
  await GetKarteQuelleEndpoint(request);
  assert.equal(fetch.mock.callCount(), 1);

  const invalid = await GetKarteQuelleEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/karte-quelle/x/13',
      method: 'GET',
      params: { style: 'x', z: '13' },
    })
  );
  assert.equal(invalid.status, 404);
});

test('without the copyright notice the map shows only its own', async (t) => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }));
  const response = await GetKarteQuelleEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/karte-quelle/dunkel/15',
      method: 'GET',
      params: { style: 'dunkel', z: '15' },
    })
  );
  assert.deepEqual(response.jsonBody, { copyrights: [] });
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
});
