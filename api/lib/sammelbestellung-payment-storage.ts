import { z } from 'zod';
import type {
  SammelPaymentEvent,
  SammelPaymentRecord,
  SammelPaymentOperation,
} from './sammelbestellung-payment-model';

/**
 * Stored payment records are read strictly: a corrupt or future record is rejected with the
 * message of the first broken field, instead of allowing another external write.
 */
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape, { error: 'Invalid object' });

function text(max = 2000, optional = false) {
  return z
    .string({ error: 'Invalid text' })
    .refine((value) => optional || value.trim() !== '', { error: 'Invalid text' })
    .refine((value) => value.length <= max, { error: 'Invalid text' });
}

const timestamp = text(40).refine((value) => Number.isFinite(Date.parse(value)), {
  error: 'Invalid timestamp',
});

function identifier(pattern: RegExp) {
  return text(255).refine((value) => pattern.test(value), { error: 'Invalid identifier' });
}

const PERSON_ID = /^per_[A-Za-z0-9]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;

const actorSchema = object({ id: text(255), name: text(255) });

const snapshotSchema = object({
  personId: identifier(PERSON_ID),
  amount: z
    .number({ error: 'Invalid amount' })
    .refine((amount) => Number.isSafeInteger(amount) && amount > 0 && amount <= 10_000_000, {
      error: 'Invalid amount',
    }),
  description: text(200),
  orderId: identifier(/^\d+$/),
  campaignId: identifier(/^\d+$/),
  revision: identifier(SHA256),
  attachedExpense: object({ costunitName: text(200), categoryName: text(200) }).optional(),
}).transform(({ attachedExpense, ...snapshot }) => ({
  ...snapshot,
  ...(attachedExpense ? { attachedExpense } : {}),
}));

const STATES = ['prepared', 'attempted', 'uncertain', 'created'] as const;

const operationSchema: z.ZodType<SammelPaymentOperation> = object({
  key: identifier(UUID),
  hash: identifier(SHA256),
  snapshot: snapshotSchema,
  state: z.enum(STATES, { error: 'Invalid state' }),
  startedAt: timestamp,
  attemptedAt: timestamp.nullable(),
  contribution: object({ id: identifier(/^fee_[A-Za-z0-9]+$/), reference: text(100) }).nullable(),
  errorCategory: text(100).nullable(),
}).superRefine((operation, context) => {
  const fail = (error: string) => context.addIssue({ code: 'custom', message: error });
  if ((operation.state === 'created') !== (operation.contribution !== null)) fail('Invalid result');
  else if (operation.state === 'prepared' && operation.attemptedAt !== null)
    fail('Invalid attempt');
  else if (
    (operation.state === 'attempted' || operation.state === 'uncertain') &&
    !operation.attemptedAt
  )
    fail('Missing attempt');
});

const personSchema = object({
  id: identifier(PERSON_ID),
  name: text(200),
  emails: z.array(text(254), { error: 'Invalid person' }).max(20, { error: 'Invalid person' }),
  matchesEmail: z.boolean({ error: 'Invalid person' }),
});

const recordSchema: z.ZodType<SammelPaymentRecord> = object({
  version: z.literal(1, { error: 'Unsupported payment schema' }),
  assignment: object({
    person: personSchema,
    reason: text(1000, true),
    confirmedBy: actorSchema,
    confirmedAt: timestamp,
  }),
  operation: operationSchema.nullable(),
  dispatch: object({
    method: z.literal('campflow_dashboard', { error: 'Invalid dispatch' }),
    confirmedAt: timestamp,
    actor: actorSchema,
  }).nullable(),
  settlement: object({
    source: z.literal('manual', { error: 'Invalid settlement' }),
    paid: z.boolean({ error: 'Invalid settlement' }),
    markedAt: timestamp,
    actor: actorSchema,
  }).nullable(),
}).superRefine((record, context) => {
  const fail = (error: string) => context.addIssue({ code: 'custom', message: error });
  if (record.operation && record.operation.snapshot.personId !== record.assignment.person.id)
    fail('Person changed');
  const created = record.operation?.state === 'created';
  if (record.dispatch && !created) fail('Invalid dispatch');
  if (record.settlement && !created) fail('Invalid settlement');
});

/** Throws a plain `Error` with the message of the first broken field. */
function readStored<S extends z.ZodType>(schema: S, value: unknown, message: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? message);
  return result.data;
}

/** Rejects corrupt or future records instead of allowing another external write. */
export function parseSammelPayment(value: unknown): SammelPaymentRecord {
  return readStored(recordSchema, value, 'Invalid payment record');
}

const eventSchema: z.ZodType<SammelPaymentEvent> = object({
  at: timestamp,
  actor: actorSchema,
  action: z.enum(
    [
      'assigned',
      'prepared',
      'attempted',
      'created',
      'uncertain',
      'adopted',
      'dispatched',
      'settled',
    ],
    { error: 'Invalid audit action' }
  ),
  operationKey: identifier(UUID).nullable(),
  evidence: text(1000, true),
});

/** Audit entries are kept in order and never silently dropped. */
export function parseSammelPaymentEvents(value: unknown): SammelPaymentEvent[] {
  return readStored(
    z.array(eventSchema, { error: 'Invalid audit history' }),
    value,
    'Invalid audit history'
  );
}
