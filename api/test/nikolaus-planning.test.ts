import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDispo, solveDispo, visitMinutes } from '../lib/nikolaus-dispo';
import type { DispoProblem } from '../lib/nikolaus-dispo';
import { parseTags, rateEinteilung, solveEinteilung } from '../lib/nikolaus-einteilung';
import type { EinteilungPerson, EinteilungProblem, HelperRole } from '../lib/nikolaus-einteilung';

const DATE = '2026-12-05';
const NEXT_DATE = '2026-12-06';

function person(
  id: string,
  roles: HelperRole[],
  extra: Partial<EinteilungPerson> = {}
): EinteilungPerson {
  return {
    id,
    name: id,
    availability: { [DATE]: roles },
    positiveTags: [],
    negativeTags: [],
    ...extra,
  };
}

function dispo(extra: Partial<DispoProblem> = {}): DispoProblem {
  return {
    stops: [
      { id: '1', slotStart: 1020, slotEnd: 1050, duration: 10 },
      { id: '2', slotStart: 1020, slotEnd: 1050, duration: 10 },
      { id: '3', slotStart: 1050, slotEnd: 1080, duration: 10 },
    ],
    teams: ['A', 'B'],
    travel: [
      [0, 5, 5, 5],
      [5, 0, 20, 5],
      [5, 20, 0, 20],
      [5, 5, 20, 0],
    ],
    ...extra,
  };
}

test('Dispo preserves fixed teams, assigns every visit once and repeats deterministically', () => {
  const problem = dispo({ fixed: { '1': 'B' }, forbidden: { '2': ['B'], '3': ['A', 'B'] } });
  const result = solveDispo(problem);
  assert.deepEqual(solveDispo(problem), result);
  assert.ok(result.B.includes('1'));
  assert.ok(result.A.includes('2'));
  assert.deepEqual(Object.values(result).flat().sort(), ['1', '2', '3']);
  assert.ok(Number.isFinite(evaluateDispo(problem, result).cost));
});

test('Dispo evaluates waiting, delay after a slot, driving home and empty routes', () => {
  const problem = dispo({
    stops: [
      { id: '1', slotStart: 1020, slotEnd: 1050, duration: 40 },
      { id: '2', slotStart: 1020, slotEnd: 1050, duration: 10 },
      { id: '3', slotStart: 1140, slotEnd: 1170, duration: 10 },
    ],
    travel: [
      [0, 5, 5, 5],
      [5, 0, 15, 5],
      [5, 15, 0, 5],
      [5, 5, 5, 0],
    ],
  });
  const plan = evaluateDispo(problem, { A: ['1', '2', '3'], B: [] });
  const route = plan.routes[0];
  assert.equal(route.departure, 1015);
  assert.deepEqual(
    route.stops.map((stop) => stop.start),
    [1020, 1075, 1140]
  );
  assert.equal(route.stops[1].lateInSlot, 55);
  assert.equal(route.stops[1].lateAfterSlot, 25);
  assert.equal(route.stops[2].arrival, 1090);
  assert.equal(route.returnTime, 1155);
  assert.equal(route.driveMinutes, 30);
  assert.equal(plan.cost, 30 + 55 * 3 + 25 * 25);
  assert.equal(plan.routes[1].departure, null);
  assert.equal(plan.routes[1].returnTime, null);
  assert.equal(plan.routes[1].cost, 0);
  assert.equal(visitMinutes(1), 10);
  assert.equal(visitMinutes(3), 15);
});

test('negative tags block automatic assignments using normalized tag comparisons', () => {
  const result = solveEinteilung({
    persons: [person('1', ['Nikolaus'], { negativeTags: ['  Familie   Müller  '] })],
    days: [{ date: DATE, teams: ['A'], familyTags: { A: [['familie müller']] } }],
  });
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.idle[DATE], ['1']);
  assert.equal(result.open.find((post) => post.role === 'Nikolaus')?.reason, 'ONLY_TAG_CONFLICTS');
  assert.equal(result.open.find((post) => post.role === 'Krampus')?.reason, 'NOBODY');
  assert.deepEqual(parseTags(' Familie  Müller, familie müller, , Rover '), [
    'Familie Müller',
    'Rover',
  ]);
});

