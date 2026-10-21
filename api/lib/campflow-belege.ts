import { getDb } from './db';
import { PlaywrightApiError } from './playwright-api';

/**
 * Where a receipt stands in CampFlow: `unbooked` uploaded but not booked yet („Ungeprüfte
 * Belege“), `open` booked but not fully matched to a payment (an Auslage is not paid back yet),
 * `settled` booked and matched in full (paid, or paid back).
 */
export type CampflowBelegStatus = 'unbooked' | 'open' | 'settled';

const STATUSES: readonly CampflowBelegStatus[] = ['unbooked', 'open', 'settled'];

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
  /** Transferred from the Belege module of this website. */
  viaWebsite: boolean;
  /** Transferred from the Belege module and submitted there by the user asking. */
  submittedByMe: boolean;
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

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const day = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

function invalid(): never {
  throw new PlaywrightApiError(502, 'Invalid CampFlow-Belege');
}

/** Euros from the Playwright API to whole cents. */
function cent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return Math.round(value * 100);
}

function list<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid();
  return value.map(read);
}

function idName(value: unknown): { id: string; name: string } {
  if (!isObject(value) || typeof value.id !== 'string') invalid();
  return { id: value.id, name: text(value.name) };
}

function readKostenstelle(value: unknown): CampflowKostenstelle {
  if (!isObject(value)) invalid();
  return {
    ...idName(value),
    archived: value.archived === true,
    categories: list(value.categories, idName),
  };
}

function readBeleg(value: unknown): Omit<CampflowBeleg, 'viaWebsite' | 'submittedByMe'> {
  if (!isObject(value) || typeof value.id !== 'string') invalid();
  const status = STATUSES.find((candidate) => candidate === value.status) ?? invalid();
  return {
    id: value.id,
    number: optionalText(value.number),
    status,
    description: text(value.description),
    date: day(value.date),
    amountCent: cent(value.amountEur),
    openCent: cent(value.openAmountEur),
    paidBy: optionalText(value.paidBy),
    costUnits: list(value.costUnits, idName),
    categories: list(value.categories, (item) => {
      if (!isObject(item)) invalid();
      return {
        ...idName(item),
        costUnitId: typeof item.costUnitId === 'string' ? item.costUnitId : null,
      };
    }),
    pages: typeof value.pages === 'number' && value.pages >= 1 ? Math.floor(value.pages) : 1,
    fileName: status === 'unbooked' ? optionalText(value.originalFilename) : null,
    uploadedAt: optionalText(value.uploadedAt),
  };
}

/**
 * Checks the answer of the Playwright API (`GET /campflow/belege`) and marks the receipts this
 * website transferred, and which of them `login` submitted.
 */
export async function readCampflowBelege(value: unknown, login: string): Promise<CampflowBelege> {
  if (
    !isObject(value) ||
    typeof value.loadedAt !== 'string' ||
    Number.isNaN(Date.parse(value.loadedAt))
  )
    invalid();
  const belege = list(value.receipts, readBeleg);
  const costUnits = list(value.costUnits, readKostenstelle);

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
    loadedAt: value.loadedAt,
    costUnits,
    belege: belege.map((beleg) => ({
      ...beleg,
      viaWebsite: submitters.has(beleg.id),
      submittedByMe: submitters.get(beleg.id) === me,
    })),
  };
}
