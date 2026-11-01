/**
 * Schema of the amounts of one ingredient brought into one unit (`essen-einheiten.ts`); the types
 * are declared in `essen-einheiten-model.ts`. An error of a line names it as
 * `zeilen.<index>.<field>`.
 */
import { z } from 'zod';
import { EINHEITEN_STELLEN, MAX_EINHEITEN_ZEILEN } from './essen-einheiten-model';
import type { EinheitenStelle, EinheitenZeileInput } from './essen-einheiten-model';
import { einheitPflicht } from './essen-einheit-schema';
import { MAX_MENGE } from './essen-einkauf-model';
import { lenientObject, parseWith } from './validation/zod';

const STELLEN = EINHEITEN_STELLEN as [EinheitenStelle, ...EinheitenStelle[]];
const NEU_LADEN = 'Diese Menge gibt es nicht mehr. Bitte lade die Seite neu.';
const MENGE_FEHLER = 'Bitte eine Menge größer als 0 eintragen, z. B. 2,5.';

const zeileSchema = lenientObject({
  stelle: z.enum(STELLEN, { error: NEU_LADEN }),
  id: z.number({ error: NEU_LADEN }).int({ error: NEU_LADEN }).positive({ error: NEU_LADEN }),
  etag: z.string({ error: NEU_LADEN }).min(1, { error: NEU_LADEN }),
  menge: z
    .number({ error: MENGE_FEHLER })
    .refine((value) => Number.isFinite(value) && value > 0, { error: MENGE_FEHLER })
    .refine((value) => value <= MAX_MENGE, { error: 'Die Menge ist zu groß.' })
    // As stored (decimal(12, 3)); a tiny amount stays a little
    .transform((value) => Math.round(value * 1000) / 1000 || 0.001),
  einheit: einheitPflicht,
  // The unit it had, which tells the entries of a cooked dish apart
  von: einheitPflicht,
}).transform((value): EinheitenZeileInput => value);

export const einheitenSchema = lenientObject({
  zeilen: z
    .array(zeileSchema, { error: 'Bitte mindestens eine Menge umrechnen.' })
    .min(1, { error: 'Bitte mindestens eine Menge umrechnen.' })
    .max(MAX_EINHEITEN_ZEILEN, { error: `Höchstens ${MAX_EINHEITEN_ZEILEN} Mengen auf einmal.` }),
});

/** The converted amounts of a request; an error of a line names `zeilen.<index>.<field>`. */
export function validateEinheiten(input: unknown): EinheitenZeileInput[] {
  return parseWith(einheitenSchema, input, (path) => path.map(String).join('.')).zeilen;
}
