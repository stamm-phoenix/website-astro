import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSammelPayment,
  parseSammelPaymentEvents,
} from '../lib/sammelbestellung-payment-storage';

const ACTOR = { id: 'user-1', name: 'Kim Kasse', extra: 1 };
const AT = '2026-10-19T12:00:00.000Z';
const KEY = '0f8fad5b-d9cb-469f-a165-70867728950e';
const HASH = 'a'.repeat(64);

const OPERATION = {
  key: KEY,
  hash: HASH,
  snapshot: {
    personId: 'per_Abc1',
    amount: 1250,
    description: 'Bestellung',
    orderId: '12',
    campaignId: '3',
    revision: 'b'.repeat(64),
  },
  state: 'prepared',
  startedAt: AT,
  attemptedAt: null,
  contribution: null,
  errorCategory: null,
};
const RECORD = {
  version: 1,
  assignment: {
    person: { id: 'per_Abc1', name: 'Kim', emails: ['kim@example.test'], matchesEmail: true },
    reason: '',
    confirmedBy: ACTOR,
    confirmedAt: AT,
  },
  operation: null,
  dispatch: null,
  settlement: null,
};
const CREATED = {
  ...OPERATION,
  state: 'created',
  attemptedAt: AT,
  contribution: { id: 'fee_Abc1', reference: 'AB1' },
};
const DISPATCH = { method: 'campflow_dashboard', confirmedAt: AT, actor: ACTOR };
const SETTLEMENT = { source: 'manual', paid: true, markedAt: AT, actor: ACTOR };
const withOperation = (operation: unknown) => ({ ...RECORD, operation });

/** The message of the error thrown for a corrupt record. */
function message(parse: (value: unknown) => unknown, value: unknown): string {
  try {
    parse(value);
  } catch (error) {
    assert.ok(error instanceof Error && error.constructor === Error);
    return error.message;
  }
  return assert.fail('Expected the record to be refused.');
}
const payment = (value: unknown) => message(parseSammelPayment, value);

const ACTOR_OUT = { id: 'user-1', name: 'Kim Kasse' };

test('a record without operation keeps only the known fields', () => {
  assert.deepEqual(parseSammelPayment({ ...RECORD, more: 1 }), {
    version: 1,
    assignment: {
      person: RECORD.assignment.person,
      reason: '',
      confirmedBy: ACTOR_OUT,
      confirmedAt: AT,
    },
    operation: null,
    dispatch: null,
    settlement: null,
  });
});

test('operations, dispatch and settlement are read in every state', () => {
  const read = parseSammelPayment({
    ...withOperation(CREATED),
    dispatch: DISPATCH,
    settlement: { ...SETTLEMENT, paid: false },
  });
  assert.deepEqual(read.operation, {
    ...CREATED,
    snapshot: { ...OPERATION.snapshot },
  });
  assert.deepEqual(read.dispatch, { ...DISPATCH, actor: ACTOR_OUT });
  assert.deepEqual(read.settlement, { ...SETTLEMENT, paid: false, actor: ACTOR_OUT });
  for (const [state, attemptedAt] of [
    ['prepared', null],
    ['attempted', AT],
    ['uncertain', AT],
  ])
    assert.equal(
      parseSammelPayment(
        withOperation({ ...OPERATION, state, attemptedAt, errorCategory: 'timeout' })
      ).operation?.state,
      state
    );
  const attached = { costunitName: 'Lager', categoryName: 'Fahrt', other: 1 };
  const snapshot = { ...OPERATION.snapshot, attachedExpense: attached };
  assert.deepEqual(
    parseSammelPayment(withOperation({ ...OPERATION, snapshot })).operation?.snapshot,
    {
      ...OPERATION.snapshot,
      attachedExpense: { costunitName: 'Lager', categoryName: 'Fahrt' },
    }
  );
  assert.equal(
    'attachedExpense' in parseSammelPayment(withOperation(OPERATION)).operation!.snapshot,
    false
  );
});

test('texts are checked for type, blank values and length but are not trimmed', () => {
  const person = (extra: object) => ({
    ...RECORD,
    assignment: { ...RECORD.assignment, person: { ...RECORD.assignment.person, ...extra } },
  });
  assert.equal(parseSammelPayment(person({ name: ' Kim ' })).assignment.person.name, ' Kim ');
  assert.equal(
    parseSammelPayment(person({ name: 'x'.repeat(200) })).assignment.person.name.length,
    200
  );
  for (const name of ['', '  ', 5, undefined, 'x'.repeat(201)])
    assert.equal(payment(person({ name })), 'Invalid text');
  const reason = (value: unknown) => ({
    ...RECORD,
    assignment: { ...RECORD.assignment, reason: value },
  });
  assert.equal(parseSammelPayment(reason('')).assignment.reason, '');
  assert.equal(parseSammelPayment(reason('  ')).assignment.reason, '  ');
  assert.equal(parseSammelPayment(reason('x'.repeat(1000))).assignment.reason.length, 1000);
  for (const value of [5, undefined, null, 'x'.repeat(1001)])
    assert.equal(payment(reason(value)), 'Invalid text');
  assert.equal(
    payment(person({ emails: Array.from({ length: 21 }, () => 'a@b.c') })),
    'Invalid person'
  );
  assert.equal(
    parseSammelPayment(person({ emails: Array.from({ length: 20 }, () => 'a@b.c') })).assignment
      .person.emails.length,
    20
  );
  for (const emails of [undefined, 'a@b.c', {}])
    assert.equal(payment(person({ emails })), 'Invalid person');
  for (const matchesEmail of [undefined, 'true', 1])
    assert.equal(payment(person({ matchesEmail })), 'Invalid person');
  assert.equal(payment(person({ emails: [5] })), 'Invalid text');
  assert.equal(payment(person({ emails: ['x'.repeat(255)] })), 'Invalid text');
});

