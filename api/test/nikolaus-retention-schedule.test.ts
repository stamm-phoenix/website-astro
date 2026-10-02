import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addRetentionCalendarMonth,
  getNikolausRetentionSchedule,
  getDispoVisitRetentionPolicy,
  InvalidRetentionScheduleError,
  mergeRetentionSeasonPolicy,
  retentionScheduleKey,
} from '../lib/nikolaus-retention-schedule';
import { planNikolausRetention, retentionDigest } from '../lib/nikolaus-retention';
import type { RetentionSources } from '../lib/nikolaus-retention';
import type { NikolausStateRecord } from '../lib/nikolaus-state';

function row(id: string, fields: Record<string, unknown>): unknown {
  return { id, eTag: `"${id},1"`, fields };
}

function sources(): RetentionSources {
  return { booking: [], dispo: [], helper: [], einteilung: [], states: [] };
}

function state(key: string, data: unknown): NikolausStateRecord {
  return { id: 'state', etag: '"state,1"', key, data };
}

const JANUARY = new Date('2027-01-31T12:00:00Z');

test('a season-wide schedule includes all booking statuses and produces a complete compatible cleanup plan', () => {
  const data = sources();
  data.booking = ['Bestaetigt', 'Ausstehend', 'Storniert', 'Abgelaufen'].map((Status, index) =>
    row(`booking-${index}`, {
      SlotKey: `2026-12-0${index + 5}T17:00`,
      Status,
      Title: 'Private family name',
      Email: 'private@example.invalid',
    })
  );
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
  const plan = planNikolausRetention(
    data,
    {
      season: 2026,
      before: schedule.policies[0].before,
      responsibleRole: 'Automatischer Nikolaus-Löschlauf',
    },
    retentionDigest('test-target'),
    JANUARY
  );
  assert.equal(plan.operations.filter((operation) => operation.kind === 'booking').length, 4);
  assert.equal(JSON.stringify(schedule).includes('Private'), false);
  assert.equal(JSON.stringify(schedule).includes('private@example'), false);
});

test('the daily deadline changes at Berlin midnight, including the UTC day before it', () => {
  const data = sources();
  data.booking = [row('booking', { SlotKey: '2026-12-06T20:00' })];
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
  data.helper = [row('orphan-helper', { Verfuegbarkeit: '{"2026-01-31":["Nikolaus"]}' })];
  const policy = getNikolausRetentionSchedule(data, new Date('2026-02-28T00:00:00Z'))
    .duePolicies[0];
  assert.equal(policy.before, '2026-02-01');
  assert.equal(policy.deleteOn, '2026-02-28');
});

test('snapshot completion after New Year extends the original slot season using the Berlin visit date', () => {
  const data = sources();
  data.booking = [row('booking', { SlotKey: '2026-12-31T23:00' })];
  data.states = [
    state('planning:dispo:2026-12-31', {
      schema: 1,
      rows: [
        {
          bookingId: 'booking',
          date: '2026-12-31',
          plannedArrival: '23:00',
          visited: true,
          visitedAt: '2027-01-01T23:30:00Z',
        },
      ],
    }),
  ];
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

test('legacy completion times detect an overnight round without treating an early evening arrival as tomorrow', () => {
  const data = sources();
  data.booking = [row('booking', { SlotKey: '2026-12-31T20:00' })];
  data.dispo = [
    row('dispo', { Title: 'booking', Datum: '2026-12-31', Besucht: true, BesuchtUm: '00:15' }),
  ];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).policies[0].lastVisit, '2027-01-01');
  data.dispo = [
    row('dispo', { Title: 'booking', Datum: '2026-12-31', Besucht: true, BesuchtUm: '19:45' }),
  ];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).policies[0].lastVisit, '2026-12-31');
  data.dispo = [
    row('dispo', {
      Title: 'booking',
      Datum: '2026-12-31',
      Besucht: true,
      BesuchtUm: '2027-01-03T00:15:00+01:00',
    }),
  ];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).policies[0].lastVisit, '2027-01-03');
});

test('helper availability, legacy planning and empty durable plans prevent premature season cleanup', () => {
  const data = sources();
  data.booking = [row('booking', { SlotKey: '2026-12-06T17:00' })];
  data.helper = [row('helper', { Verfuegbarkeit: '{"2026-12-12":["Nikolaus"]}' })];
  data.einteilung = [row('einteilung', { Datum: '2026-12-15', HelferId: 'helper' })];
  data.states = [
    state('planning:dispo:2026-12-20', { schema: 1, rows: [] }),
    state('planning:einteilung', { schema: 1, rows: [{ personId: 'helper', date: '2026-12-22' }] }),
  ];
  const schedule = getNikolausRetentionSchedule(data, new Date('2027-01-21T23:00:00Z'));
  assert.equal(schedule.policies[0].lastVisit, '2026-12-22');
  assert.equal(schedule.policies[0].deleteOn, '2027-01-22');
  assert.equal(schedule.duePolicies.length, 1);
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2027-01-21T22:59:59Z')).duePolicies.length,
    0
  );
});

