import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addRetentionCalendarMonth,
  getNikolausRetentionSchedule,
  getDispoVisitRetentionPolicy,
  InvalidRetentionScheduleError,
  mergeRetentionSeasonPolicy,
} from '../lib/nikolaus-retention-schedule';
import { planNikolausRetention } from '../lib/nikolaus-retention';
import type { RetentionSources } from '../lib/nikolaus-retention';

function sources(): RetentionSources {
  return {
    bookings: [],
    dispo: [],
    helpers: [],
    einteilung: [],
    policies: [],
    geocoding: { cachedLookups: 0 },
  };
}

function dispo(bookingId: string, date: string, visitedAt = '', plannedArrival = '17:00') {
  return { bookingId, date, slotKey: `${date}T${plannedArrival}`, plannedArrival, visitedAt };
}

const JANUARY = new Date('2027-01-31T12:00:00Z');

test('a season-wide schedule includes every booking and produces a complete cleanup plan', () => {
  const data = sources();
  data.bookings = [5, 6, 7, 8].map((day, index) => ({
    id: `${index + 1}`,
    slotKey: `2026-12-0${day}T17:00`,
  }));
  const schedule = getNikolausRetentionSchedule(data, JANUARY);
  assert.deepEqual(schedule.policies, [
    {
      schema: 1,
      season: 2026,
      lastVisit: '2026-12-08',
      deleteOn: '2027-01-08',
      before: '2026-12-09',
    },
  ]);
  assert.deepEqual(schedule.dataSeasons, [2026]);
  assert.deepEqual(schedule.duePolicies, schedule.policies);
  const plan = planNikolausRetention(data, {
    season: 2026,
    before: schedule.policies[0].before,
    responsibleRole: 'Automatischer Nikolaus-Löschlauf',
  });
  assert.deepEqual(plan.bookingIds, ['1', '2', '3', '4']);
  assert.deepEqual(plan.retained, []);
});

test('the daily deadline changes at Berlin midnight, including the UTC day before it', () => {
  const data = sources();
  data.bookings = [{ id: '1', slotKey: '2026-12-06T20:00' }];
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2027-01-05T22:59:59.999Z')).duePolicies.length,
    0
  );
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2027-01-05T23:00:00.000Z')).duePolicies.length,
    1
  );
});

test('one calendar month clamps month ends and preserves leap-day arithmetic', () => {
  for (const [date, expected] of [
    ['2026-01-31', '2026-02-28'],
    ['2024-01-31', '2024-02-29'],
    ['2024-02-29', '2024-03-29'],
    ['2026-10-31', '2026-11-30'],
    ['2026-12-31', '2027-01-31'],
  ])
    assert.equal(addRetentionCalendarMonth(date), expected);
  const data = sources();
  data.helpers = [{ id: '1', dates: ['2026-01-31'] }];
  const policy = getNikolausRetentionSchedule(data, new Date('2026-02-28T00:00:00Z'))
    .duePolicies[0];
  assert.equal(policy.before, '2026-02-01');
  assert.equal(policy.deleteOn, '2026-02-28');
});

test('completion after New Year extends the original slot season using the Berlin visit date', () => {
  const data = sources();
  data.bookings = [{ id: '1', slotKey: '2026-12-31T23:00' }];
  data.dispo = [dispo('1', '2026-12-31', '2027-01-01T23:30:00.000Z', '23:00')];
  const schedule = getNikolausRetentionSchedule(data, new Date('2027-02-02T00:00:00Z'));
  assert.deepEqual(schedule.dataSeasons, [2026]);
  assert.equal(schedule.policies[0].lastVisit, '2027-01-02');
  assert.equal(schedule.policies[0].deleteOn, '2027-02-02');
  assert.equal(schedule.policies[0].before, '2027-01-01');
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2027-02-01T22:59:59Z')).duePolicies.length,
    0
  );
});

test('a check-off shortly after midnight belongs to the next day, an early evening one does not', () => {
  const data = sources();
  data.bookings = [{ id: '1', slotKey: '2026-12-31T20:00' }];
  data.dispo = [dispo('1', '2026-12-31', '2026-12-31T23:15:00.000Z', '20:00')];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).policies[0].lastVisit, '2027-01-01');
  data.dispo = [dispo('1', '2026-12-31', '2026-12-31T18:45:00.000Z', '20:00')];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).policies[0].lastVisit, '2026-12-31');
});

test('helper availability, Einteilung and planned visits prevent premature season cleanup', () => {
  const data = sources();
  data.bookings = [{ id: '1', slotKey: '2026-12-06T17:00' }];
  data.helpers = [{ id: '1', dates: ['2026-12-12'] }];
  data.einteilung = [{ personId: '1', date: '2026-12-15' }];
  data.dispo = [dispo('1', '2026-12-22')];
  const schedule = getNikolausRetentionSchedule(data, new Date('2027-01-21T23:00:00Z'));
  assert.equal(schedule.policies[0].lastVisit, '2026-12-22');
  assert.equal(schedule.policies[0].deleteOn, '2027-01-22');
  assert.equal(schedule.duePolicies.length, 1);
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2027-01-21T22:59:59Z')).duePolicies.length,
    0
  );
});

