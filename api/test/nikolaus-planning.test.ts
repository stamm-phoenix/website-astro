import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDispo, moveStop, solveDispo, visitMinutes } from '../lib/nikolaus-dispo';
import type { DispoProblem } from '../lib/nikolaus-dispo';
import {
  completeEinteilung,
  parseTags,
  rateEinteilung,
  solveEinteilung,
  teamCapacity,
} from '../lib/nikolaus-einteilung';
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
  assert.equal(visitMinutes(9), 45);
  assert.equal(visitMinutes(20), 45);
});

test('checked-off visits stay first in their team and the rest starts at the last check-off', () => {
  // Team B left family 2 at 18:00, ten minutes after the end of its slot
  const problem = dispo({ done: { '2': { team: 'B', leftAt: 1080 } } });

  const plan = evaluateDispo(problem, { A: ['2', '1'], B: ['3'] });
  const [a, b] = plan.routes;
  assert.deepEqual(
    a.stops.map((stop) => stop.id),
    ['1']
  );
  assert.deepEqual(
    b.stops.map((stop) => stop.id),
    ['2', '3']
  );
  // The visit ends at its check-off and counts no delay any more
  assert.equal(b.stops[0].start, 1070);
  assert.equal(b.stops[0].end, 1080);
  assert.equal(b.stops[0].lateAfterSlot, 0);
  assert.equal(b.departure, 1065);
  assert.equal(b.stops[1].arrival, 1100);
  assert.equal(b.stops[1].lateAfterSlot, 20);

  const result = solveDispo(problem);
  assert.equal(result.B[0], '2');
  assert.deepEqual(Object.values(result).flat().sort(), ['1', '2', '3']);

  assert.deepEqual(moveStop(problem, { A: ['1'], B: ['2', '3'] }, '2', 'A'), {
    A: ['1'],
    B: ['2', '3'],
  });
  const moved = moveStop(problem, { A: ['3', '1'], B: ['2'] }, '1', 'B');
  assert.deepEqual(moved.B, ['2', '1']);
  assert.deepEqual(moved.A, ['3']);
});

