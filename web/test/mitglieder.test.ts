import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gruppen,
  inAnsicht,
  matchesSearch,
  mitgliedSeit,
  mitgliedStatus,
  sortMitglieder,
} from '../src/lib/mitglieder';
import type { CampflowPerson } from '../src/lib/types';

const TODAY = '2026-10-23';

function person(id: string, groups: string[], extra: Partial<CampflowPerson> = {}): CampflowPerson {
  return {
    id,
    name: { first_name: id, last_name: 'Muster' },
    group_names: groups,
    join_date: '2020-09-01',
    leave_date: null,
    ...extra,
  };
}

test('the status follows the join and leave date', () => {
  assert.equal(mitgliedStatus(person('a', []), TODAY), 'aktiv');
  assert.equal(mitgliedStatus(person('a', [], { leave_date: TODAY }), TODAY), 'ausgetreten');
  assert.equal(mitgliedStatus(person('a', [], { leave_date: '2026-12-31' }), TODAY), 'aktiv');
  assert.equal(mitgliedStatus(person('a', [], { join_date: '2026-11-01' }), TODAY), 'kuenftig');

  assert.equal(mitgliedSeit(person('a', []), TODAY), 'Mitglied seit 01.09.2020');
  assert.equal(
    mitgliedSeit(person('a', [], { leave_date: '2026-12-31' }), TODAY),
    'Mitglied seit 01.09.2020, tritt am 31.12.2026 aus'
  );
  assert.equal(
    mitgliedSeit(person('a', [], { leave_date: '2026-01-31' }), TODAY),
    'Ausgetreten am 31.01.2026'
  );
  assert.equal(
    mitgliedSeit(person('a', [], { join_date: '2026-11-01' }), TODAY),
    'Tritt am 01.11.2026 ein'
  );
});

test('the Stufen come first in their order, then the other groups by name', () => {
  const persons = [
    person('a', ['🔴 Rover', '🐦‍🔥 Leiter*in']),
    person('b', ['🟠 Wölfling', ' 🟠 Wölfling ']),
    person('c', ['⚜️ Ehemalige*r', '🟢 Pfadfinder*in']),
    person('d', ['🔵 Jungpfadfinder*in']),
  ];
  assert.deepEqual(gruppen(persons), [
    '🟠 Wölfling',
    '🔵 Jungpfadfinder*in',
    '🟢 Pfadfinder*in',
    '🔴 Rover',
    '⚜️ Ehemalige*r',
    '🐦‍🔥 Leiter*in',
  ]);
});

test('groups and „Alle“ show current members, former ones have a tab of their own', () => {
  const rover = person('rover', ['🔴 Rover']);
  const ohne = person('ohne', []);
  const neu = person('neu', ['🔴 Rover'], { join_date: '2026-11-01' });
  const weg = person('weg', ['🔴 Rover'], { leave_date: '2025-08-31' });
  const all = [rover, ohne, neu, weg];
  const ids = (ansicht: Parameters<typeof inAnsicht>[1]) =>
    all.filter((p) => inAnsicht(p, ansicht, TODAY)).map((p) => p.id);

  assert.deepEqual(ids('alle'), ['rover', 'ohne', 'neu']);
  assert.deepEqual(ids('gruppe:🔴 Rover'), ['rover', 'neu']);
  assert.deepEqual(ids('ohne-gruppe'), ['ohne']);
  assert.deepEqual(ids('ausgetreten'), ['weg']);
});

test('the search finds names, member numbers and addresses without accents', () => {
  const jose = person('José', [], {
    name: { first_name: 'José', last_name: 'Müller' },
    membership_number: 'M123',
    primary_email: 'jose@example.org',
    cc_emails: ['eltern.mueller@example.net', 42],
  });
  assert.ok(matchesSearch(jose, ''));
  assert.ok(matchesSearch(jose, 'jose mül'));
  assert.ok(matchesSearch(jose, 'm123'));
  assert.ok(matchesSearch(jose, 'example.org'));
  assert.ok(matchesSearch(jose, 'eltern.mueller'));
  assert.ok(!matchesSearch(jose, 'jose huber'));
});

test('members are sorted by last name, then first name', () => {
  const sorted = sortMitglieder([
    person('x', [], { name: { first_name: 'Zoe', last_name: 'Aigner' } }),
    person('y', [], { name: { first_name: 'Anna', last_name: 'Öller' } }),
    person('z', [], { name: { first_name: 'Anna', last_name: 'Aigner' } }),
  ]);
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['z', 'x', 'y']
  );
});
