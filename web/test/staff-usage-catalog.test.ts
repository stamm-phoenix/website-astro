import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAFF_USAGE_MODULES } from '../../api/lib/staff-usage-model';
import { STAFF_MODULES, NIKOLAUS_MODULES, NIKOLAUS_CONTROL_MODULE } from '../src/lib/staffModules';
test('counter keys cover registered modules and exclude detail pages', () => {
  assert.deepEqual(
    [...STAFF_USAGE_MODULES].sort(),
    [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE, ...NIKOLAUS_MODULES].map((m) => m.href).sort()
  );
});
