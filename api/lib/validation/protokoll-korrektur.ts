/**
 * Correction proposals for written minutes (#553): the request to take proposals over and the
 * answer of the language model. Passages stay exactly as sent, without trimming, because they
 * are looked up verbatim in the text.
 */
import { z } from 'zod';
import { ELEMENT_ID } from '../protokoll-editor-model';
import type { KorrekturUebernahme, KorrekturVorschlag } from '../protokoll-korrektur-model';
import {
  KORREKTUR_ARTEN,
  KORREKTUR_FELDER,
  MAX_BEGRUENDUNG,
  MAX_VORSCHLAEGE,
  MAX_VORSCHLAG_TEXT,
} from '../protokoll-korrektur-model';
import { labeledText, lenientObject, parseWith } from './zod';

const UNGUELTIG = 'Der Vorschlag ist ungültig. Lass das Protokoll noch einmal prüfen.';
const VORSCHLAG_ID = /^[a-z0-9-]{1,20}$/;

const passage = (max: number) =>
  z.string({ error: UNGUELTIG }).max(max, {
    error: `Eine Stelle darf höchstens ${max} Zeichen lang sein.`,
  });

const uebernahmeSchema = lenientObject({
  etag: labeledText('Die Version', 100, true),
  vorschlaege: z
    .array(
      z.object(
        {
          id: z.string({ error: UNGUELTIG }).regex(VORSCHLAG_ID, { error: UNGUELTIG }),
          punktId: z.string({ error: UNGUELTIG }).regex(ELEMENT_ID, { error: UNGUELTIG }),
          feld: z.enum(KORREKTUR_FELDER, { error: UNGUELTIG }),
          elementId: z
            .string({ error: UNGUELTIG })
            .regex(ELEMENT_ID, { error: UNGUELTIG })
            .nullish()
            .transform((value) => value ?? null),
          vorher: passage(MAX_VORSCHLAG_TEXT).min(1, { error: UNGUELTIG }),
          nachher: passage(MAX_VORSCHLAG_TEXT),
        },
        { error: UNGUELTIG }
      ),
      { error: 'Bitte mindestens einen Vorschlag auswählen.' }
    )
    .min(1, { error: 'Bitte mindestens einen Vorschlag auswählen.' })
    .max(MAX_VORSCHLAEGE, {
      error: `Es lassen sich höchstens ${MAX_VORSCHLAEGE} Vorschläge auf einmal übernehmen.`,
    }),
});

export interface KorrekturUebernahmeInput {
  etag: string;
  vorschlaege: KorrekturUebernahme[];
}

/** Proposals to take over, with the version of the minutes the page has. */
export function validateKorrekturUebernahme(body: unknown): KorrekturUebernahmeInput {
  return parseWith(uebernahmeSchema, body);
}

/** One proposal of the model; its passage is checked against the text afterwards. */
const modellVorschlagSchema = z.object({
  punktId: z.string().regex(ELEMENT_ID),
  feld: z.enum(KORREKTUR_FELDER),
  elementId: z
    .string()
    .regex(ELEMENT_ID)
    .nullish()
    .transform((value) => value ?? null),
  art: z.enum(KORREKTUR_ARTEN),
  vorher: z.string().max(MAX_VORSCHLAG_TEXT),
  nachher: z.string().max(MAX_VORSCHLAG_TEXT),
  begruendung: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(1).max(MAX_BEGRUENDUNG)),
});

const modellAntwortSchema = z.object({ vorschlaege: z.array(z.unknown()) });

/**
 * The proposals of the model's answer, without their ID. Entries that do not fit the schema are
 * skipped; an answer without a list fails.
 */
export function parseKorrekturAntwort(raw: unknown): Omit<KorrekturVorschlag, 'id'>[] {
  const answer = modellAntwortSchema.safeParse(raw);
  if (!answer.success) throw new Error('Invalid correction answer');
  return answer.data.vorschlaege.flatMap((entry) => {
    const parsed = modellVorschlagSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
