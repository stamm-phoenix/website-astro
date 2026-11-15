import test from 'node:test';
import assert from 'node:assert/strict';
import { inventurLink, inventurArtikelId } from '../src/lib/inventurQr';
test('stable inventory links contain the own origin and article ID, without inherited tokens', () => {
  assert.equal(
    inventurLink('https://stamm-phoenix.de/alter-pfad?token=secret', 42),
    'https://stamm-phoenix.de/leitendenbereich/inventur?artikel=42'
  );
  assert.equal(inventurArtikelId('?artikel=42'), 42);
  assert.equal(inventurArtikelId('?artikel=2&suche=Kohte'), 2);
});
test('invalid numbers never open the wrong article', () => {
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '9007199254740992', '1oops'])
    assert.equal(inventurArtikelId(`?artikel=${value}`), null);
  assert.throws(() => inventurLink('https://stamm-phoenix.de', -1));
});
