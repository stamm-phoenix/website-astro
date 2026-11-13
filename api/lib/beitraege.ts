import { z } from 'zod';
import {
  dayOrNull,
  euroCent,
  parseableTimestamp,
  readAnswer,
  textOrEmpty,
  wholeNumber,
} from './campflow-schema';
import type {
  BeitragStatus,
  BeitragSammlung,
  Beitrag,
  Beitraege,
  AktionBeitrag,
  AktionBeitraege,
} from './beitraege-model';
export type {
  BeitragStatus,
  BeitragSammlung,
  Beitrag,
  Beitraege,
  AktionBeitrag,
  AktionBeitraege,
} from './beitraege-model';

const STATUSES = [
  'paid',
  'unpaid',
  'partial',
  'refund',
  'cancelled',
] as const satisfies readonly BeitragStatus[];

/** Fails with the 502 of a Beiträge answer the page cannot show. */
const INVALID = 'Invalid Beiträge';

const optionalText = z.string().min(1).nullable().catch(null);

/** A link to another record; absent or null is read as null. */
const reference = z
  .object({ id: z.string(), name: z.string() })
  .nullish()
  .transform((value) => value ?? null);

const sammlungSchema: z.ZodType<BeitragSammlung> = z
  .object({
    id: z.string(),
    name: textOrEmpty,
    type: textOrEmpty,
    eventId: optionalText,
    feeCount: wholeNumber,
    settledCount: wholeNumber,
    totalAmount: euroCent,
    openAmount: euroCent,
    refundAmount: euroCent,
  })
  .transform((sammlung) => ({
    id: sammlung.id,
    name: sammlung.name,
    type: sammlung.type,
    eventId: sammlung.eventId,
    feeCount: sammlung.feeCount,
    settledCount: sammlung.settledCount,
    totalCent: sammlung.totalAmount,
    openCent: sammlung.openAmount,
    refundCent: sammlung.refundAmount,
  }));

const aktionBeitragShape = {
  id: z.string(),
  reference: textOrEmpty,
  description: textOrEmpty,
  amount: euroCent,
  dueAmount: euroCent,
  paidAmount: euroCent,
  openAmount: euroCent,
  status: z.enum(STATUSES),
};

function toAktionBeitrag(fee: z.output<z.ZodObject<typeof aktionBeitragShape>>): AktionBeitrag {
  return {
    id: fee.id,
    reference: fee.reference,
    description: fee.description,
    amountCent: fee.amount,
    dueCent: fee.dueAmount,
    paidCent: fee.paidAmount,
    openCent: fee.openAmount,
    status: fee.status,
  };
}

const aktionBeitragSchema: z.ZodType<AktionBeitrag> = z
  .object(aktionBeitragShape)
  .transform(toAktionBeitrag);

const beitragSchema: z.ZodType<Beitrag> = z
  .object({
    ...aktionBeitragShape,
    batch: reference,
    costUnit: reference,
    category: reference,
    payer: textOrEmpty,
    payerId: optionalText,
    paymentMethod: optionalText,
    date: dayOrNull,
    paidAt: dayOrNull,
  })
  .transform((fee) => ({
    ...toAktionBeitrag(fee),
    batchId: fee.batch?.id ?? null,
    costUnit: fee.costUnit,
    category: fee.category?.name ?? null,
    payer: fee.payer,
    payerId: fee.payerId,
    paymentMethod: fee.paymentMethod,
    date: fee.date ?? '',
    paidAt: fee.paidAt,
  }));

const beitraegeSchema: z.ZodType<Beitraege> = z.object({
  loadedAt: parseableTimestamp,
  batches: z.array(sammlungSchema),
  fees: z.array(beitragSchema),
});

/** Checks the answer of the Playwright API and keeps only what the page shows. */
export function readBeitraege(value: unknown): Beitraege {
  return readAnswer(beitraegeSchema, value, INVALID);
}

/** Whether something is left to do for a Beitrag: to be paid, or paid too much and to pay back. */
export function istOffen(fee: Pick<Beitrag, 'status'>): boolean {
  return fee.status === 'unpaid' || fee.status === 'partial' || fee.status === 'refund';
}

/** Only the Beiträge with something left to do, and the Sammlungen they belong to. */
export function offeneBeitraege(beitraege: Beitraege): Beitraege {
  const fees = beitraege.fees.filter(istOffen);
  const batchIds = new Set(fees.map((fee) => fee.batchId));
  return {
    loadedAt: beitraege.loadedAt,
    batches: beitraege.batches.filter((batch) => batchIds.has(batch.id)),
    fees,
  };
}

/** CampFlow's person IDs; anything else would not match a participant (or be `__proto__`). */
const PERSON_ID = /^per_[A-Za-z0-9]+$/;

const aktionBeitraegeSchema: z.ZodType<AktionBeitraege> = z.object({
  eventId: z.string(),
  loadedAt: parseableTimestamp,
  persons: z
    .array(z.object({ id: z.string().regex(PERSON_ID), fees: z.array(aktionBeitragSchema) }))
    .transform((persons) => {
      const byPerson: Record<string, AktionBeitrag[]> = {};
      for (const { id, fees } of persons) byPerson[id] = [...(byPerson[id] ?? []), ...fees];
      return byPerson;
    }),
});

/**
 * Checks the answer of the Playwright API for the participants of an Aktion and keeps only the
 * Beiträge per person.
 */
export function readAktionBeitraege(value: unknown): AktionBeitraege {
  return readAnswer(aktionBeitraegeSchema, value, INVALID);
}