test('persisted deadlines never move earlier and an empty season is not cleaned again', () => {
  const data = sources();
  data.bookings = [
    { id: '1', slotKey: '2026-12-06T17:00' },
    { id: '2', slotKey: '2026-12-20T17:00' },
  ];
  const observed = getNikolausRetentionSchedule(data, JANUARY).policies[0];
  data.policies = [observed];
  data.bookings.splice(1, 1);
  const partial = getNikolausRetentionSchedule(data, new Date('2027-01-10T12:00:00Z'));
  assert.equal(partial.policies[0].deleteOn, '2027-01-20');
  assert.equal(partial.duePolicies.length, 0);
  const recomputed = getNikolausRetentionSchedule({ ...data, policies: [] }, JANUARY).policies[0];
  assert.deepEqual(mergeRetentionSeasonPolicy(observed, recomputed), observed);
  data.bookings = [];
  const cleared = getNikolausRetentionSchedule(data, JANUARY);
  assert.deepEqual(cleared.policies, [observed]);
  assert.deepEqual(cleared.dataSeasons, []);
  assert.deepEqual(cleared.duePolicies, []);
  data.bookings = [{ id: '3', slotKey: '2026-12-05T17:00' }];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).duePolicies.length, 1);
});

test('different seasons stay independent', () => {
  const data = sources();
  data.bookings = [
    { id: '1', slotKey: '2025-12-06T17:00' },
    { id: '2', slotKey: '2026-12-06T17:00' },
  ];
  const schedule = getNikolausRetentionSchedule(data, new Date('2026-10-02T12:00:00Z'));
  assert.deepEqual(schedule.dataSeasons, [2025, 2026]);
  assert.deepEqual(
    schedule.duePolicies.map((policy) => policy.season),
    [2025]
  );
});

test('invalid dates, timestamps and saved deadlines stop automatic cleanup', () => {
  const data = sources();
  data.bookings = [{ id: '1', slotKey: '2026-02-30T17:00' }];
  assert.throws(() => getNikolausRetentionSchedule(data, JANUARY), InvalidRetentionScheduleError);
  data.bookings = [{ id: '1', slotKey: '2026-12-06T17:00' }];
  const observed = getNikolausRetentionSchedule(data, JANUARY).policies[0];
  assert.throws(
    () => mergeRetentionSeasonPolicy({ ...observed, deleteOn: '2027-01-01' }, observed),
    InvalidRetentionScheduleError
  );
  data.dispo = [dispo('1', '2026-12-06', '2026-12-06T20:00:00')];
  assert.throws(() => getNikolausRetentionSchedule(data, JANUARY), InvalidRetentionScheduleError);
  data.dispo = [];
  data.policies = [{ ...observed, before: '2027-12-31' }];
  assert.throws(() => getNikolausRetentionSchedule(data, JANUARY), InvalidRetentionScheduleError);
});

test('summer Berlin midnight stays deterministic when the host uses another time zone', (t) => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
  const data = sources();
  data.helpers = [{ id: '1', dates: ['2026-07-10'] }];
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2026-08-09T21:59:59.999Z')).duePolicies.length,
    0
  );
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2026-08-09T22:00:00.000Z')).duePolicies.length,
    1
  );
});

test('mutation-time completion policy keeps the original season across New Year', () => {
  const visit = {
    date: '2026-12-31',
    slotKey: '2026-12-31T23:00',
    plannedArrival: '23:00',
    visitedAt: '2027-01-01T23:30:00Z',
  };
  assert.deepEqual(getDispoVisitRetentionPolicy(visit), {
    schema: 1,
    season: 2026,
    lastVisit: '2027-01-02',
    deleteOn: '2027-02-02',
    before: '2027-01-01',
  });
  assert.equal(getDispoVisitRetentionPolicy({ ...visit, visitedAt: '' }), undefined);
});

test('unclassified helper personal data is surfaced without inventing a deletion season', () => {
  const data = sources();
  data.helpers = [{ id: '7', dates: [] }];
  const schedule = getNikolausRetentionSchedule(data, JANUARY);
  assert.deepEqual(schedule.unclassified, [
    { kind: 'helper', id: '7', reason: 'unclassified_availability' },
  ]);
  assert.deepEqual(schedule.policies, []);
  assert.deepEqual(schedule.dataSeasons, []);
  assert.deepEqual(schedule.duePolicies, []);
});

test('the plan keeps bookings planned on a later day and helpers available later', () => {
  const data = sources();
  data.bookings = [
    { id: '1', slotKey: '2026-12-05T17:00' },
    { id: '2', slotKey: '2026-12-05T18:00' },
  ];
  data.dispo = [dispo('1', '2026-12-05'), dispo('2', '2026-12-20')];
  data.helpers = [
    { id: '1', dates: ['2026-12-05'] },
    { id: '2', dates: ['2026-12-05', '2026-12-20'] },
    { id: '3', dates: ['2026-12-05'] },
  ];
  data.einteilung = [
    { personId: '1', date: '2026-12-05' },
    { personId: '3', date: '2026-12-20' },
  ];
  const plan = planNikolausRetention(data, {
    season: 2026,
    before: '2026-12-06',
    responsibleRole: 'Test',
  });
  assert.deepEqual(plan.bookingIds, ['1']);
  assert.deepEqual(plan.helperIds, ['1']);
  assert.deepEqual(plan.dates, ['2026-12-05']);
  assert.deepEqual(plan.retained, [
    { kind: 'booking', id: '2', reason: 'dependent_dispo_outside_cutoff' },
    { kind: 'helper', id: '2', reason: 'availability_outside_cutoff' },
    { kind: 'helper', id: '3', reason: 'dependent_einteilung_outside_cutoff' },
  ]);
});
