import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getShopProduct,
  parseRuesthausProduct,
  parseEschwegeProduct,
  shopProductUrl,
} from '../lib/sammelbestellung-product';

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
  assert.equal(shopProductUrl(`${URL}#details`), URL);
  for (const url of [
    'http://www.ruesthaus.de/1/test',
    'https://evil.test/1/test',
    'https://www.ruesthaus.de.evil.test/1/test',
    'https://user@www.ruesthaus.de/1/test',
    'https://www.ruesthaus.de:444/1/test',
    'https://www.ruesthaus.de/media/image/test.jpg',
    '00123',
  ]) {
    assert.throws(() => shopProductUrl(url));
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
  const first = await getShopProduct(URL);
  assert.deepEqual(await getShopProduct(URL), first);
  assert.equal(fetch.mock.callCount(), 1);
});

test('shop lookups reject foreign redirects and oversized responses', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.test/product' } })
  );
  await assert.rejects(getShopProduct(URL.replace('99101', '99102')));
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(
    async () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } })
  );
  await assert.rejects(getShopProduct(URL.replace('99101', '99103')));
});

const ESCHWEGE = 'https://www.ausruester-eschwege.de/Kueche/WILDO-Berghaferl-Lime::51561.html';
const ESCHWEGE_HTML =
  '<div itemscope itemtype="http://schema.org/Product"><form><h1 itemprop="name">WILDO &amp; Becher</h1><img src="/images/product_images/popup_images/51561_0.jpg"><meta itemprop="priceCurrency" content="EUR"><span>Alter Preis: 7,99 EUR</span><meta content="6.99" itemprop="price"></form><meta itemprop="price" content="99.99"></div>';

test('Eschwege product microdata reads the primary discounted offer without using recommendation prices', () => {
  assert.deepEqual(parseEschwegeProduct(ESCHWEGE_HTML, ESCHWEGE), {
    name: 'WILDO & Becher',
    imageUrl: 'https://www.ausruester-eschwege.de/images/product_images/popup_images/51561_0.jpg',
    unitPriceCents: 699,
    sourceUrl: ESCHWEGE,
  });
  assert.equal(
    parseEschwegeProduct(ESCHWEGE_HTML.replace('6.99', '0'), ESCHWEGE).unitPriceCents,
    0
  );
  for (const price of ['unknown', '-1', '100001'])
    assert.equal(
      parseEschwegeProduct(ESCHWEGE_HTML.replace('6.99', price), ESCHWEGE).unitPriceCents,
      null
    );
  assert.equal(
    parseEschwegeProduct(ESCHWEGE_HTML.replace('EUR', 'USD'), ESCHWEGE).unitPriceCents,
    null
  );
  assert.equal(
    parseEschwegeProduct(
      ESCHWEGE_HTML.replace(
        '/images/product_images/popup_images/51561_0.jpg',
        'https://evil.test/photo.jpg'
      ),
      ESCHWEGE
    ).imageUrl,
    null
  );
  assert.throws(() => parseEschwegeProduct('<h1>Category</h1>', ESCHWEGE));
});

test('Eschwege product URLs normalize encoded paths and remove session and action parameters', () => {
  assert.equal(shopProductUrl(ESCHWEGE + '?MODsid=secret&action=add_product#details'), ESCHWEGE);
  assert.equal(shopProductUrl(ESCHWEGE.replace('::', '%3A%3A')), ESCHWEGE.replace('::', '%3A%3A'));
  assert.equal(
    shopProductUrl(
      'https://www.ausruester-eschwege.de/product_info.php?products_id=51561&action=add_product'
    ),
    'https://www.ausruester-eschwege.de/product_info.php?products_id=51561'
  );
  for (const url of [
    'https://www.ausruester-eschwege.de/Kueche:::c500.html',
    'https://www.ausruester-eschwege.de/checkout.php',
    'https://www.ausruester-eschwege.de.evil.test/article::500.html',
    'https://user@www.ausruester-eschwege.de/article::500.html',
  ]) {
    assert.throws(() => shopProductUrl(url));
  }
});

test('Eschwege lookups use the shop parser and reject redirects between suppliers', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(ESCHWEGE_HTML, { headers: { 'content-type': 'text/html' } })
  );
  assert.equal((await getShopProduct(ESCHWEGE)).unitPriceCents, 699);
  fetch.mock.mockImplementation(
    async () => new Response(null, { status: 302, headers: { location: URL } })
  );
  await assert.rejects(getShopProduct(ESCHWEGE.replace('51561', '51562')));
});