test('fixed assignments survive recalculation and report their negative tag conflicts', () => {
  const result = solveEinteilung({
    persons: [
      person('1', ['Nikolaus', 'Krampus'], { negativeTags: ['Müller'] }),
      person('2', ['Krampus']),
    ],
    days: [{ date: DATE, teams: ['A'], familyTags: { A: [['MÜLLER']] } }],
    fixed: [
      { personId: '1', date: DATE, team: 'A', role: 'Nikolaus', fixed: true },
      { personId: '1', date: DATE, team: 'A', role: 'Krampus', fixed: true },
      { personId: 'missing', date: DATE, team: 'A', role: 'Engerl', fixed: true },
    ],
  });
  assert.deepEqual(result.assignments, [
    { personId: '1', date: DATE, team: 'A', role: 'Nikolaus', fixed: true },
    { personId: '2', date: DATE, team: 'A', role: 'Krampus', fixed: false },
  ]);
  assert.deepEqual(result.conflicts, [{ personId: '1', date: DATE, team: 'A', tags: ['Müller'] }]);
});

test('Einteilung prioritizes Nikolaus and fills kitchen only with people free that day', () => {
  const result = solveEinteilung({
    persons: [
      person('1', ['Nikolaus', 'Krampus', 'Küche']),
      person('2', ['Küche']),
      person('3', ['Engerl']),
    ],
    days: [{ date: DATE, teams: ['A'], familyTags: null }],
  });
  assert.equal(result.assignments.find((entry) => entry.personId === '1')?.role, 'Nikolaus');
  assert.equal(result.assignments.find((entry) => entry.personId === '2')?.team, 'Küche');
  assert.equal(result.assignments.filter((entry) => entry.personId === '1').length, 1);
  assert.equal(result.open.find((post) => post.role === 'Krampus')?.reason, 'ALL_BUSY');
  assert.deepEqual(result.idle[DATE], []);
});

test('Einteilung spreads work across days before preferring positive tags', () => {
  const problem: EinteilungProblem = {
    persons: [
      person('1', ['Nikolaus'], {
        availability: { [DATE]: ['Nikolaus'], [NEXT_DATE]: ['Nikolaus'] },
        positiveTags: ['Bekannt'],
      }),
      person('2', [], { availability: { [NEXT_DATE]: ['Nikolaus'] } }),
    ],
    days: [
      { date: DATE, teams: ['A'], familyTags: { A: [['Bekannt']] } },
      { date: NEXT_DATE, teams: ['A'], familyTags: { A: [['Bekannt']] } },
    ],
  };
  const result = solveEinteilung(problem);
  assert.deepEqual(
    result.assignments.map(({ personId, date }) => ({ personId, date })),
    [
      { personId: '1', date: DATE },
      { personId: '2', date: NEXT_DATE },
    ]
  );
  assert.deepEqual(rateEinteilung(problem, result), [2, 0, 0, 0, -0, 1]);
});

test('positive tags select the best eligible team and never override a negative tag', () => {
  const result = solveEinteilung({
    persons: [person('1', ['Nikolaus'], { positiveTags: ['Bekannt'], negativeTags: ['Verboten'] })],
    days: [
      {
        date: DATE,
        teams: ['A', 'B', 'C'],
        familyTags: { A: [], B: [['Bekannt']], C: [['Bekannt'], ['Bekannt', 'Verboten']] },
      },
    ],
  });
  assert.deepEqual(result.assignments, [
    { personId: '1', date: DATE, team: 'B', role: 'Nikolaus', fixed: false },
  ]);
  assert.deepEqual(result.conflicts, []);
});
