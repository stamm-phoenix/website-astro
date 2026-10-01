import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAMMEL_STAMM_PRODUKTE,
  getSammelStammProdukt,
  SAMMEL_MAX_KATALOG_ARTIKEL,
} from '../lib/sammelbestellung-stamm';
import { validateSammelCatalog, validateSammelItems } from '../lib/sammelbestellung-validation';
import { getSammelShop, isSammelProductUrl, sammelShopUrl } from '../lib/sammelbestellung-shops';
import { getSammelProduct, sammelProductReference } from '../lib/sammelbestellung-product-resolver';
import { sammelReceipt } from '../lib/sammelbestellung-export';

const item = {
  reference: 'stamm-halstuch',
  name: 'Manipulated name',
  variant: 'fake',
  quantity: 2,
  shop: 'ruesthaus',
};

test('all twelve stock products have unique images, integer prices and six limited editions', () => {
  assert.equal(SAMMEL_STAMM_PRODUKTE.length, 12);
  assert.equal(new Set(SAMMEL_STAMM_PRODUKTE.map((p) => p.reference)).size, 12);
  assert.equal(new Set(SAMMEL_STAMM_PRODUKTE.map((p) => p.imageUrl)).size, 12);
  assert.deepEqual(
    SAMMEL_STAMM_PRODUKTE.map((p) => p.unitPriceCents),
    [2000, 300, 300, 300, 200, 200, 200, 200, 200, 200, 100, 100]
  );
  assert.equal(SAMMEL_STAMM_PRODUKTE.filter((p) => p.limited).length, 6);
});

test('stock orders infer the supplier and canonical name and discard invented variants and prices', () => {
  assert.deepEqual(validateSammelItems([{ ...item, unitPriceCents: 1 }]), [
    {
      shop: 'stamm',
      reference: item.reference,
      name: 'Stamm Phoenix Halstuch',
      variant: '',
      quantity: 2,
    },
  ]);
  assert.equal(getSammelShop(item.reference, 'eschwege'), 'stamm');
  assert.equal(isSammelProductUrl(item.reference), false);
  assert.throws(() => sammelShopUrl(item.reference));
  assert.throws(() => validateSammelItems([{ ...item, reference: 'stamm-fake' }]));
  assert.throws(() => validateSammelItems([{ ...item, reference: '123', shop: 'stamm' }]));
  assert.equal(getSammelStammProdukt('STAMM-HALSTUCH'), undefined);
});

test('stock product lookups do not call a shop and never promise stock availability', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected external request');
  });
  const product = await getSammelProduct(sammelProductReference(' stamm-halstuch '));
  assert.equal(product.unitPriceCents, 2000);
  assert.equal(product.availability, 'unknown');
  assert.equal(fetch.mock.callCount(), 0);
  assert.throws(() => sammelProductReference('stamm-fake'));
});

test('catalog accepts the expanded default size while retaining row and serialized bounds', () => {
  const stock = SAMMEL_STAMM_PRODUKTE.map((p) => ({
    shop: 'stamm',
    name: p.name,
    reference: p.reference,
    variants: [],
  }));
  const catalog = [
    ...stock,
    ...Array.from({ length: 23 }, (_, index) => ({
      name: 'Shop article',
      reference: String(index),
      variants: [],
    })),
  ];
  assert.equal(validateSammelCatalog(catalog).length, 35);
  assert.throws(() =>
    validateSammelCatalog(Array(SAMMEL_MAX_KATALOG_ARTIKEL + 1).fill(catalog[0]))
  );
  assert.throws(() =>
    validateSammelCatalog(
      Array(30).fill({ name: 'Kluft', reference: '123', variants: Array(40).fill('x'.repeat(120)) })
    )
  );
});

test('mixed receipts use trusted stock prices and omit excluded items without hiding missing shop prices', () => {
  const stock = validateSammelItems([item])[0];
  const shop = { name: 'Shop item', reference: '123', variant: '', quantity: 3 };
  assert.deepEqual(sammelReceipt([stock, shop], { 'stamm-halstuch': 1, '123': 500 }), {
    subtotalCents: 5500,
    missingPositions: 0,
    totalCents: 5500,
  });
  assert.equal(sammelReceipt([stock, shop], {}).totalCents, null);
  assert.equal(
    sammelReceipt([stock, { ...shop, excluded: { reason: 'Unavailable' } }], {}).totalCents,
    4000
  );
});
