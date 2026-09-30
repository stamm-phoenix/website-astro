import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRuesthausProduct,
  parseRuesthausProduct,
  ruesthausProductUrl,
} from '../lib/ruesthaus-product';

const URL = 'https://www.ruesthaus.de/dpsg-artikel/99101/test-product';
const HTML = `<meta content='product' property='og:type'>
  <meta property="og:title" content="Kluft &amp; Halstuch &#252; &quot;Fairtrade&quot;">
  <meta property="og:image" content="https://www.ruesthaus.de/media/image/test.jpg">
  <meta property="product:price" content="49,00">`;

test('product metadata handles attribute order, HTML entities and German prices', () => {
  assert.deepEqual(parseRuesthausProduct(HTML, URL), {
    name: 'Kluft & Halstuch ü "Fairtrade"',
    imageUrl: 'https://www.ruesthaus.de/media/image/test.jpg',
    unitPriceCents: 4900,
    sourceUrl: URL,
  });
  assert.equal(
    parseRuesthausProduct(HTML.replace('49,00', '1.299,95'), URL).unitPriceCents,
    129995
  );
  assert.equal(parseRuesthausProduct(HTML.replace('49,00', 'unknown'), URL).unitPriceCents, null);
  assert.equal(parseRuesthausProduct(HTML.replace('49,00', '0,00'), URL).unitPriceCents, 0);
});

test('product URLs and returned images stay on the HTTPS shop allowlist', () => {
  assert.equal(ruesthausProductUrl(`${URL}#details`), URL);
  for (const url of [
    'http://www.ruesthaus.de/1/test',
    'https://evil.test/1/test',
    'https://www.ruesthaus.de.evil.test/1/test',
    'https://user@www.ruesthaus.de/1/test',
    'https://www.ruesthaus.de:444/1/test',
    'https://www.ruesthaus.de/media/image/test.jpg',
    '00123',
  ]) {
    assert.throws(() => ruesthausProductUrl(url));
  }
  for (const image of [
    'https://evil.test/image.jpg',
    'javascript:alert(1)',
    'https://www.ruesthaus.de/contact',
  ]) {
    assert.equal(
      parseRuesthausProduct(
        HTML.replace('https://www.ruesthaus.de/media/image/test.jpg', image),
        URL
      ).imageUrl,
      null
    );
  }
  assert.throws(() =>
    parseRuesthausProduct(HTML.replace("content='product'", "content='website'"), URL)
  );
});

test('shop lookups cache successful responses without making a second request', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  );
  const first = await getRuesthausProduct(URL);
  assert.deepEqual(await getRuesthausProduct(URL), first);
  assert.equal(fetch.mock.callCount(), 1);
});

test('shop lookups reject foreign redirects and oversized responses', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.test/product' } })
  );
  await assert.rejects(getRuesthausProduct(URL.replace('99101', '99102')));
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(
    async () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } })
  );
  await assert.rejects(getRuesthausProduct(URL.replace('99101', '99103')));
});
