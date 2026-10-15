import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentStep, type PaymentMode } from '../src/lib/sammelPaymentStep.ts';
import type { SammelPaymentView } from '../src/lib/types.ts';

function fixture(): SammelPaymentView {
  return {
    campaignArchived: false,
    creationEnabled: true,
    events: [],
    order: {
      id: 'order',
      etag: 'v1',
      campaignId: 'campaign',
      name: 'Familie Test',
      email: 'test@example.org',
      items: [],
      notes: '',
      status: 'Bestellt',
      submitted: true,
      paid: false,
      delivered: false,
      totalCents: 1200,
    },
    record: {
      version: 1,
      assignment: {
        person: { id: 'person', name: 'Test', emails: ['test@example.org'], matchesEmail: true },
        reason: '',
        confirmedBy: { id: 'staff', name: 'Test' },
        confirmedAt: '',
      },
      operation: null,
      dispatch: null,
      settlement: null,
    },
  };
}

test('archived, unsubmitted, zero and paid orders cannot start a contribution', () => {
  for (const change of [
    (view: SammelPaymentView) => {
      view.campaignArchived = true;
    },
    (view: SammelPaymentView) => {
      view.order.submitted = false;
    },
    (view: SammelPaymentView) => {
      view.order.totalCents = 0;
    },
    (view: SammelPaymentView) => {
      view.order.paid = true;
      view.record = null;
    },
  ]) {
    const view = fixture();
    change(view);
    assert.equal(paymentStep(view, 'inspect', false).unavailable, true);
  }
  // The freshly loaded campaign state takes priority over the page's older copy.
  assert.equal(paymentStep(fixture(), 'inspect', true).unavailable, false);
});

test('assignment eligibility differs from contribution creation for paid and cancelled orders', () => {
  const view = fixture();
  view.order.paid = true;
  const paid = paymentStep(view, 'inspect', false);
  assert.equal(paid.assignmentUnavailable, false);
  assert.equal(paid.adoptOnly, true);
  assert.equal(paid.next, 'adopt');
  assert.equal(paid.label, 'Beitrag zuordnen');
  view.order.status = 'Storniert';
  assert.equal(paymentStep(view, 'assign', false).assignmentUnavailable, true);
});

test('preparation requires a saved amount and an ordered status, preserving a zero amount', () => {
  const view = fixture();
  assert.equal(paymentStep(view, 'inspect', false).needsPreparation, false);
  view.order.totalCents = null;
  assert.equal(paymentStep(view, 'inspect', false).next, 'prepare');
  view.order.totalCents = 0;
  assert.equal(paymentStep(view, 'inspect', false).needsPreparation, false);
  view.order.status = 'Eingereicht';
  assert.equal(paymentStep(view, 'inspect', false).label, 'Bestellung vorbereiten');
});

test('an attempted, uncertain or created contribution never offers another creation', () => {
  const view = fixture();
  for (const state of ['prepared', 'attempted', 'uncertain', 'created'] as const) {
    view.record!.operation = {
      key: 'key',
      hash: 'hash',
      state,
      startedAt: '',
      attemptedAt: null,
      contribution: null,
      errorCategory: null,
      snapshot: {
        personId: 'person',
        amount: 1200,
        description: 'Test',
        orderId: 'order',
        campaignId: 'campaign',
        revision: 'v1',
      },
    };
    const step = paymentStep(view, 'inspect', false);
    assert.equal(step.assignmentUnavailable, true);
    assert.equal(step.needsPreparation, false);
    assert.equal(
      step.next,
      state === 'prepared' ? 'review' : state === 'created' ? 'close' : 'adopt'
    );
    assert.equal(
      step.label,
      state === 'prepared'
        ? 'Beitrag vorbereiten'
        : state === 'created'
          ? 'Fertig'
          : 'Beitrag zuordnen'
    );
  }
});

test('each mode keeps its submit and busy text; disabled creation leads to adoption', () => {
  const view = fixture();
  const labels: Record<PaymentMode, [string, string]> = {
    inspect: ['Beitrag vorbereiten', 'Zahlungsstand wird geladen …'],
    assign: ['Person bestätigen', 'Person wird gespeichert …'],
    review: ['Beitrag anlegen', 'Beitrag wird angelegt …'],
    adopt: ['Beitrag zuordnen', 'Zuordnung wird gespeichert …'],
    dispatch: ['Versand bestätigen', 'Bestätigung wird gespeichert …'],
  };
  for (const [mode, expected] of Object.entries(labels)) {
    const step = paymentStep(view, mode as PaymentMode, false);
    assert.deepEqual([step.label, step.busyLabel], expected);
  }
  view.creationEnabled = false;
  assert.equal(paymentStep(view, 'review', false).label, 'Beitrag zuordnen');
});
