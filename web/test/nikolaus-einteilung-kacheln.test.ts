import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyParked,
  countEinsaetze,
  moveTile,
  parkedFromRows,
  placePerson,
  rolesOn,
  withoutParked,
} from '../src/lib/nikolausEinteilungKacheln';
import type { EinteilungAssignment, EinteilungPerson } from '../src/lib/nikolausEinteilung';

const DAY = '2026-12-05';
const OTHER = '2026-12-06';

function person(id: string, roles: EinteilungPerson['availability'][string]): EinteilungPerson {
  return { id, name: id, availability: { [DAY]: roles }, positiveTags: [], negativeTags: [] };
}

const persons = new Map(
  [
    person('anna', ['Küche', 'Nikolaus', 'Fahrer*in']),
    person('ben', ['Nikolaus', 'Krampus']),
    person('cem', ['Nikolaus']),
  ].map((p) => [p.id, p])
);

function post(
  personId: string,
  team: string,
  role: EinteilungAssignment['role'],
  date = DAY
): EinteilungAssignment {
  return { personId, date, team, role, fixed: false };
}

describe('rolesOn', () => {
  test('lists the posts of the day in order of importance', () => {
    assert.deepEqual(rolesOn(persons.get('anna'), DAY), ['Nikolaus', 'Fahrer*in', 'Küche']);
    assert.deepEqual(rolesOn(persons.get('anna'), OTHER), []);
  });
});

describe('placePerson', () => {
  test('places a free person on an open post', () => {
    const result = placePerson([], persons, DAY, 'anna', { team: 'A', role: 'Fahrer*in' });
    assert.deepEqual(result, [
      { personId: 'anna', date: DAY, team: 'A', role: 'Fahrer*in', fixed: false },
    ]);
  });

  test('moves a person, so they keep one post per day; other days stay', () => {
    const other = post('anna', 'A', 'Nikolaus', OTHER);
    const result = placePerson([post('anna', 'A', 'Nikolaus'), other], persons, DAY, 'anna', {
      team: 'B',
      role: 'Nikolaus',
    });
    assert.deepEqual(result, [
      other,
      { personId: 'anna', date: DAY, team: 'B', role: 'Nikolaus', fixed: false },
    ]);
  });

  test('swaps with the person on the post when they volunteered for the former post', () => {
    const result = placePerson(
      [post('anna', 'A', 'Nikolaus'), post('ben', 'B', 'Nikolaus')],
      persons,
      DAY,
      'anna',
      { team: 'B', role: 'Nikolaus' }
    );
    assert.deepEqual(result, [
      { personId: 'anna', date: DAY, team: 'B', role: 'Nikolaus', fixed: false },
      { personId: 'ben', date: DAY, team: 'A', role: 'Nikolaus', fixed: false },
    ]);
  });

  test('frees the person on the post when they cannot take the former post', () => {
    const result = placePerson(
      [post('anna', 'A', 'Fahrer*in'), post('cem', 'B', 'Nikolaus')],
      persons,
      DAY,
      'anna',
      { team: 'B', role: 'Nikolaus' }
    );
    assert.deepEqual(result, [
      { personId: 'anna', date: DAY, team: 'B', role: 'Nikolaus', fixed: false },
    ]);
  });

  test('refuses a post the person did not volunteer for', () => {
    const before = [post('cem', 'A', 'Nikolaus')];
    assert.equal(placePerson(before, persons, DAY, 'cem', { team: 'A', role: 'Krampus' }), before);
  });

  test('takes a person out of the teams', () => {
    const other = post('ben', 'A', 'Krampus');
    assert.deepEqual(
      placePerson([post('anna', 'A', 'Nikolaus'), other], persons, DAY, 'anna', null),
      [other]
    );
  });

  test('held posts keep their person', () => {
    const held = { ...post('anna', 'A', 'Nikolaus'), fixed: true };
    const before = [held, post('ben', 'B', 'Nikolaus')];
    assert.equal(
      placePerson(before, persons, DAY, 'anna', { team: 'B', role: 'Nikolaus' }),
      before
    );
    assert.equal(placePerson(before, persons, DAY, 'anna', null), before);
    assert.equal(placePerson(before, persons, DAY, 'ben', { team: 'A', role: 'Nikolaus' }), before);
  });

  test('dropping a person on their own post changes nothing', () => {
    const before = [post('anna', 'A', 'Nikolaus')];
    assert.equal(
      placePerson(before, persons, DAY, 'anna', { team: 'A', role: 'Nikolaus' }),
      before
    );
  });
});

