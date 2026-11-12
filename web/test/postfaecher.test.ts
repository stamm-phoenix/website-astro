import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTFACH_MODULES } from '../src/lib/postfaecher';

test('mailbox tiles use the short name without „-Postfach“', () => {
  const kontakt = POSTFACH_MODULES.find((module) => module.title === 'Kontakt-Postfach');
  assert.equal(kontakt?.shortcut, 'Kontakt');
  for (const module of POSTFACH_MODULES) {
    assert.ok(module.shortcut, module.title);
    assert.ok(!module.shortcut.includes('Postfach'), module.title);
  }
});
