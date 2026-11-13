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
import type { CampflowBelegStatus, CampflowBeleg } from './campflow-belege-model';
export type { CampflowBelegStatus, CampflowBeleg } from './campflow-belege-model';

const STATUSES = ['unbooked', 'open', 'settled'] as const satisfies readonly CampflowBelegStatus[];

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