test('identifiers, timestamps and objects are checked', () => {
  const at = (confirmedAt: unknown) => ({
    ...RECORD,
    assignment: { ...RECORD.assignment, confirmedAt },
  });
  assert.equal(parseSammelPayment(at('2026-10-19')).assignment.confirmedAt, '2026-10-19');
  assert.equal(payment(at('gestern')), 'Invalid timestamp');
  for (const value of [5, '', undefined, 'x'.repeat(41)])
    assert.equal(payment(at(value)), 'Invalid text');
  const person = (id: unknown) => ({
    ...RECORD,
    assignment: { ...RECORD.assignment, person: { ...RECORD.assignment.person, id } },
  });
  for (const id of ['abc', 'per_', 'per_a-b', 'xper_a', 'per_a\n'])
    assert.equal(payment(person(id)), 'Invalid identifier');
  assert.equal(payment(person(5)), 'Invalid text');
  for (const value of [null, [], 'x', 5, undefined]) {
    assert.equal(payment(value), 'Invalid object');
    assert.equal(payment({ ...RECORD, assignment: value }), 'Invalid object');
    assert.equal(
      payment({ ...RECORD, assignment: { ...RECORD.assignment, person: value } }),
      'Invalid object'
    );
    assert.equal(
      payment({ ...RECORD, assignment: { ...RECORD.assignment, confirmedBy: value } }),
      'Invalid object'
    );
  }
  for (const version of [2, '1', undefined])
    assert.equal(payment({ ...RECORD, version }), 'Unsupported payment schema');
});

test('an operation is checked field by field', () => {
  const op = (extra: object) => withOperation({ ...OPERATION, ...extra });
  const snapshot = (extra: object) => op({ snapshot: { ...OPERATION.snapshot, ...extra } });
  for (const key of ['x', KEY.toUpperCase(), `${KEY}0`])
    assert.equal(payment(op({ key })), 'Invalid identifier');
  for (const hash of ['a'.repeat(63), 'g'.repeat(64)])
    assert.equal(payment(op({ hash })), 'Invalid identifier');
  assert.equal(payment(snapshot({ orderId: 'a' })), 'Invalid identifier');
  assert.equal(payment(snapshot({ campaignId: '' })), 'Invalid text');
  assert.equal(payment(snapshot({ revision: 'abc' })), 'Invalid identifier');
  assert.equal(payment(snapshot({ description: '' })), 'Invalid text');
  assert.equal(payment(snapshot({ description: 'x'.repeat(201) })), 'Invalid text');
  assert.equal(payment(op({ snapshot: null })), 'Invalid object');
  assert.equal(payment(snapshot({ attachedExpense: null })), 'Invalid object');
  assert.equal(payment(snapshot({ attachedExpense: { costunitName: 'x' } })), 'Invalid text');
  for (const amount of [0, -1, 10_000_001, 1.5, '5', undefined, Number.NaN, 2 ** 53])
    assert.equal(payment(snapshot({ amount })), 'Invalid amount');
  assert.equal(
    parseSammelPayment(snapshot({ amount: 10_000_000 })).operation?.snapshot.amount,
    10_000_000
  );
  assert.equal(parseSammelPayment(snapshot({ amount: 1 })).operation?.snapshot.amount, 1);
  for (const state of ['done', 5, undefined]) assert.equal(payment(op({ state })), 'Invalid state');
  assert.equal(payment(op({ startedAt: 'x' })), 'Invalid timestamp');
  assert.equal(payment(op({ errorCategory: 5 })), 'Invalid text');
  assert.equal(payment(op({ errorCategory: undefined })), 'Invalid text');
  assert.equal(payment(op({ errorCategory: 'x'.repeat(101) })), 'Invalid text');
  assert.equal(payment(op({ attemptedAt: undefined })), 'Invalid text');
  assert.equal(payment(op({ contribution: undefined })), 'Invalid object');
});

