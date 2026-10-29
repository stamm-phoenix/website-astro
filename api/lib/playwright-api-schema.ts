/** Schemas of the answers of the Playwright API that the readers in `playwright-api.ts` check. */
import { z } from 'zod';

/** Gemeinnützige Sphäre of a Kategorie, as CampFlow names them. */
export const CAMPFLOW_SPHERES = ['ideal', 'purpose', 'assets', 'business'] as const;

export type CampflowSphere = (typeof CAMPFLOW_SPHERES)[number];

/**
 * A Kostenstelle with its Kategorien, validated before a financial write relies on it. Only the
 * fields the writes need are kept.
 */
export const kostenstelleSchema = z.object({
  id: z.string().startsWith('cun_'),
  name: z.string().refine((name) => name.trim() !== ''),
  archived: z.boolean(),
  categories: z.array(z.object({ name: z.string(), sphere: z.enum(CAMPFLOW_SPHERES) })),
});

export type KostenstelleWithCategories = z.output<typeof kostenstelleSchema>;

/** The Kategorien of a Kostenstelle with ID and name; entries without one are dropped. */
export const categoryListSchema = z
  .array(z.object({ id: z.string(), name: z.string() }).nullable().catch(null))
  .transform((categories) => categories.filter((category) => category !== null))
  .catch([]);

/** The `error` text of a failed response, at most 500 characters. */
export const errorDetailSchema = z.object({
  error: z.string().transform((text) => text.slice(0, 500)),
});

/** What `POST /campflow/belege` answers: the booking, or the one that existed already. */
export const belegUploadedSchema = z.object({
  created: z.boolean(),
  number: z.string().min(1),
  receiptId: z.string().catch(''),
  expenseId: z.string().catch(''),
});

/** The list `GET /campflow/kostenstellen` answers with; its items are checked one by one. */
export const kostenstellenListSchema = z.object({ data: z.array(z.unknown()) });