test('persisted metadata prevents a partial cleanup from moving the deadline earlier and does not trigger repeated empty-season cleanup', () => {
  const data = sources();
  data.booking = [
    row('early', { SlotKey: '2026-12-06T17:00' }),
    row('late', { SlotKey: '2026-12-20T17:00' }),
  ];
  const observed = getNikolausRetentionSchedule(data, JANUARY).policies[0];
  data.states = [state(retentionScheduleKey(2026), observed)];
  data.booking.splice(1, 1);
  const partial = getNikolausRetentionSchedule(data, new Date('2027-01-10T12:00:00Z'));
  assert.equal(partial.policies[0].deleteOn, '2027-01-20');
  assert.equal(partial.duePolicies.length, 0);
  const recomputed = getNikolausRetentionSchedule({ ...data, states: [] }, JANUARY).policies[0];
  assert.deepEqual(mergeRetentionSeasonPolicy(observed, recomputed), observed);
  data.booking = [];
  const cleared = getNikolausRetentionSchedule(data, JANUARY);
  assert.deepEqual(cleared.policies, [observed]);
  assert.deepEqual(cleared.dataSeasons, []);
  assert.deepEqual(cleared.duePolicies, []);
  data.booking = [row('inserted-later', { SlotKey: '2026-12-05T17:00' })];
  assert.equal(getNikolausRetentionSchedule(data, JANUARY).duePolicies.length, 1);
});

test('different seasons stay independent and unrelated malformed state data is ignored', () => {
  const data = sources();
  data.booking = [
    row('old', { SlotKey: '2025-12-06T17:00' }),
    row('new', { SlotKey: '2026-12-06T17:00' }),
  ];
  data.states = [
    state('geocoding:nominatim', { invalid: true }),
    state('mailquota:unrelated', null),
  ];
  const schedule = getNikolausRetentionSchedule(data, new Date('2026-10-02T12:00:00Z'));
  assert.deepEqual(schedule.dataSeasons, [2025, 2026]);
  assert.deepEqual(
    schedule.duePolicies.map((policy) => policy.season),
    [2025]
  );
});

test('invalid relevant dates, timestamps and saved deadlines stop automatic cleanup without including private source fields in errors', () => {
  const data = sources();
  data.booking = [row('booking', { SlotKey: '2026-02-30T17:00', Title: 'Private family' })];
  assert.throws(() => getNikolausRetentionSchedule(data, JANUARY), InvalidRetentionScheduleError);
  data.booking = [row('booking', { SlotKey: '2026-12-06T17:00' })];
  const observed = getNikolausRetentionSchedule(data, JANUARY).policies[0];
  assert.throws(
    () => mergeRetentionSeasonPolicy({ ...observed, deleteOn: '2027-01-01' }, observed),
    InvalidRetentionScheduleError
  );
  data.dispo = [
    row('dispo', { Title: 'booking', Datum: '2026-12-06', BesuchtUm: '2026-12-06T20:00:00' }),
  ];
  assert.throws(() => getNikolausRetentionSchedule(data, JANUARY), InvalidRetentionScheduleError);
  data.states = [state('retention:schedule:2026', { ...observed, before: '2027-12-31' })];
  data.dispo = [];
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
  data.helper = [row('helper', { Verfuegbarkeit: '{"2026-07-10":["Nikolaus"]}' })];
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2026-08-09T21:59:59.999Z')).duePolicies.length,
    0
  );
  assert.equal(
    getNikolausRetentionSchedule(data, new Date('2026-08-09T22:00:00.000Z')).duePolicies.length,
    1
  );
});

test('mutation-time completion policy keeps the original season across New Year and legacy midnight', () => {
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
  assert.equal(
    getDispoVisitRetentionPolicy({ ...visit, visitedAt: '00:15' })?.lastVisit,
    '2027-01-01'
  );
  assert.equal(getDispoVisitRetentionPolicy({ ...visit, visitedAt: '' }), undefined);
});

test('unclassified helper personal data is surfaced without inventing a deletion season', () => {
  const data = sources();
  data.helper = [
    row('helper', { Title: 'Private helper', Verfuegbarkeit: '{}', Bemerkungen: 'Private notes' }),
  ];
  const schedule = getNikolausRetentionSchedule(data, JANUARY);
  assert.deepEqual(schedule.unclassified, [
    { kind: 'helper', id: 'helper', reason: 'unclassified_availability' },
  ]);
  assert.deepEqual(schedule.policies, []);
  assert.deepEqual(schedule.dataSeasons, []);
  assert.deepEqual(schedule.duePolicies, []);
  assert.equal(JSON.stringify(schedule).includes('Private'), false);
});

test('a remaining move journal keeps its latest slot season eligible for crash recovery GC', () => {
  const data = sources();
  data.states.push(
    state('booking-move:original', {
      schema: 1,
      operationId: '0acf1a0e-d8b6-4ea4-866b-f2972304cc44',
      sourceId: 'original',
      sourceVersion: '"1"',
      sourceFingerprint: 'a'.repeat(64),
      sourceSlotKey: '2025-12-06T17:00',
      targetSlotKey: '2026-12-07T17:00',
      copyId: 'copy',
      phase: 'committed',
    })
  );
  const schedule = getNikolausRetentionSchedule(data, JANUARY);
  assert.deepEqual(schedule.dataSeasons, [2026]);
  assert.equal(schedule.duePolicies[0].lastVisit, '2026-12-07');
});
