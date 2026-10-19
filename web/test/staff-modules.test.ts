import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAFF_MODULE_SECTIONS, STAFF_MODULES } from '../src/lib/staffModules';

test('every module is listed in a section of the menu and the start page', () => {
  const listed = new Set(
    STAFF_MODULE_SECTIONS.flatMap((section) => section.modules.map((m) => m.href))
  );
  const missing = STAFF_MODULES.map((module) => module.href).filter((href) => !listed.has(href));
  assert.deepEqual(missing, []);
});
