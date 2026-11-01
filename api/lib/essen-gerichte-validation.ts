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
import type { EinplanungInput } from './essen-planung-model';
import { validateGerichtEinplanung } from './essen-planung-validation';
import { ValidationError } from './validation/errors';
import { parseWith } from './validation/zod';

export type { GerichtInput, GerichtZutatInput, PlanungZutatInput };

/** A new dish needs a name and the number of people; a change sends only the changed fields. */
export function validateGericht(input: unknown, { neu }: { neu: boolean }): GerichtInput {
  return parseWith(neu ? gerichtNeuSchema : gerichtAenderungSchema, input, gerichtFieldOf);
}

/**
 * A new dish and, with `mahlzeitId`, where it is planned at once; the errors of both come back
 * together, so the form marks every field.
 */
export function validateNeuesGericht(input: unknown): {
  gericht: GerichtInput;
  einplanung: Omit<EinplanungInput, 'gerichtId'> | undefined;
} {
  const fehler: Record<string, string> = {};
  const lies = <T>(work: () => T): T | undefined => {
    try {
      return work();
    } catch (error: unknown) {
      if (!(error instanceof ValidationError)) throw error;
      Object.assign(fehler, error.fields);
      return undefined;
    }
  };
  const gericht = lies(() => validateGericht(input, { neu: true }));
  const einplanung = lies(() => validateGerichtEinplanung(input));
  if (!gericht || Object.keys(fehler).length) throw new ValidationError(fehler);
  return { gericht, einplanung };
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

const PERSONEN_SETZEN_UNGUELTIG = 'Bitte eine ganze Zahl von 1 bis 2000 eintragen.';

/**
 * The number of people a batch of lines sets for the dish in the same change (`personenSetzen`,
 * e.g. the people a recipe names for a dish without any yet); undefined when not sent. It needs
 * `personen`, the number the page expects the dish to have now (null for none), so it never
 * overwrites one set meanwhile.
 */
export function readPersonenSetzen(body: Record<string, unknown> | null): number | undefined {
  const wert = body?.personenSetzen;
  if (wert === undefined || wert === null) return undefined;
  if (typeof wert !== 'number' || !Number.isInteger(wert) || wert < 1 || wert > 2000)
    throw new ValidationError({ personenSetzen: PERSONEN_SETZEN_UNGUELTIG });
  const erwartet = body?.personen;
  const gesendet =
    erwartet === null ||
    (typeof erwartet === 'number' && Number.isInteger(erwartet) && erwartet > 0);
  if (!gesendet)
    throw new ValidationError({
      personenSetzen: 'Die Personenzahl lässt sich nur zusammen mit dem bisherigen Stand setzen.',
    });
  return wert;
}
