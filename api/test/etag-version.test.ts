import assert from 'node:assert/strict';
import { test } from 'node:test';
import { etagNewer, etagNumber } from '../lib/etag-version';

test('etagNumber reads a quoted 16-digit hex rowversion and refuses anything else', () => {
  assert.equal(etagNumber('"00000000000000ff"'), 255n);
  assert.equal(etagNumber(' "00000000000000FF" '), null);
  assert.equal(etagNumber('00000000000000ff'), null);
  assert.equal(etagNumber('"ff"'), null);
  assert.equal(etagNumber(undefined), null);
});

test('etagNewer compares versions as numbers and is false for malformed ones', () => {
  assert.equal(etagNewer('"0000000000000010"', '"000000000000000f"'), true);
  assert.equal(etagNewer('"000000000000000f"', '"0000000000000010"'), false);
  assert.equal(etagNewer('"0000000000000010"', '"0000000000000010"'), false);
  assert.equal(etagNewer('"abc"', '"0000000000000010"'), false);
  assert.equal(etagNewer('"0000000000000010"', 'W/"x"'), false);
});
