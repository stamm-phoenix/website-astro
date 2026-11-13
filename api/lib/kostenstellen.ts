import { z } from 'zod';
import { euroCent, parseableTimestamp, readAnswer, wholeNumber } from './campflow-schema';
import { CAMPFLOW_SPHERES } from './kostenstellen-model';
import type {
  KostenstellenSummen,
  JahresSummen,
  KategorieStatistik,
  KostenstelleStatistik,
} from './kostenstellen-model';
export type {
  KostenstellenSphaere,
  KostenstellenSummen,
  JahresSummen,
  KategorieStatistik,
  KostenstelleStatistik,
} from './kostenstellen-model';

/** Leitendenbereich → Kostenstellen: the sums per Kostenstelle and Kategorie, read-only. */
export interface KostenstellenUebersicht {
  /** When CampFlow's report was exported (ISO 8601). */
  loadedAt: string;
  costUnits: KostenstelleStatistik[];
}

/** Missing years or sums per year are refused: shown as 0 they would look like real figures. */
const yearSchema = z.number().refine(Number.isInteger).min(1900).max(9999);

const summenShape = {
  income: euroCent,
  expenses: euroCent,
  openIncome: euroCent,
  openExpenses: euroCent,
  bookings: wholeNumber,
};

function toSummen(sums: z.output<z.ZodObject<typeof summenShape>>): KostenstellenSummen {
  return {
    incomeCent: sums.income,
    expensesCent: sums.expenses,
    // Recomputed, so the parts always add up on screen
    balanceCent: sums.income + sums.expenses,
    openIncomeCent: sums.openIncome,
    openExpensesCent: sums.openExpenses,
    bookings: sums.bookings,
  };
}

const optionalId = z.string().min(1).nullable();

const yearTotalsSchema: z.ZodType<JahresSummen> = z
  .object({ year: yearSchema, ...summenShape })
  .transform(({ year, ...sums }) => ({ year, ...toSummen(sums) }));

const kategorieSchema: z.ZodType<KategorieStatistik> = z
  .object({
    id: optionalId,
    name: z.string().transform((name) => name.trim()),
    sphere: z.enum(CAMPFLOW_SPHERES).nullable().catch(null),
    ...summenShape,
    yearTotals: z.array(yearTotalsSchema),
  })
  .transform(({ id, name, sphere, yearTotals, ...sums }) => ({
    id,
    name,
    sphere,
    ...toSummen(sums),
    yearTotals,
  }));

const kostenstelleSchema: z.ZodType<KostenstelleStatistik> = z
  .object({
    id: optionalId,
    name: z.string().transform((name) => name.trim()),
    color: z
      .string()
      .regex(/^#[0-9a-f]{3,8}$/i)
      .nullable()
      .catch(null),
    archived: z.boolean().catch(false),
    ...summenShape,
    years: z.array(yearSchema),
    yearTotals: z.array(yearTotalsSchema),
    categories: z.array(kategorieSchema),
  })
  .transform(({ id, name, color, archived, years, yearTotals, categories, ...sums }) => ({
    id,
    name,
    color,
    archived,
    ...toSummen(sums),
    years,
    yearTotals,
    categories,
  }));

const uebersichtSchema: z.ZodType<KostenstellenUebersicht> = z
  .object({ exportedAt: parseableTimestamp, costUnits: z.array(kostenstelleSchema) })
  .transform(({ exportedAt, costUnits }) => ({
    loadedAt: exportedAt,
    costUnits: costUnits.sort(
      (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de')
    ),
  }));

/**
 * Checks the answer of the Playwright API (`GET /campflow/kostenstellen/summen`) and converts it
 * to cents. Open Kostenstellen come first, each group by name.
 */
export function readKostenstellenSummen(value: unknown): KostenstellenUebersicht {
  return readAnswer(uebersichtSchema, value, 'Invalid Kostenstellen-Summen');
}
