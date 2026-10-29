/**
 * Validation of the helpers of the Nikolausdienst, the tags of bookings and the answers to the
 * suggestions of the Stufen-Abgleich. Errors are `ValidationError`s with the messages of the forms.
 */
import { z } from 'zod';
import { HELPER_ROLES, normalizeTag, parseTags } from '../nikolaus-einteilung';
import type { HelperRole } from '../nikolaus-einteilung';
import { STUFEN } from './constants';
import { choice, isRecord, labeledText, lenientObject, parseWith } from './zod';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/** A list of tags; each without commas, unique regardless of case. A missing list is empty. */
export function tagList(label: string) {
  const invalid = `Die Angaben unter „${label}“ sind ungültig. Entferne sie und gib die Merkmale erneut ein.`;
  const tooMany = `Unter „${label}“ sind höchstens ${MAX_TAGS} Merkmale möglich. Entferne die übrigen Merkmale.`;
  const tooLong = `Ein Merkmal unter „${label}“ ist zu lang. Kürze es auf höchstens ${MAX_TAG_LENGTH} Zeichen.`;
  return z.preprocess(
    (value) => value ?? [],
    z
      .array(z.string({ error: invalid }), { error: invalid })
      .transform((tags) => parseTags(tags.map((tag) => tag.replace(/,/g, ' ')).join(',')))
      .pipe(
        z
          .array(z.string())
          .max(MAX_TAGS, { error: tooMany })
          .refine((tags) => tags.every((tag) => tag.length <= MAX_TAG_LENGTH), { error: tooLong })
      )
  );
}

const bookingTagsSchema = lenientObject({ tags: tagList('Merkmale für die Einteilung') });

/** Validates the internal tags of a booking. */
export function validateBookingTags(body: unknown): string[] {
  return parseWith(bookingTagsSchema, body).tags;
}

export interface StufenDecisionInput {
  kind: 'booking' | 'helper';
  targetId: string;
  stufe: string;
  decision: 'accept' | 'reject';
}

const STUFE_INVALID = 'Bitte eine gültige Auswahl für die Stufe treffen.';

const stufenDecisionSchema = lenientObject({
  kind: choice('die Art', ['booking', 'helper']),
  stufe: z
    .string({ error: STUFE_INVALID })
    .refine((stufe) => STUFEN.includes(stufe), { error: STUFE_INVALID }),
  decision: choice('die Entscheidung', ['accept', 'reject']),
  targetId: z
    .string({ error: 'Der Eintrag ist ungültig.' })
    .regex(/^\d+$/, { error: 'Der Eintrag ist ungültig.' }),
});

/** Validates the answer to a suggestion of the Stufen-Abgleich. */
export function validateStufenDecision(body: unknown): StufenDecisionInput {
  return parseWith(stufenDecisionSchema, body);
}

export interface HelperInput {
  name: string;
  availability: Record<string, HelperRole[]>;
  positiveTags: string[];
  negativeTags: string[];
  notes: string;
}

const POSTS_INVALID = 'Die Posten sind ungültig.';

/** The posts a helper takes on a day, in the order of importance and without duplicates. */
const postsSchema = z
  .array(z.string({ error: POSTS_INVALID }), { error: POSTS_INVALID })
  .refine((roles) => roles.every((role) => HELPER_ROLES.some((known) => known === role)), {
    error: POSTS_INVALID,
  })
  .transform((roles) => HELPER_ROLES.filter((role) => roles.includes(role)));

/** The posts per configured day; other days are dropped, and a day without posts is left out. */
function availabilitySchema(dates: readonly string[]) {
  const days = z.object(Object.fromEntries(dates.map((date) => [date, postsSchema.optional()])));
  return z
    .preprocess((value) => (isRecord(value) ? value : {}), days)
    .transform((posts) => {
      const availability: Record<string, HelperRole[]> = {};
      for (const [date, roles] of Object.entries(posts)) {
        if (roles && roles.length > 0) availability[date] = roles;
      }
      return availability;
    });
}

const POSITIVE_LABEL = 'Bevorzugt zu Familien mit';
const NEGATIVE_LABEL = 'Nicht zu Familien mit';

function helperSchema(dates: readonly string[]) {
  return lenientObject({
    name: labeledText('den Namen', 100, true),
    availability: availabilitySchema(dates),
    positiveTags: tagList(POSITIVE_LABEL),
    negativeTags: tagList(NEGATIVE_LABEL),
    notes: labeledText('Bemerkungen', 500),
  }).superRefine(
    // Only on valid lists: the limits of a list are reported first
    (helper, ctx) => {
      const negative = new Set(helper.negativeTags.map(normalizeTag));
      if (helper.positiveTags.some((tag) => negative.has(normalizeTag(tag)))) {
        ctx.addIssue({
          code: 'custom',
          path: ['negativeTags'],
          message: `Derselbe Begriff steht in „${POSITIVE_LABEL}“ und „${NEGATIVE_LABEL}“. Entferne ihn aus einem der beiden Felder.`,
        });
      }
    }
  );
}

/**
 * Validates a helper of the Nikolausdienst.
 * @param dates The configured days; availability for other days is dropped.
 */
export function validateHelper(body: unknown, dates: string[]): HelperInput {
  return parseWith(helperSchema(dates), body);
}
