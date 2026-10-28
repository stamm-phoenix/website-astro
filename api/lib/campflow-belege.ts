import { z } from 'zod';
import {
  dayOrNull,
  euroCent,
  idAndName,
  parseableTimestamp,
  readAnswer,
  textOrEmpty,
} from './campflow-schema';
import { getDb } from './db';
import { sameName } from './personen-model';

/**
 * Where a receipt stands in CampFlow: `unbooked` uploaded but not booked yet („Ungeprüfte
 * Belege“), `open` booked but not fully matched to a payment (an Auslage is not paid back yet),
 * `settled` booked and matched in full (paid, or paid back).
 */
export type CampflowBelegStatus = 'unbooked' | 'open' | 'settled';

const STATUSES = ['unbooked', 'open', 'settled'] as const satisfies readonly CampflowBelegStatus[];

/** A receipt as CampFlow's page „Belege“ lists it. */
export interface CampflowBeleg {
  /** The booking (`exp_…`), or for an unbooked receipt the receipt (`rcp_…`). */
  id: string;
  /** Belegnummer like `2026-94`, null until the receipt is booked. */
  number: string | null;
  status: CampflowBelegStatus;
  description: string;
  /** Belegdatum `YYYY-MM-DD`, null for an unbooked receipt. */
  date: string | null;
  /** Negative for expenses, positive for income, in euro cents. */
  amountCent: number;
  /** Part not yet matched to a payment, with the amount's sign. */
  openCent: number;
  /** „Auslage durch“: who paid out of pocket, null if nobody did. */
  paidBy: string | null;
  costUnits: { id: string; name: string }[];
  categories: { id: string; name: string; costUnitId: string | null }[];
  pages: number;
  /** File name in CampFlow, only for unbooked receipts, which have nothing else to tell them apart. */
  fileName: string | null;
  /** Upload time as CampFlow reports it, `YYYY-MM-DD HH:MM:SS`. */
  uploadedAt: string | null;
  /** When a `settled` receipt was paid or paid back, `YYYY-MM-DD`; null otherwise or if unknown. */
  settledAt: string | null;
  /** Transferred from the Belege module of this website. */
  viaWebsite: boolean;
  /** Transferred from the Belege module and submitted there by the user asking. */
  submittedByMe: boolean;
  /** „Auslage durch“ names the user asking. */
  mine: boolean;
}

export interface CampflowKostenstelle {
  id: string;
  name: string;
  archived: boolean;
  categories: { id: string; name: string }[];
}

/** Leitendenbereich → Belege → „In CampFlow“: a read-only copy of CampFlow's page „Belege“. */
export interface CampflowBelege {
  /** When the receipts were read from CampFlow (ISO 8601). */
  loadedAt: string;
  costUnits: CampflowKostenstelle[];
  belege: CampflowBeleg[];
}

/** A text without surrounding spaces; empty or no text is read as null. */
const trimmedOrNull = z
  .string()
  .transform((value) => value.trim() || null)
  .catch(null);

const kostenstelleSchema: z.ZodType<CampflowKostenstelle> = z.object({
  id: z.string(),
  name: textOrEmpty,
  archived: z.boolean().catch(false),
  categories: z.array(idAndName),
});

const belegSchema = z
  .object({
    id: z.string(),
    number: trimmedOrNull,
    status: z.enum(STATUSES),
    description: textOrEmpty,
    date: dayOrNull,
    amountEur: euroCent,
    openAmountEur: euroCent,
    paidBy: trimmedOrNull,
    costUnits: z.array(idAndName),
    categories: z.array(idAndName.extend({ costUnitId: z.string().nullable().catch(null) })),
    pages: z
      .number()
      .min(1)
      .transform((pages) => Math.floor(pages))
      .catch(1),
    originalFilename: trimmedOrNull,
    uploadedAt: trimmedOrNull,
    settledAt: dayOrNull,
  })
  .transform((beleg): Omit<CampflowBeleg, 'viaWebsite' | 'submittedByMe' | 'mine'> => ({
    id: beleg.id,
    number: beleg.number,
    status: beleg.status,
    description: beleg.description,
    date: beleg.date,
    amountCent: beleg.amountEur,
    openCent: beleg.openAmountEur,
    paidBy: beleg.paidBy,
    costUnits: beleg.costUnits,
    categories: beleg.categories,
    pages: beleg.pages,
    fileName: beleg.status === 'unbooked' ? beleg.originalFilename : null,
    uploadedAt: beleg.uploadedAt,
    settledAt: beleg.status === 'settled' ? beleg.settledAt : null,
  }));

const answerSchema = z.object({
  loadedAt: parseableTimestamp,
  receipts: z.array(belegSchema),
  costUnits: z.array(kostenstelleSchema),
});

/**
 * Checks the answer of the Playwright API (`GET /campflow/belege`) and marks the receipts this
 * website transferred, which of them `login` submitted, and the Auslagen of one of `ownNames`.
 */
export async function readCampflowBelege(
  value: unknown,
  login: string,
  ownNames: readonly string[] = []
): Promise<CampflowBelege> {
  const {
    loadedAt,
    receipts: belege,
    costUnits,
  } = readAnswer(answerSchema, value, 'Invalid CampFlow-Belege');

  const transfers = await getDb()
    .selectFrom('organisation.beleg_campflow')
    .select(['campflow_expense_id', 'submitted_by'])
    .where('state', '=', 'Hochgeladen')
    .execute();
  const submitters = new Map(
    transfers
      .filter((row) => row.campflow_expense_id)
      .map((row) => [row.campflow_expense_id!, row.submitted_by.toLowerCase()])
  );
  const me = login.toLowerCase();
  return {
    loadedAt,
    costUnits,
    belege: belege.map((beleg) => ({
      ...beleg,
      viaWebsite: submitters.has(beleg.id),
      submittedByMe: submitters.get(beleg.id) === me,
      mine: !!beleg.paidBy && ownNames.some((name) => sameName(name, beleg.paidBy!)),
    })),
  };
}
