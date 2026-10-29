/**
 * Checks of the input for dishes and the ingredients of a Planung. They parse with the schemas
 * of `essen-gerichte-schema.ts`; the types they return are declared in `essen-gerichte-model.ts`,
 * which the browser imports and which therefore stays free of zod.
 */
import {
  gerichtAenderungSchema,
  gerichtFieldOf,
  gerichtNeuSchema,
  gerichtZutatSchema,
  planungZutatAbweichungSchema,
  planungZutatEigeneSchema,
} from './essen-gerichte-schema';
import type { GerichtInput, GerichtZutatInput, PlanungZutatInput } from './essen-gerichte-model';
import { parseWith } from './validation/zod';

export type { GerichtInput, GerichtZutatInput, PlanungZutatInput };

/** A new dish needs a name and the number of people; a change sends only the changed fields. */
export function validateGericht(input: unknown, { neu }: { neu: boolean }): GerichtInput {
  return parseWith(neu ? gerichtNeuSchema : gerichtAenderungSchema, input, gerichtFieldOf);
}

export function validateGerichtZutat(input: unknown): GerichtZutatInput {
  return parseWith(gerichtZutatSchema, input);
}

/**
 * `eigene`: a new or changed ingredient of the Planung's own with all fields; otherwise the
 * differences of a central ingredient (null: as in the central list).
 */
export function validatePlanungZutat(
  input: unknown,
  { eigene }: { eigene: boolean }
): PlanungZutatInput {
  return parseWith(eigene ? planungZutatEigeneSchema : planungZutatAbweichungSchema, input);
}
