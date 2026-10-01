import type {
  SammelPaymentActor,
  SammelPaymentEvent,
  SammelPaymentRecord,
  SammelPaymentOperation,
} from './sammelbestellung-payment-model';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2000, optional = false): string {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max)
    throw new Error('Invalid text');
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid timestamp');
  return result;
}
function identifier(value: unknown, pattern: RegExp): string {
  const result = text(value, 255);
  if (!pattern.test(result)) throw new Error('Invalid identifier');
  return result;
}
function actor(value: unknown): SammelPaymentActor {
  const row = record(value);
  return { id: text(row.id, 255), name: text(row.name, 255) };
}
function operation(value: unknown): SammelPaymentOperation {
  const row = record(value);
  const snapshot = record(row.snapshot);
  const expense =
    snapshot.attachedExpense === undefined ? undefined : record(snapshot.attachedExpense);
  if (
    !Number.isSafeInteger(snapshot.amount) ||
    Number(snapshot.amount) <= 0 ||
    Number(snapshot.amount) > 10_000_000
  )
    throw new Error('Invalid amount');
  if (!['prepared', 'attempted', 'uncertain', 'created'].includes(String(row.state)))
    throw new Error('Invalid state');
  const contribution = row.contribution === null ? null : record(row.contribution);
  if ((row.state === 'created') !== (contribution !== null)) throw new Error('Invalid result');
  const attemptedAt = row.attemptedAt === null ? null : timestamp(row.attemptedAt);
  if (row.state === 'prepared' && attemptedAt !== null) throw new Error('Invalid attempt');
  if (['attempted', 'uncertain'].includes(String(row.state)) && !attemptedAt)
    throw new Error('Missing attempt');
  return {
    key: identifier(row.key, /^[a-f0-9-]{36}$/),
    hash: identifier(row.hash, /^[a-f0-9]{64}$/),
    snapshot: {
      personId: identifier(snapshot.personId, /^per_[A-Za-z0-9]+$/),
      amount: Number(snapshot.amount),
      description: text(snapshot.description, 200),
      orderId: identifier(snapshot.orderId, /^\d+$/),
      campaignId: identifier(snapshot.campaignId, /^\d+$/),
      revision: identifier(snapshot.revision, /^[a-f0-9]{64}$/),
      ...(expense
        ? {
            attachedExpense: {
              costunitName: text(expense.costunitName, 200),
              categoryName: text(expense.categoryName, 200),
            },
          }
        : {}),
    },
    state: row.state as SammelPaymentOperation['state'],
    startedAt: timestamp(row.startedAt),
    attemptedAt,
    contribution: contribution
      ? {
          id: identifier(contribution.id, /^fee_[A-Za-z0-9]+$/),
          reference: text(contribution.reference, 100),
        }
      : null,
    errorCategory: row.errorCategory === null ? null : text(row.errorCategory, 100),
  };
}

/** Rejects corrupt or future records instead of allowing another external write. */
export function parseSammelPayment(value: unknown): SammelPaymentRecord {
  const row = record(value);
  if (row.version !== 1) throw new Error('Unsupported payment schema');
  const assignment = record(row.assignment);
  const selected = record(assignment.person);
  if (
    !Array.isArray(selected.emails) ||
    selected.emails.length > 20 ||
    typeof selected.matchesEmail !== 'boolean'
  )
    throw new Error('Invalid person');
  const person = {
    id: identifier(selected.id, /^per_[A-Za-z0-9]+$/),
    name: text(selected.name, 200),
    emails: selected.emails.map((value) => text(value, 254)),
    matchesEmail: selected.matchesEmail,
  };
  const op = row.operation === null ? null : operation(row.operation);
  if (op && op.snapshot.personId !== person.id) throw new Error('Person changed');
  const dispatch = row.dispatch === null ? null : record(row.dispatch);
  const settlement = row.settlement === null ? null : record(row.settlement);
  if (dispatch && (dispatch.method !== 'campflow_dashboard' || op?.state !== 'created'))
    throw new Error('Invalid dispatch');
  if (
    settlement &&
    (settlement.source !== 'manual' ||
      typeof settlement.paid !== 'boolean' ||
      op?.state !== 'created')
  )
    throw new Error('Invalid settlement');
  return {
    version: 1,
    assignment: {
      person,
      reason: text(assignment.reason, 1000, true),
      confirmedBy: actor(assignment.confirmedBy),
      confirmedAt: timestamp(assignment.confirmedAt),
    },
    operation: op,
    dispatch: dispatch
      ? {
          method: 'campflow_dashboard',
          confirmedAt: timestamp(dispatch.confirmedAt),
          actor: actor(dispatch.actor),
        }
      : null,
    settlement: settlement
      ? {
          source: 'manual',
          paid: settlement.paid === true,
          markedAt: timestamp(settlement.markedAt),
          actor: actor(settlement.actor),
        }
      : null,
  };
}

/** Audit entries are kept in order and never silently dropped. */
export function parseSammelPaymentEvents(value: unknown): SammelPaymentEvent[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid audit history');
  return value.map((value) => {
    const row = record(value);
    if (
      ![
        'assigned',
        'prepared',
        'attempted',
        'created',
        'uncertain',
        'adopted',
        'dispatched',
        'settled',
      ].includes(String(row.action))
    )
      throw new Error('Invalid audit action');
    return {
      at: timestamp(row.at),
      actor: actor(row.actor),
      action: row.action as SammelPaymentEvent['action'],
      operationKey:
        row.operationKey === null ? null : identifier(row.operationKey, /^[a-f0-9-]{36}$/),
      evidence: text(row.evidence, 1000, true),
    };
  });
}
