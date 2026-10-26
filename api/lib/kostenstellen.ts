import { PlaywrightApiError } from './playwright-api';

/** Gemeinnützige Sphäre of a Kategorie, as CampFlow names them. */
export type KostenstellenSphaere = 'ideal' | 'purpose' | 'assets' | 'business';

const SPHERES: readonly KostenstellenSphaere[] = ['ideal', 'purpose', 'assets', 'business'];

/** Sums of a Kostenstelle or Kategorie in euro cents; expenses are negative. */
export interface KostenstellenSummen {
  incomeCent: number;
  expensesCent: number;
  balanceCent: number;
  /** Income not yet matched to a payment, e.g. unpaid Beiträge. */
  openIncomeCent: number;
  /** Expenses not yet matched to a payment, e.g. Auslagen not paid back yet; negative. */
  openExpensesCent: number;
  /** Receipts, Beiträge and other bookings. */
  bookings: number;
}

export interface KategorieStatistik extends KostenstellenSummen {
  /** null for a Kategorie with bookings that the Kostenstelle no longer lists. */
  id: string | null;
  /** "" for bookings without a Kategorie. */
  name: string;
  sphere: KostenstellenSphaere | null;
}

export interface KostenstelleStatistik extends KostenstellenSummen {
  /** null for a Kostenstelle with bookings that CampFlow no longer lists. */
  id: string | null;
  name: string;
  /** Hex colour from CampFlow, null if unknown. */
  color: string | null;
  archived: boolean;
  categories: KategorieStatistik[];
}

/** Leitendenbereich → Kostenstellen: the sums per Kostenstelle and Kategorie, read-only. */
export interface KostenstellenUebersicht {
  /** When CampFlow's report was exported (ISO 8601). */
  loadedAt: string;
  costUnits: KostenstelleStatistik[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalid(): never {
  throw new PlaywrightApiError(502, 'Invalid Kostenstellen-Summen');
}

/** Euros from the Playwright API to whole cents. */
function cent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return Math.round(value * 100);
}

function summen(value: Json): KostenstellenSummen {
  const bookings = value.bookings;
  if (typeof bookings !== 'number' || !Number.isInteger(bookings) || bookings < 0) invalid();
  const incomeCent = cent(value.income);
  const expensesCent = cent(value.expenses);
  return {
    incomeCent,
    expensesCent,
    // Recomputed, so the parts always add up on screen
    balanceCent: incomeCent + expensesCent,
    openIncomeCent: cent(value.openIncome),
    openExpensesCent: cent(value.openExpenses),
    bookings,
  };
}

const optionalId = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || !value) invalid();
  return value;
};

function readKategorie(value: unknown): KategorieStatistik {
  if (!isObject(value) || typeof value.name !== 'string') invalid();
  return {
    id: optionalId(value.id),
    name: value.name.trim(),
    sphere: SPHERES.find((sphere) => sphere === value.sphere) ?? null,
    ...summen(value),
  };
}

function readKostenstelle(value: unknown): KostenstelleStatistik {
  if (!isObject(value) || typeof value.name !== 'string' || !Array.isArray(value.categories))
    invalid();
  return {
    id: optionalId(value.id),
    name: value.name.trim(),
    color:
      typeof value.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.color) ? value.color : null,
    archived: value.archived === true,
    ...summen(value),
    categories: value.categories.map(readKategorie),
  };
}

/**
 * Checks the answer of the Playwright API (`GET /campflow/kostenstellen/summen`) and converts it
 * to cents. Open Kostenstellen come first, each group by name.
 */
export function readKostenstellenSummen(value: unknown): KostenstellenUebersicht {
  if (
    !isObject(value) ||
    typeof value.exportedAt !== 'string' ||
    Number.isNaN(Date.parse(value.exportedAt)) ||
    !Array.isArray(value.costUnits)
  )
    invalid();
  return {
    loadedAt: value.exportedAt,
    costUnits: value.costUnits
      .map(readKostenstelle)
      .sort(
        (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de')
      ),
  };
}
