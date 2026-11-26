import assert from 'node:assert/strict';
import test from 'node:test';
import { leseKiDoppelte } from '../lib/essen-ki-doppelte-antwort';

test('KI Doppelte: only groups of known ingredients, each in one group, keeping one of them', () => {
  const bekannt = new Set([1, 2, 3, 4, 5, 6]);
  const { gruppen } = leseKiDoppelte(
    {
      gruppen: [
        { ids: [1, 2, 2], behalten: 2, grund: 'Plural.' },
        { ids: [2, 3], behalten: 3, grund: 'schon vergeben' },
        { ids: [4, 99], behalten: 4, grund: 'unbekannt' },
        { ids: [5, 6], behalten: 42, grund: '' },
        'kaputt',
      ],
    },
    bekannt
  );
  assert.deepEqual(gruppen, [
    { ids: [1, 2], behalten: 2, grund: 'Plural.' },
    { ids: [5, 6], behalten: 5, grund: '' },
  ]);
  assert.throws(() => leseKiDoppelte({ nichts: true }, bekannt));
});
