import { PlaywrightApiError } from './playwright-api';

/** Where a Beitrag stands, as CampFlow shows it (see the Playwright API's README). */
export type BeitragStatus = 'paid' | 'unpaid' | 'partial' | 'refund' | 'cancelled';

const STATUSES: readonly BeitragStatus[] = ['paid', 'unpaid', 'partial', 'refund', 'cancelled'];

/** A Sammlung of CampFlow's Beiträge: the fees of an event, a Mitgliedsbeitrag or others. */
export interface BeitragSammlung {
  id: string;
  name: string;
  /** `event`, `annuity` (Mitgliedsbeitrag) or `manual`. */
  type: string;
  feeCount: number;
  /** Paid in full or cancelled. */
  settledCount: number;
  totalCent: number;
  /** Still to be paid. */
  openCent: number;
  /** Paid too much, to be paid back. */
  refundCent: number;
}

/** One fee: who has to pay how much for what, and what was paid. */
export interface Beitrag {
  id: string;
  /** Verwendungszweck of the transfer. */
  reference: string;
  description: string;
  batchId: string | null;
  costUnit: { id: string; name: string } | null;
  category: string | null;
  payer: string;
  /** CampFlow's name of the payment method, e.g. `bank_transfer`; null if unknown. */
  paymentMethod: string | null;
  /** Day the fee was created, `YYYY-MM-DD`. */
  date: string;
  /** As CampFlow's list shows it; for a cancelled fee the amount cancelled. */
  amountCent: number;
  dueCent: number;
  paidCent: number;
  /** Negative when paid too much. */
  openCent: number;
  status: BeitragStatus;
  /** Day of the latest payment, `YYYY-MM-DD`; null if none. */
  paidAt: string | null;
}

/** Leitendenbereich → Beiträge: a read-only copy of CampFlow's page „Beiträge“. */
export interface Beitraege {
  /** When the Beiträge were read from CampFlow (ISO 8601). */
  loadedAt: string;
  batches: BeitragSammlung[];
  fees: Beitrag[];
}

/**
 * A Beitrag of a participant, as CampFlow's page of the Aktion shows it next to the person. It
 * comes without payer and payment date, which that list does not have.
 */
export interface AktionBeitrag {
  id: string;
  /** Verwendungszweck of the transfer. */
  reference: string;
  description: string;
  /** As CampFlow's list shows it; for a cancelled fee the amount cancelled. */
  amountCent: number;
  dueCent: number;
  paidCent: number;
  /** Negative when paid too much. */
  openCent: number;
  status: BeitragStatus;
}

/** Leitendenbereich → Aktionen → Teilnehmende: the Beiträge of every person of an Aktion. */
export interface AktionBeitraege {
  /** The CampFlow event (`evt_…`) the Beiträge belong to. */
  eventId: string;
  /** When the Beiträge were read from CampFlow (ISO 8601). */
  loadedAt: string;
  /** Beiträge per CampFlow person ID (`per_…`); a person without Beitrag has an empty list. */
  persons: Record<string, AktionBeitrag[]>;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;
const day = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

function invalid(): never {
  throw new PlaywrightApiError(502, 'Invalid Beiträge');
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid();
  return value;
}

/** Euros from the Playwright API to whole cents. */
function cent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return Math.round(value * 100);
}

function reference(value: unknown): { id: string; name: string } | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.name !== 'string') invalid();
  return { id: value.id, name: value.name };
}

function readSammlung(value: unknown): BeitragSammlung {
  if (!isObject(value) || typeof value.id !== 'string') invalid();
  return {
    id: value.id,
    name: text(value.name),
    type: text(value.type),
    feeCount: count(value.feeCount),
    settledCount: count(value.settledCount),
    totalCent: cent(value.totalAmount),
    openCent: cent(value.openAmount),
    refundCent: cent(value.refundAmount),
  };
}

function readAktionBeitrag(value: unknown): AktionBeitrag {
  if (!isObject(value) || typeof value.id !== 'string') invalid();
  return {
    id: value.id,
    reference: text(value.reference),
    description: text(value.description),
    amountCent: cent(value.amount),
    dueCent: cent(value.dueAmount),
    paidCent: cent(value.paidAmount),
    openCent: cent(value.openAmount),
    status: STATUSES.find((candidate) => candidate === value.status) ?? invalid(),
  };
}

function readBeitrag(value: unknown): Beitrag {
  if (!isObject(value)) invalid();
  return {
    ...readAktionBeitrag(value),
    batchId: reference(value.batch)?.id ?? null,
    costUnit: reference(value.costUnit),
    category: reference(value.category)?.name ?? null,
    payer: text(value.payer),
    paymentMethod: optionalText(value.paymentMethod),
    date: day(value.date) ?? '',
    paidAt: day(value.paidAt),
  };
}

/** Checks the answer of the Playwright API and keeps only what the page shows. */
export function readBeitraege(value: unknown): Beitraege {
  if (
    !isObject(value) ||
    typeof value.loadedAt !== 'string' ||
    Number.isNaN(Date.parse(value.loadedAt)) ||
    !Array.isArray(value.batches) ||
    !Array.isArray(value.fees)
  )
    invalid();
  return {
    loadedAt: value.loadedAt,
    batches: value.batches.map(readSammlung),
    fees: value.fees.map(readBeitrag),
  };
}

/** CampFlow's person IDs; anything else would not match a participant (or be `__proto__`). */
const PERSON_ID = /^per_[A-Za-z0-9]+$/;

/**
 * Checks the answer of the Playwright API for the participants of an Aktion and keeps only the
 * Beiträge per person.
 */
export function readAktionBeitraege(value: unknown): AktionBeitraege {
  if (
    !isObject(value) ||
    typeof value.eventId !== 'string' ||
    typeof value.loadedAt !== 'string' ||
    Number.isNaN(Date.parse(value.loadedAt)) ||
    !Array.isArray(value.persons)
  )
    invalid();
  const persons: Record<string, AktionBeitrag[]> = {};
  for (const person of value.persons) {
    if (!isObject(person) || typeof person.id !== 'string' || !PERSON_ID.test(person.id)) invalid();
    if (!Array.isArray(person.fees)) invalid();
    persons[person.id] = [...(persons[person.id] ?? []), ...person.fees.map(readAktionBeitrag)];
  }
  return { eventId: value.eventId, loadedAt: value.loadedAt, persons };
}