test('checked-off visits keep the order of their check-offs', () => {
  const problem = dispo({
    done: {
      '1': { team: 'A', leftAt: 1060 },
      '3': { team: 'A', leftAt: 1040 },
      '2': { team: 'C' },
    },
  });
  const result = solveDispo(problem);
  assert.deepEqual(result.A.slice(0, 2), ['3', '1']);
  // A team that does not exist does not hold a visit
  assert.deepEqual(Object.values(result).flat().sort(), ['1', '2', '3']);
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

test('a saved Einteilung names open posts that free people could fill', () => {
  const result = completeEinteilung(
    {
      persons: [person('1', ['Nikolaus']), person('2', ['Nikolaus'])],
      days: [{ date: DATE, teams: ['A', 'B'], familyTags: null }],
    },
    [{ personId: '1', date: DATE, team: 'A', role: 'Nikolaus', fixed: false }]
  );
  assert.equal(
    result.open.find((post) => post.team === 'B' && post.role === 'Nikolaus')?.reason,
    'UNFILLED'
  );
});

test('Einteilung staffs ready teams instead of spreading Nikoläuse', () => {
  const all: HelperRole[] = ['Nikolaus', 'Krampus', 'Fahrer*in', 'Engerl'];
  const result = solveEinteilung({
    persons: [person('1', all), person('2', all), person('3', all)],
    days: [{ date: DATE, teams: ['A', 'B', 'C'], familyTags: null }],
  });
  const teamA = result.assignments.filter((entry) => entry.team === 'A').map((e) => e.role);
  assert.deepEqual(teamA.sort(), ['Fahrer*in', 'Krampus', 'Nikolaus']);
  assert.equal(result.assignments.filter((entry) => entry.team !== 'A').length, 0);
});

test('Einteilung finds the most ready teams in a sparse mix', () => {
  const problem: EinteilungProblem = {
    persons: [
      person('n1', ['Nikolaus']),
      person('n2', ['Nikolaus', 'Krampus']),
      person('n3', ['Nikolaus', 'Fahrer*in']),
      person('k1', ['Krampus', 'Engerl']),
      person('f1', ['Fahrer*in']),
      person('f2', ['Fahrer*in', 'Krampus']),
      person('e1', ['Engerl']),
    ],
    days: [{ date: DATE, teams: ['A', 'B', 'C'], familyTags: null }],
  };
  const result = solveEinteilung(problem);
  assert.equal(rateEinteilung(problem, result)[0], 2);
  assert.deepEqual(teamCapacity(problem.persons, DATE), { ready: 2, complete: 1 });
});

test('negative tags count for Nikolaus, Krampus and Engerl, not for the Fahrer*in', () => {
  const tags = { negativeTags: ['Müller'] };
  const problem: EinteilungProblem = {
    persons: [
      person('n', ['Nikolaus'], tags),
      person('k', ['Krampus'], tags),
      person('f', ['Fahrer*in'], tags),
      person('e', ['Engerl'], tags),
    ],
    days: [{ date: DATE, teams: ['A'], familyTags: { A: [['Müller']] } }],
  };
  const result = solveEinteilung(problem);
  assert.deepEqual(result.assignments, [
    { personId: 'f', date: DATE, team: 'A', role: 'Fahrer*in', fixed: false },
  ]);
  assert.deepEqual(
    result.open.map((post) => `${post.role}:${post.reason}`),
    ['Nikolaus:ONLY_TAG_CONFLICTS', 'Krampus:ONLY_TAG_CONFLICTS', 'Engerl:ONLY_TAG_CONFLICTS']
  );
  const byHand = completeEinteilung(
    problem,
    (['n', 'k', 'f', 'e'] as const).map((id, i) => ({
      personId: id,
      date: DATE,
      team: 'A',
      role: (['Nikolaus', 'Krampus', 'Fahrer*in', 'Engerl'] as const)[i],
      fixed: true,
    }))
  );
  assert.deepEqual(
    byHand.conflicts.map((conflict) => conflict.personId),
    ['n', 'k', 'e']
  );
});

test('Einteilung keeps a team ready even when tags pull people apart', () => {
  const result = solveEinteilung({
    persons: [
      person('n', ['Nikolaus'], { negativeTags: ['Wölflinge'] }),
      person('f', ['Fahrer*in'], { positiveTags: ['Wölflinge'] }),
    ],
    days: [{ date: DATE, teams: ['A', 'B'], familyTags: { A: [['Wölflinge']], B: [] } }],
  });
  assert.deepEqual(result.assignments.map((entry) => `${entry.team}:${entry.role}`).sort(), [
    'B:Fahrer*in',
    'B:Nikolaus',
  ]);
});

test('Einteilung finds the largest combination of ready teams, not the first one', () => {
  const result = solveEinteilung({
    persons: [
      person('N1', ['Nikolaus'], { negativeTags: ['C'] }),
      person('N2', ['Nikolaus'], { negativeTags: ['A', 'B'] }),
      // Negative tags of the Fahrer*in do not count
      person('F1', ['Fahrer*in'], { negativeTags: ['A', 'C'] }),
      person('F2', ['Fahrer*in'], { negativeTags: ['A', 'C'] }),
    ],
    days: [
      { date: DATE, teams: ['A', 'B', 'C'], familyTags: { A: [['A']], B: [['B']], C: [['C']] } },
    ],
  });
  assert.deepEqual(result.assignments.map((entry) => `${entry.team}:${entry.role}`).sort(), [
    'A:Fahrer*in',
    'A:Nikolaus',
    'C:Fahrer*in',
    'C:Nikolaus',
  ]);
  assert.deepEqual(
    result.assignments
      .filter((entry) => entry.role === 'Nikolaus')
      .map((e) => e.personId)
      .sort(),
    ['N1', 'N2']
  );
  assert.equal(result.assignments.find((entry) => entry.personId === 'N1')?.team, 'A');
});

test('team capacity names only complete teams that fit with the ready ones', () => {
  const all: HelperRole[] = ['Nikolaus', 'Krampus', 'Fahrer*in', 'Engerl'];
  const persons = ['1', '2', '3', '4'].map((id) => person(id, all));
  assert.deepEqual(teamCapacity(persons, DATE), { ready: 2, complete: 0 });
});

test('team capacity counts the most complete teams', () => {
  const persons = [
    person('n1', ['Nikolaus']),
    person('n2', ['Nikolaus']),
    person('n3', ['Nikolaus']),
    person('f1', ['Fahrer*in']),
    person('f2', ['Fahrer*in']),
    person('f3', ['Fahrer*in']),
    person('x1', ['Krampus', 'Engerl']),
    person('x2', ['Krampus', 'Engerl']),
    person('x3', ['Krampus', 'Engerl']),
    person('x4', ['Krampus', 'Engerl']),
  ];
  assert.deepEqual(teamCapacity(persons, DATE), { ready: 3, complete: 2 });
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
  assert.deepEqual(rateEinteilung(problem, result), [0, 2, 0, 0, 0, -0, 1]);
});

test('planning one day counts only the kept posts of the other days', () => {
  const problem: EinteilungProblem = {
    persons: [
      person('N1', ['Nikolaus'], {
        availability: { [DATE]: ['Nikolaus'], [NEXT_DATE]: ['Nikolaus'] },
        positiveTags: ['Bekannt'],
      }),
      person('N2', ['Nikolaus'], {
        availability: { [DATE]: ['Nikolaus'], [NEXT_DATE]: ['Fahrer*in'] },
      }),
      person('F', ['Fahrer*in']),
    ],
    days: [
      { date: DATE, teams: ['A'], familyTags: { A: [['Bekannt']] } },
      { date: NEXT_DATE, teams: ['A'], familyTags: {} },
    ],
    fixed: [
      { personId: 'N1', date: NEXT_DATE, team: 'A', role: 'Nikolaus', fixed: true },
      { personId: 'F', date: DATE, team: 'A', role: 'Fahrer*in', fixed: true },
    ],
  };
  const nikolaus = (plannedDates?: string[]): string | undefined =>
    solveEinteilung({ ...problem, plannedDates }).assignments.find(
      (a) => a.date === DATE && a.role === 'Nikolaus'
    )?.personId;
  // Planning both days sends N2 to drive on Sunday, so N1 may take Saturday too
  assert.equal(nikolaus(), 'N1');
  // Planning Saturday alone keeps Sunday as it is, so N2 shares the work
  assert.equal(nikolaus([DATE]), 'N2');
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