test('the state of an operation has to fit its attempt and result', () => {
  const op = (extra: object) => withOperation({ ...OPERATION, ...extra });
  assert.equal(payment(op({ state: 'created' })), 'Invalid result');
  assert.equal(payment(op({ contribution: CREATED.contribution })), 'Invalid result');
  assert.equal(payment(op({ attemptedAt: AT })), 'Invalid attempt');
  assert.equal(payment(op({ state: 'attempted' })), 'Missing attempt');
  assert.equal(payment(op({ state: 'uncertain' })), 'Missing attempt');
  assert.equal(
    parseSammelPayment(op({ ...CREATED, attemptedAt: null })).operation?.state,
    'created'
  );
  assert.equal(
    payment(op({ ...CREATED, contribution: { id: 'x', reference: 'r' } })),
    'Invalid identifier'
  );
  assert.equal(
    payment(op({ ...CREATED, contribution: { id: 'fee_1', reference: '' } })),
    'Invalid text'
  );
  assert.equal(
    payment(op({ ...CREATED, contribution: { id: 'fee_1', reference: 'x'.repeat(101) } })),
    'Invalid text'
  );
  assert.equal(payment(op({ ...CREATED, contribution: [] })), 'Invalid object');
});

test('dispatch and settlement need a created operation and the right source', () => {
  assert.equal(payment({ ...RECORD, dispatch: DISPATCH }), 'Invalid dispatch');
  assert.equal(payment({ ...withOperation(OPERATION), dispatch: DISPATCH }), 'Invalid dispatch');
  assert.equal(
    payment({ ...withOperation(CREATED), dispatch: { ...DISPATCH, method: 'x' } }),
    'Invalid dispatch'
  );
  assert.equal(payment({ ...RECORD, settlement: SETTLEMENT }), 'Invalid settlement');
  assert.equal(
    payment({ ...withOperation(OPERATION), settlement: SETTLEMENT }),
    'Invalid settlement'
  );
  assert.equal(
    payment({ ...withOperation(CREATED), settlement: { ...SETTLEMENT, source: 'auto' } }),
    'Invalid settlement'
  );
  assert.equal(
    payment({ ...withOperation(CREATED), settlement: { ...SETTLEMENT, paid: 'yes' } }),
    'Invalid settlement'
  );
  assert.equal(
    payment({ ...withOperation(CREATED), settlement: { ...SETTLEMENT, markedAt: 'x' } }),
    'Invalid timestamp'
  );
  assert.equal(
    payment({ ...withOperation(CREATED), dispatch: { ...DISPATCH, actor: null } }),
    'Invalid object'
  );
  for (const field of ['dispatch', 'settlement'])
    assert.equal(payment({ ...withOperation(CREATED), [field]: undefined }), 'Invalid object');
  assert.equal(payment({ ...RECORD, operation: undefined }), 'Invalid object');
  assert.equal(
    payment({
      ...RECORD,
      operation: { ...OPERATION, snapshot: { ...OPERATION.snapshot, personId: 'per_Other' } },
    }),
    'Person changed'
  );
});

const EVENT = { at: AT, actor: ACTOR, action: 'created', operationKey: KEY, evidence: 'fee_1' };

test('audit entries are kept in order and read completely', () => {
  const actions = [
    'assigned',
    'prepared',
    'attempted',
    'created',
    'uncertain',
    'adopted',
    'dispatched',
    'settled',
  ];
  const read = parseSammelPaymentEvents([
    { ...EVENT, action: 'prepared', extra: 1 },
    { ...EVENT, operationKey: null, evidence: '' },
    ...actions.map((action) => ({ ...EVENT, action })),
  ]);
  assert.deepEqual(read.slice(0, 2), [
    { at: AT, actor: ACTOR_OUT, action: 'prepared', operationKey: KEY, evidence: 'fee_1' },
    { at: AT, actor: ACTOR_OUT, action: 'created', operationKey: null, evidence: '' },
  ]);
  assert.deepEqual(
    read.slice(2).map((entry) => entry.action),
    actions
  );
  assert.deepEqual(parseSammelPaymentEvents([]), []);
});

test('one corrupt audit entry refuses the whole history', () => {
  const events = (value: unknown) => message(parseSammelPaymentEvents, value);
  for (const value of [undefined, null, {}, 'x'])
    assert.equal(events(value), 'Invalid audit history');
  for (const entry of [null, [], 'x']) assert.equal(events([EVENT, entry]), 'Invalid object');
  for (const action of ['sent', 5, undefined])
    assert.equal(events([{ ...EVENT, action }]), 'Invalid audit action');
  assert.equal(events([{ ...EVENT, at: 'x' }]), 'Invalid timestamp');
  assert.equal(events([{ ...EVENT, actor: { id: 'u' } }]), 'Invalid text');
  assert.equal(events([{ ...EVENT, operationKey: 'abc' }]), 'Invalid identifier');
  assert.equal(events([{ ...EVENT, operationKey: undefined }]), 'Invalid text');
  assert.equal(events([{ ...EVENT, evidence: 'x'.repeat(1001) }]), 'Invalid text');
  assert.equal(events([{ ...EVENT, evidence: undefined }]), 'Invalid text');
});
