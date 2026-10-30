/**
 * Schemas of the requests of the packing list (`essen-packliste-validation.ts` parses with them;
 * the types are declared in `essen-packliste-model.ts`). Errors are reported per field.
 */
import { z } from 'zod';
import { MAX_PACK_NAME } from './essen-packliste-model';
import { isRecord, lenientObject } from './validation/zod';

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

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

const zustaendigId = z.preprocess(
  (value) => (value === undefined ? null : value),
  z
    .number({ error: LISTE })
    .refine((id) => Number.isInteger(id) && id > 0, { error: LISTE })
    .nullable()
);

const zustaendigText = zeile(100);

/** A member and a free name exclude each other. */
function pruefeZustaendig(
  value: { zustaendigId: number | null; zustaendigText: string },
  ctx: z.RefinementCtx
): void {
  // An invalid member reports at its own field only
  const mitglied = Number.isInteger(value.zustaendigId) && Number(value.zustaendigId) > 0;
  if (mitglied && value.zustaendigText) {
    ctx.addIssue({
      code: 'custom',
      path: ['zustaendigText'],
      message: 'Entweder ein Mitglied oder einen Namen.',
    });
  }
}

/** A new entry of its own, optionally with who packs it. */
export const packEintragSchema = lenientObject({
  name,
  zustaendigId,
  zustaendigText,
}).superRefine(pruefeZustaendig, { when: ALWAYS });

const gepackt = z.boolean({ error: 'Bitte ankreuzen oder nicht.' }).optional();

/** Whether the body names who packs it; sending one of the two fields sets both. */
function mitZustaendig(value: unknown): boolean {
  return isRecord(value) && ('zustaendigId' in value || 'zustaendigText' in value);
}

/** The fields of an entry that were sent: packed, who packs it, or both. */
export const packAenderungSchema = z
  .preprocess(
    // No object at all (bad JSON, null, a list) sends nothing, which is named in German
    (value) =>
      isRecord(value)
        ? { ...value, mitZustaendig: mitZustaendig(value) }
        : { mitZustaendig: false },
    z.object({
      gepackt,
      zustaendigId,
      zustaendigText,
      mitZustaendig: z.boolean(),
    })
  )
  .superRefine(pruefeZustaendig, { when: ALWAYS })
  .refine((value) => value.gepackt !== undefined || value.mitZustaendig, {
    error: 'Es gibt nichts zu speichern.',
    path: ['gepackt'],
  })
  .transform((value) => ({
    ...(value.gepackt !== undefined ? { gepackt: value.gepackt } : {}),
    ...(value.mitZustaendig
      ? {
          zustaendig: {
            zustaendigId: value.zustaendigId,
            zustaendigText: value.zustaendigId === null ? value.zustaendigText : '',
          },
        }
      : {}),
  }));

/** The name of the tool whose state is set. */
export const werkzeugSchema = lenientObject({
  werkzeug: zeile(MAX_PACK_NAME).refine((value) => value.length > 0, {
    error: 'Bitte ein Werkzeug wählen.',
  }),
});
