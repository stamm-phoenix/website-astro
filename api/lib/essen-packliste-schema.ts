/**
 * Schemas of the requests of the packing list (`essen-packliste-validation.ts` parses with them;
 * the types are declared in `essen-packliste-model.ts`). Errors are reported per field.
 */
import { z } from 'zod';
import { MAX_PACK_NAME, MAX_PACK_PERSONEN, packlisteSchluessel } from './essen-packliste-model';
import { isRecord, lenientObject } from './validation/zod';

const LISTE = 'Bitte aus der Liste wählen.';

/** A trimmed text of one line up to `max` characters; anything but a string is empty. */
function zeile(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().max(max, { error: `Höchstens ${max} Zeichen.` })
  );
}

const name = zeile(MAX_PACK_NAME).refine((value) => value.length > 0, {
  error: 'Bitte eintragen, was eingepackt werden soll, z. B. „Gaskocher“.',
});

/** A list of ids; missing is empty, the same id twice counts once. */
function ids(max: number, error: string) {
  return z.preprocess(
    (value) => (value === undefined || value === null ? [] : value),
    z
      .array(
        z.number({ error }).refine((id) => Number.isInteger(id) && id > 0, { error }),
        { error }
      )
      .max(max, { error: `Höchstens ${max} auf einmal.` })
      .transform((liste) => [...new Set(liste)])
  );
}

/** Members to assign. */
const mitglieder = ids(MAX_PACK_PERSONEN, LISTE);

/** Free names to assign; empty ones are dropped, the same name twice (any case) counts once. */
const namen = z.preprocess(
  (value) => (value === undefined || value === null ? [] : value),
  z
    .array(zeile(100), { error: 'Bitte Namen eintragen.' })
    .transform((liste) => {
      const gesehen = new Set<string>();
      return liste.filter((text) => {
        const schluessel = packlisteSchluessel(text);
        if (!text || gesehen.has(schluessel)) return false;
        gesehen.add(schluessel);
        return true;
      });
    })
    .refine((liste) => liste.length <= MAX_PACK_PERSONEN, {
      error: `Höchstens ${MAX_PACK_PERSONEN} Namen.`,
    })
);

/** A new entry of its own, optionally with who packs it. */
export const packEintragSchema = lenientObject({ name, mitglieder, namen });

const gepackt = z.boolean({ error: 'Bitte ankreuzen oder nicht.' }).optional();

/** The fields of an entry that were sent: packed, persons added or taken off. */
export const packAenderungSchema = z
  .preprocess(
    // No object at all (bad JSON, null, a list) sends nothing, which is named in German
    (value) => (isRecord(value) ? value : {}),
    z.object({ gepackt, mitglieder, namen, weg: ids(200, LISTE) })
  )
  .refine(
    (value) =>
      value.gepackt !== undefined ||
      value.mitglieder.length > 0 ||
      value.namen.length > 0 ||
      value.weg.length > 0,
    { error: 'Es gibt nichts zu speichern.', path: ['gepackt'] }
  )
  .transform((value) => ({
    ...(value.gepackt !== undefined ? { gepackt: value.gepackt } : {}),
    ...(value.mitglieder.length || value.namen.length
      ? { hinzu: { mitglieder: value.mitglieder, namen: value.namen } }
      : {}),
    ...(value.weg.length ? { weg: value.weg } : {}),
  }));

/** One person's share: packed or not. */
export const zuteilungAenderungSchema = lenientObject({
  gepackt: z.boolean({ error: 'Bitte ankreuzen oder nicht.' }),
});

/** The name of the tool whose state is set. */
export const werkzeugSchema = lenientObject({
  werkzeug: zeile(MAX_PACK_NAME).refine((value) => value.length > 0, {
    error: 'Bitte ein Werkzeug wählen.',
  }),
});
