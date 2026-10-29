/**
 * Schemas of what only the API reads in the Problemmeldungen: the issue draft a leader saves,
 * the reason of a discard and the answer of the language model. The report of a visitor is
 * checked by `validateProblemReport` (`problemmeldung-model.ts`), because the browser runs
 * that check too and must not get zod.
 */
import { z } from 'zod';
import {
  PROBLEM_LABELS,
  PROBLEM_MAX_LENGTH,
  PROBLEM_VERDICTS,
  cleanIssueText,
  cleanIssueTitle,
  isProblemLabel,
  redactForForwarding,
} from './problemmeldung-model';
import type { ProblemLabel } from './problemmeldung-model';
import { lenientObject } from './validation/zod';

/** Cleaning can lengthen a text, but a text far beyond the limit is refused before the work. */
const HUGE_TITLE = PROBLEM_MAX_LENGTH.title * 3;
const HUGE_BODY = PROBLEM_MAX_LENGTH.body * 2;

const TITLE_TOO_LONG = `Der Titel darf höchstens ${PROBLEM_MAX_LENGTH.title} Zeichen lang sein.`;
const BODY_TOO_LONG = `Die Beschreibung darf höchstens ${PROBLEM_MAX_LENGTH.body} Zeichen lang sein.`;

/** Anything but a string counts as empty. */
const asText = (value: unknown): unknown => (typeof value === 'string' ? value : '');

const draftTitle = z.preprocess(
  asText,
  z
    .string()
    .max(HUGE_TITLE, { error: TITLE_TOO_LONG })
    // Cleaning can make a text longer (`token=x` becomes `token: [entfernt]`), so the length that
    // counts is the cleaned one. Too long is refused, not cut: the rest would be lost silently.
    .transform((value) => cleanIssueTitle(value, Infinity))
    .refine((value) => value.length <= PROBLEM_MAX_LENGTH.title, { error: TITLE_TOO_LONG })
    .refine((value) => value !== '', { error: 'Bitte gib einen Titel an.' })
);

const draftBody = z.preprocess(
  asText,
  z
    .string()
    .max(HUGE_BODY, { error: BODY_TOO_LONG })
    .transform((value) => cleanIssueText(value, Infinity))
    .refine((value) => value.length <= PROBLEM_MAX_LENGTH.body, { error: BODY_TOO_LONG })
);

/** The issue draft as a request sends it, cleaned. */
export const problemDraftSchema = lenientObject({
  title: draftTitle,
  body: draftBody,
  label: z.custom<ProblemLabel>(isProblemLabel, { error: 'Bitte wähle ein Label.' }),
});

/** The body of a discard: the reason is optional and cut to its limit, never refused. */
export const problemDiscardSchema = lenientObject({
  reason: z.preprocess(
    (value) =>
      typeof value === 'string' ? value.trim().slice(0, PROBLEM_MAX_LENGTH.discardReason) : '',
    z.string()
  ),
});

/** Text of an answer of the model without secrets and addresses, cut to `max`; not empty. */
function answerText(max: number) {
  return z
    .string()
    .transform((value) => redactForForwarding(value).trim().slice(0, max))
    .refine((value) => value !== '');
}

const ANSWER_PART_MAX = 1500;

/**
 * The answer of the model as the structured output asks for it. Anything unexpected makes the
 * parse fail, so no half-valid answer is stored; the messages are not for users.
 */
export const problemAssessmentSchema = lenientObject({
  verdict: z.enum(PROBLEM_VERDICTS),
  label: z.custom<ProblemLabel>((value) => PROBLEM_LABELS.some((entry) => entry.id === value), {
    error: 'Unknown label.',
  }),
  reason: answerText(500),
  title: z
    .string()
    .transform((value) => cleanIssueTitle(value))
    .refine((value) => value !== ''),
  summary: answerText(ANSWER_PART_MAX),
  steps: answerText(ANSWER_PART_MAX),
  expected: answerText(ANSWER_PART_MAX),
  actual: answerText(ANSWER_PART_MAX),
});
