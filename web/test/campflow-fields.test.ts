import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultColumnKeys } from '../src/lib/campflowColumns';
import type { PersonColumn } from '../src/lib/campflowFields.ts';

function column(key: string): PersonColumn {
  return {
    key,
    label: key,
    text: () => '',
    sortValue: () => '',
  };
}

test('first participant view stays compact without hiding custom fields', () => {
  const keys = defaultColumnKeys(
    ['name', 'status', 'age', 'beitrag', 'verwendungszweck', 'col_consent'].map(column)
  );

  assert.deepEqual(keys, ['name', 'status', 'age', 'beitrag', 'verwendungszweck']);
});
