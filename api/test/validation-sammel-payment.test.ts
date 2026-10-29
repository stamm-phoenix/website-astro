import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import { validateSammelPaymentInput } from '../lib/validation/sammel-payment';

const ETAG = '"1"';
const HASH = 'a'.repeat(64);
const EMPTY = {
  etag: ETAG,
  personId: '',
  reason: '',
  hash: '',
  feeId: '',
  reference: '',
  evidence: '',
};

function fields(body: unknown): Record<string, string> {
  try {
    validateSammelPaymentInput(body);
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const CONFIRM = 'Bitte die Aktion ausdrücklich bestätigen.';
const CHECK = 'Bitte die Angabe prüfen.';
const RELOAD = 'Bitte die Bestellung neu laden.';

test('every action returns exactly its explicit input, trimmed', () => {
  assert.deepEqual(validateSammelPaymentInput({ action: 'preview', etag: ` W/"v" ` }), {
    ...EMPTY,
    action: 'preview',
    etag: 'W/"v"',
  });
  assert.deepEqual(
    validateSammelPaymentInput({
      action: 'assign',
      etag: ETAG,
      personId: ' per_Anna1 ',
      reason: ' weil  so ',
      confirmed: true,
    }),
    { ...EMPTY, action: 'assign', personId: 'per_Anna1', reason: 'weil  so' }
  );
  assert.deepEqual(
    validateSammelPaymentInput({ action: 'create', etag: ETAG, hash: HASH, confirmed: true }),
    { ...EMPTY, action: 'create', hash: HASH }
  );
  assert.deepEqual(
    validateSammelPaymentInput({
      action: 'adopt',
      etag: ETAG,
      hash: HASH,
      feeId: 'fee_X1',
      reference: ' REF ',
      evidence: ' Beleg ',
      confirmed: true,
      executionEnded: true,
    }),
    { ...EMPTY, action: 'adopt', hash: HASH, feeId: 'fee_X1', reference: 'REF', evidence: 'Beleg' }
  );
  assert.deepEqual(
    validateSammelPaymentInput({
      action: 'dispatched',
      etag: ETAG,
      evidence: 'Mail',
      confirmed: true,
    }),
    { ...EMPTY, action: 'dispatched', evidence: 'Mail' }
  );
});

test('browser-supplied amounts and state are never part of the result', () => {
  const input = validateSammelPaymentInput({
    action: 'create',
    etag: ETAG,
    hash: HASH,
    confirmed: true,
    amountCents: 1,
    totalCents: 1,
    paid: true,
    status: 'Bezahlt',
    snapshot: {},
  });
  assert.deepEqual(Object.keys(input).sort(), [
    'action',
    'etag',
    'evidence',
    'feeId',
    'hash',
    'personId',
    'reason',
    'reference',
  ]);
});

test('an unknown action is refused, and a body that is no object too', () => {
  const action = 'Bitte eine gültige Zahlungsaktion wählen.';
  assert.deepEqual(fields({ action: 'refund', etag: ETAG, confirmed: true }), { form: action });
  assert.deepEqual(fields({ action: 5, etag: ETAG, confirmed: true }), { form: action });
  assert.deepEqual(fields({ etag: ETAG }), { form: action, confirmed: CONFIRM });
  for (const body of [null, [], 'text', undefined])
    assert.deepEqual(fields(body), { form: action, etag: RELOAD, confirmed: CONFIRM });
});

test('every action but the preview needs the explicit confirmation', () => {
  for (const [action, extra] of [
    ['assign', { personId: 'per_A' }],
    ['create', { hash: HASH }],
    ['dispatched', { evidence: 'x' }],
  ] as const)
    for (const confirmed of [undefined, false, 'true', 1, null])
      assert.deepEqual(fields({ action, etag: ETAG, ...extra, confirmed }), { confirmed: CONFIRM });
  assert.equal(validateSammelPaymentInput({ action: 'preview', etag: ETAG }).action, 'preview');
  assert.equal(
    validateSammelPaymentInput({ action: 'preview', etag: ETAG, confirmed: false }).action,
    'preview'
  );
});

test('the version must be a concrete quoted ETag', () => {
  for (const etag of ['*', '"', '""', 'W/', 'v1', '"a\nb"', '"a"x', undefined, null, 5, '   ', ''])
    assert.deepEqual(fields({ action: 'preview', etag }), { etag: RELOAD }, String(etag));
  assert.equal(fields({ action: 'preview', etag: `"${'x'.repeat(254)}"` }).etag, CHECK);
  assert.equal(validateSammelPaymentInput({ action: 'preview', etag: 'W/"1"' }).etag, 'W/"1"');
});

test('assign needs a CampFlow person', () => {
  const person = 'Bitte eine CampFlow-Person auswählen.';
  for (const personId of ['', 'not-a-person', 'per_', 'per_a-b', 'per_ A', undefined, 5])
    assert.deepEqual(
      fields({ action: 'assign', etag: ETAG, personId, confirmed: true }),
      { personId: person },
      String(personId)
    );
  // A well-formed ID that is far too long is only refused as a bad entry
  assert.deepEqual(
    fields({ action: 'assign', etag: ETAG, personId: `per_${'a'.repeat(255)}`, confirmed: true }),
    { personId: CHECK }
  );
  // Other actions only bound it
  assert.equal(
    validateSammelPaymentInput({
      action: 'create',
      etag: ETAG,
      hash: HASH,
      personId: 'frei',
      confirmed: true,
    }).personId,
    'frei'
  );
  assert.deepEqual(
    fields({ action: 'create', etag: ETAG, hash: HASH, personId: 5, confirmed: true }),
    { personId: CHECK }
  );
  assert.deepEqual(
    fields({
      action: 'create',
      etag: ETAG,
      hash: HASH,
      personId: 'x'.repeat(256),
      confirmed: true,
    }),
    { personId: CHECK }
  );
});

test('create and adopt need the hash of the previewed contribution', () => {
  const hash = 'Bitte den Beitrag erneut prüfen.';
  for (const action of ['create', 'adopt'])
    for (const value of [
      '',
      'a'.repeat(63),
      'A'.repeat(64),
      'g'.repeat(64),
      'a'.repeat(65),
      7,
      undefined,
    ])
      assert.equal(
        fields({
          action,
          etag: ETAG,
          hash: value,
          feeId: 'fee_1',
          reference: 'r',
          evidence: 'e',
          confirmed: true,
          executionEnded: true,
        }).hash,
        hash,
        `${action} ${String(value)}`
      );
  // Elsewhere it is only bounded
  assert.equal(
    validateSammelPaymentInput({
      action: 'assign',
      etag: ETAG,
      personId: 'per_A',
      hash: 'egal',
      confirmed: true,
    }).hash,
    'egal'
  );
  assert.deepEqual(
    fields({
      action: 'assign',
      etag: ETAG,
      personId: 'per_A',
      hash: 'x'.repeat(65),
      confirmed: true,
    }),
    { hash: CHECK }
  );
});

test('adopt needs the fee, a reference, evidence and the end of the old attempt', () => {
  const adopt = {
    action: 'adopt',
    etag: ETAG,
    hash: HASH,
    feeId: 'fee_1',
    reference: 'Ref',
    evidence: 'Beleg',
    confirmed: true,
    executionEnded: true,
  };
  assert.equal(validateSammelPaymentInput(adopt).feeId, 'fee_1');
  for (const feeId of ['', 'x_1', 'fee_', 'fee_a-b', undefined, 3])
    assert.deepEqual(fields({ ...adopt, feeId }), {
      feeId: 'Bitte die CampFlow-Beitrags-ID angeben.',
    });
  assert.deepEqual(fields({ ...adopt, feeId: `fee_${'a'.repeat(255)}` }), { feeId: CHECK });
  for (const [field, value] of [
    ['reference', ''],
    ['reference', ' '],
    ['reference', 'x'.repeat(101)],
    ['reference', 5],
    ['evidence', ''],
    ['evidence', 'x'.repeat(1001)],
  ] as const)
    assert.deepEqual(fields({ ...adopt, [field]: value }), { [field]: CHECK });
  for (const executionEnded of [undefined, false, 'true', 1])
    assert.deepEqual(fields({ ...adopt, executionEnded }), {
      executionEnded:
        'Bitte bestätigen, dass kein alter Erstellungsversuch mehr läuft und der vorhandene Beitrag geprüft wurde.',
    });
  // Nobody else asks for it
  assert.equal(
    validateSammelPaymentInput({ action: 'dispatched', etag: ETAG, evidence: 'x', confirmed: true })
      .action,
    'dispatched'
  );
});

test('dispatched needs evidence, and the free text fields are bounded', () => {
  assert.deepEqual(fields({ action: 'dispatched', etag: ETAG, evidence: ' ', confirmed: true }), {
    evidence: CHECK,
  });
  assert.deepEqual(
    fields({
      action: 'preview',
      etag: ETAG,
      reason: 'x'.repeat(1001),
      evidence: 'x'.repeat(1001),
      reference: 'x'.repeat(101),
    }),
    { reason: CHECK, evidence: CHECK, reference: CHECK }
  );
  assert.deepEqual(fields({ action: 'preview', etag: ETAG, reason: 5, evidence: {} }), {
    reason: CHECK,
    evidence: CHECK,
  });
  assert.equal(
    validateSammelPaymentInput({ action: 'preview', etag: ETAG, reason: undefined }).reason,
    ''
  );
  assert.deepEqual(fields({ action: 'preview', etag: ETAG, reason: null }), { reason: CHECK });
});

test('all faults of one request are reported together', () => {
  assert.deepEqual(fields({ action: 'adopt', etag: 'x' }), {
    etag: RELOAD,
    hash: 'Bitte den Beitrag erneut prüfen.',
    feeId: 'Bitte die CampFlow-Beitrags-ID angeben.',
    reference: CHECK,
    evidence: CHECK,
    confirmed: CONFIRM,
    executionEnded:
      'Bitte bestätigen, dass kein alter Erstellungsversuch mehr läuft und der vorhandene Beitrag geprüft wurde.',
  });
});