describe('moveTile', () => {
  test('parks a person out of a team, so they do not go to the kitchen', () => {
    const result = moveTile([post('anna', 'A', 'Nikolaus')], {}, persons, DAY, 'anna', 'parken');
    assert.deepEqual(result, { assignments: [], parked: { [DAY]: ['anna'] } });
  });

  test('a parked person placed on a post or into the kitchen is no longer parked', () => {
    const parked = { [DAY]: ['anna', 'ben'], [OTHER]: ['anna'] };
    const onPost = moveTile([], parked, persons, DAY, 'anna', { team: 'A', role: 'Nikolaus' });
    assert.deepEqual(onPost.parked, { [DAY]: ['ben'], [OTHER]: ['anna'] });
    const inKitchen = moveTile([], { [DAY]: ['anna'] }, persons, DAY, 'anna', 'Küche');
    assert.deepEqual(inKitchen, { assignments: [], parked: {} });
  });

  test('a held person stays on their post', () => {
    const before = [{ ...post('anna', 'A', 'Nikolaus'), fixed: true }];
    assert.deepEqual(moveTile(before, {}, persons, DAY, 'anna', 'parken'), {
      assignments: before,
      parked: {},
    });
  });

  test('who is pushed off a post without a kitchen to go to stays in the box', () => {
    const result = moveTile([post('cem', 'A', 'Nikolaus')], {}, persons, DAY, 'ben', {
      team: 'A',
      role: 'Nikolaus',
    });
    assert.deepEqual(result.parked, { [DAY]: ['cem'] });
    const toKitchen = moveTile([post('anna', 'A', 'Nikolaus')], {}, persons, DAY, 'ben', {
      team: 'A',
      role: 'Nikolaus',
    });
    assert.deepEqual(toKitchen.parked, {});
  });

  test('only who volunteered for the kitchen goes there', () => {
    const before = [post('ben', 'A', 'Krampus')];
    const result = moveTile(before, {}, persons, DAY, 'ben', 'Küche');
    assert.equal(result.assignments, before);
  });
});

describe('parkedFromRows', () => {
  test('a kitchen volunteer without a row on a saved day was put aside', () => {
    const rows = [post('ben', 'A', 'Nikolaus')];
    assert.deepEqual(parkedFromRows([...persons.values()], rows, [DAY]), { [DAY]: ['anna'] });
    assert.deepEqual(
      parkedFromRows([...persons.values()], [...rows, post('anna', 'Küche', 'Küche')], [DAY]),
      {}
    );
    assert.deepEqual(parkedFromRows([...persons.values()], [], [DAY]), {});
  });

  test('a day whose persons were all put aside keeps them after saving', () => {
    const both = new Map(persons);
    both.set('anna', {
      ...persons.get('anna')!,
      availability: { [DAY]: ['Küche'], [OTHER]: ['Küche'] },
    });
    // Saved: only the kitchen row of the other day; the day itself has no rows any more
    const rows = [post('anna', 'Küche', 'Küche', OTHER)];
    assert.deepEqual(parkedFromRows([...both.values()], rows, [DAY, OTHER]), {
      [DAY]: ['anna'],
    });
  });
});

describe('parking and the plan', () => {
  test('recalculating leaves parked persons out on that day only', () => {
    const anna = persons.get('anna')!;
    const both = {
      ...anna,
      availability: { [DAY]: ['Küche' as const], [OTHER]: ['Küche' as const] },
    };
    const problem = withoutParked({ persons: [both], days: [] }, { [DAY]: ['anna'] });
    assert.deepEqual(problem.persons[0].availability, { [OTHER]: ['Küche'] });
  });

  test('parked persons leave the kitchen and count as without a post', () => {
    const kitchen = post('anna', 'Küche', 'Küche');
    const result = applyParked(
      {
        assignments: [kitchen, post('ben', 'A', 'Nikolaus')],
        open: [],
        idle: { [DAY]: [] },
        conflicts: [],
      },
      { [DAY]: ['anna'] }
    );
    assert.deepEqual(result.assignments, [post('ben', 'A', 'Nikolaus')]);
    assert.deepEqual(result.idle, { [DAY]: ['anna'] });
  });
});

describe('countEinsaetze', () => {
  test('counts the posts per person over all days, the kitchen included', () => {
    const counts = countEinsaetze([
      post('anna', 'A', 'Nikolaus'),
      post('anna', 'B', 'Nikolaus', OTHER),
      post('anna', 'Küche', 'Küche', '2026-12-07'),
      post('ben', 'A', 'Krampus'),
    ]);
    assert.deepEqual(counts.get('anna'), { total: 3, byRole: { Nikolaus: 2, Küche: 1 } });
    assert.deepEqual(counts.get('ben'), { total: 1, byRole: { Krampus: 1 } });
    assert.equal(counts.get('cem'), undefined);
  });
});
