import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDispoSave, validateDispoVisit } from '../lib/validation/nikolaus-dispo';
import { ValidationError } from '../lib/validation/errors';
import { validateEinteilungSave } from '../lib/validation/nikolaus-einteilung';

function fields(action: () => unknown): Record<string, string> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const SLOTS = new Map([
  ['1', '2026-12-05T17:00'],
  ['2', '2026-12-05T17:15'],
]);
const TEAMS = ['A', 'B'];
const entry = (patch: Record<string, unknown> = {}) => ({
  bookingId: '1',
  team: 'A',
  order: 1,
  plannedArrival: '17:00',
  fixed: true,
  ...patch,
});
const dispo = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 'v1',
  entries,
  ...extra,
});
const save = (body: unknown) => validateDispoSave(body, TEAMS, SLOTS);

test('a Dispo is read with the slot of the booking and the loaded check-offs', () => {
  const body = dispo([entry(), entry({ bookingId: '2', team: 'B', order: 2, fixed: 'yes' })], {
    done: [
      { bookingId: '1', checkedOffAt: '2026-12-05T17:10:00Z', extra: 1 },
      { bookingId: 1, checkedOffAt: 'x' },
      null,
    ],
  });
  assert.deepEqual(save(body), {
    version: 'v1',
    entries: [
      {
        bookingId: '1',
        team: 'A',
        order: 1,
        slotKey: '2026-12-05T17:00',
        plannedArrival: '17:00',
        fixed: true,
      },
      {
        bookingId: '2',
        team: 'B',
        order: 2,
        slotKey: '2026-12-05T17:15',
        plannedArrival: '17:00',
        fixed: false,
      },
    ],
    done: [{ bookingId: '1', checkedOffAt: '2026-12-05T17:10:00Z' }],
  });
  assert.deepEqual(save({ entries: [] }), { version: '', entries: [], done: undefined });
  assert.equal(save(dispo([], { done: 'x' })).done, undefined);
  assert.deepEqual(save(dispo([], { done: [] })).done, []);
});

test('a Dispo without a valid list of entries is refused', () => {
  const invalid = { entries: 'Die Dispo ist ungültig.' };
  assert.deepEqual(
    fields(() => save(null)),
    invalid
  );
  assert.deepEqual(
    fields(() => save({ entries: 'x' })),
    invalid
  );
  const many = Array.from({ length: 201 }, () => entry());
  assert.deepEqual(
    fields(() => save(dispo(many))),
    invalid
  );
});

test('the rules of a Dispo entry report one message at the entries', () => {
  const message = (patch: Record<string, unknown>, more: unknown[] = []) =>
    fields(() => save(dispo([...more, entry(patch)])));
  assert.deepEqual(message({ bookingId: '9' }), {
    entries: 'Die Dispo enthält Termine, die nicht mehr bestätigt sind. Bitte neu laden.',
  });
  assert.deepEqual(message({ bookingId: 1 }), {
    entries: 'Die Dispo enthält Termine, die nicht mehr bestätigt sind. Bitte neu laden.',
  });
  assert.deepEqual(message({}, [entry()]), {
    entries: 'Ein Termin ist mehreren Teams zugeordnet.',
  });
  assert.deepEqual(message({ team: 'C' }), { entries: 'Team „C“ gibt es an diesem Tag nicht.' });
  assert.deepEqual(message({ team: 7 }), { entries: 'Team „“ gibt es an diesem Tag nicht.' });
  for (const order of [0, 201, 1.5, '1', null]) {
    assert.deepEqual(message({ order }), { entries: 'Die Reihenfolge ist ungültig.' });
  }
  assert.equal(save(dispo([entry({ order: 200 })])).entries[0].order, 200);
  for (const plannedArrival of ['7:00', '17:00:00', 1700, undefined]) {
    assert.deepEqual(message({ plannedArrival }), {
      entries: 'Die geplante Ankunft ist ungültig.',
    });
  }
  assert.deepEqual(message({}, ['x']), {
    entries: 'Die Dispo enthält Termine, die nicht mehr bestätigt sind. Bitte neu laden.',
  });
});

test('the last invalid entry of a Dispo names the problem', () => {
  assert.deepEqual(
    fields(() => save(dispo([entry({ team: 'C' }), entry({ bookingId: '2', order: 0 })]))),
    { entries: 'Die Reihenfolge ist ungültig.' }
  );
});

const VISIT = {
  bookingId: '12',
  visited: true,
  operationId: '123e4567-e89b-42d3-a456-426614174000',
  version: 'a'.repeat(64),
  slotKey: '2026-12-05T17:00',
};

