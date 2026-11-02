import assert from 'node:assert/strict';
import test from 'node:test';
import {
  geschaeftVon,
  geschaeftsName,
  geschaeftVorschlaege,
  getipptesGeschaeft,
} from '../src/components/essensplanung/zeileGeschaeft.ts';

const geschaefte = [
  { id: 1, etag: 'a', position: 1, name: 'Metro' },
  { id: 2, etag: 'b', position: 2, name: 'Bäckerei Öz' },
];

test('a typed shop is found ignoring case and spaces, but not umlauts', () => {
  assert.equal(getipptesGeschaeft(geschaefte, '  metro ')?.id, 1);
  assert.equal(getipptesGeschaeft(geschaefte, 'bäckerei   öz')?.id, 2);
  assert.equal(getipptesGeschaeft(geschaefte, 'Backerei Oz'), undefined);
  assert.equal(geschaeftsName('  Neuer   Markt '), 'Neuer Markt');
});

test('the shop of an ingredient and the suggestions', () => {
  assert.equal(geschaeftVon(geschaefte, { geschaeftId: 2 } as never), 'Bäckerei Öz');
  assert.equal(geschaeftVon(geschaefte, { geschaeftId: null } as never), '');
  assert.equal(geschaeftVon(geschaefte, undefined), '');
  assert.deepEqual(geschaeftVorschlaege(geschaefte), [
    { key: '1', value: 'Metro' },
    { key: '2', value: 'Bäckerei Öz' },
  ]);
});