test('a visit is read as sent', () => {
  assert.deepEqual(validateDispoVisit({ ...VISIT, extra: 1 }), VISIT);
  assert.equal(validateDispoVisit({ ...VISIT, visited: false }).visited, false);
});

test('a visit names what is invalid', () => {
  const invalid = { visit: 'Der Besuch ist ungültig.' };
  const reload = { visit: 'Bitte die Route neu laden, bevor Besuche gespeichert werden.' };
  for (const patch of [
    { bookingId: 12 },
    { bookingId: 'x' },
    { bookingId: '12345678901' },
    { visited: 'true' },
    { visited: undefined },
  ]) {
    assert.deepEqual(
      fields(() => validateDispoVisit({ ...VISIT, ...patch })),
      invalid
    );
  }
  for (const patch of [
    { operationId: 'nope' },
    { operationId: '123e4567-e89b-12d3-a456-426614174000' },
    { operationId: 1 },
    { version: 'abc' },
    { version: 'A'.repeat(64) },
    { slotKey: '2026-12-05' },
    { slotKey: undefined },
  ]) {
    assert.deepEqual(
      fields(() => validateDispoVisit({ ...VISIT, ...patch })),
      reload
    );
  }
  assert.deepEqual(
    fields(() => validateDispoVisit({ ...VISIT, bookingId: 'x', version: 'abc' })),
    invalid
  );
  assert.deepEqual(
    fields(() => validateDispoVisit(null)),
    invalid
  );
});

const PERSONS = new Set(['1', '2', '3']);
const BY_DATE = new Map([['2026-12-05', ['A', 'B']]]);
const post = (patch: Record<string, unknown> = {}) => ({
  personId: '1',
  date: '2026-12-05',
  team: 'A',
  role: 'Nikolaus',
  fixed: true,
  ...patch,
});
const einteilung = (assignments: unknown[]) => ({ version: 'v2', assignments });
const planFields = (body: unknown) => fields(() => validateEinteilungSave(body, BY_DATE, PERSONS));

test('an Einteilung is read with defaults for the optional parts', () => {
  const kitchen = (personId: string, fixed: unknown) =>
    post({ personId, team: 'Küche', role: 'Küche', fixed });
  const body = einteilung([
    post(),
    post({ personId: '3', team: 'B', role: 'Engerl' }),
    kitchen('2', 1),
    kitchen('4', false),
  ]);
  assert.deepEqual(validateEinteilungSave(body, BY_DATE, new Set(['1', '2', '3', '4'])), {
    version: 'v2',
    assignments: [
      post(),
      post({ personId: '3', team: 'B', role: 'Engerl' }),
      kitchen('2', false),
      kitchen('4', false),
    ],
  });
  assert.deepEqual(validateEinteilungSave({ assignments: [] }, BY_DATE, PERSONS), {
    version: '',
    assignments: [],
  });
});

test('an Einteilung reports the first broken rule at the assignments', () => {
  const invalid = { assignments: 'Die Einteilung ist ungültig.' };
  assert.deepEqual(planFields(null), invalid);
  assert.deepEqual(planFields({ assignments: {} }), invalid);
  assert.deepEqual(planFields(einteilung(Array.from({ length: 1001 }, () => post()))), invalid);
  const deleted = 'Die Einteilung enthält gelöschte Personen. Bitte neu laden.';
  assert.deepEqual(planFields(einteilung([post({ personId: '9' })])), { assignments: deleted });
  assert.deepEqual(planFields(einteilung([post({ personId: 1 })])), { assignments: deleted });
  assert.deepEqual(planFields(einteilung(['x'])), { assignments: deleted });
  assert.deepEqual(planFields(einteilung([post({ date: '2026-12-09' })])), {
    assignments: 'Die Einteilung enthält einen unbekannten Tag.',
  });
  const unknownPost = { assignments: 'Die Einteilung enthält einen unbekannten Posten.' };
  for (const patch of [
    { team: 'C' },
    { role: 'Küche' },
    { role: 'Koch' },
    { role: undefined },
    { team: 'Küche', role: 'Nikolaus' },
    { team: 'A', role: 'Küche' },
  ]) {
    assert.deepEqual(planFields(einteilung([post(patch)])), unknownPost);
  }
  assert.deepEqual(planFields(einteilung([post(), post({ team: 'B' })])), {
    assignments: 'Eine Person ist an einem Tag mehrfach eingeteilt.',
  });
  assert.deepEqual(planFields(einteilung([post(), post({ personId: '2' })])), {
    assignments: 'Ein Posten ist mehrfach besetzt.',
  });
  assert.deepEqual(planFields(einteilung([post({ personId: '9' }), post({ date: 'x' })])), {
    assignments: deleted,
  });
});
