/**
 * Zod schemas of the task inputs. The DTO types in `aufgaben-model.ts` are inferred from them, so
 * the API validation and the web frontend share one definition. The frontend imports only types
 * from here (`import type`), so zod never reaches the browser bundle. Keep this file free of
 * imports other than zod and `calendar-date.ts`.
 */
import { z } from 'zod';
import { isValidDate } from './calendar-date';

export const MAX_TASK_PEOPLE = 20;
export const MAX_TEMPLATE_ITEMS = 50;
const MAX_ID = 999999999;
const MAX_DAYS_BEFORE = 366;
const DAYS_BEFORE_MESSAGE = `Der Abstand zum Aktionsdatum muss zwischen −${MAX_DAYS_BEFORE} und ${MAX_DAYS_BEFORE} Tagen liegen.`;
const ITEMS_MESSAGE = `Bitte 1 bis ${MAX_TEMPLATE_ITEMS} Aufgaben angeben.`;

/**
 * Trimmed text of at most `max` characters; an optional field defaults to an empty string, and a
 * missing required field reports its range like an empty one.
 */
export function boundedText(max: number, required = false): z.ZodType<string> {
  const message = `Bitte ${required ? '1 bis ' : 'höchstens '}${max} Zeichen angeben.`;
  const text = z.string({ error: 'Bitte Text angeben.' }).trim().max(max, { error: message });
  if (!required) return text.default('');
  return z.preprocess(
    (value) => (value === undefined ? '' : value),
    text.min(1, { error: message })
  );
}

/** Positive integer reference; numeric strings are not accepted. */
export const taskIdSchema = z
  .number({ error: 'Bitte einen gültigen Eintrag auswählen.' })
  .int({ error: 'Bitte einen gültigen Eintrag auswählen.' })
  .min(1, { error: 'Bitte einen gültigen Eintrag auswählen.' })
  .max(MAX_ID, { error: 'Bitte einen gültigen Eintrag auswählen.' });

const DATE_MESSAGE = 'Bitte ein gültiges Datum angeben.';

/** Calendar date supported by SQL. */
export const taskDateSchema = z
  .string({ error: DATE_MESSAGE })
  .refine((value) => isValidDate(value) && !value.startsWith('0000-'), { error: DATE_MESSAGE });

/** Optional calendar date; an empty value becomes `null`. */
export const optionalTaskDateSchema = z
  .union([taskDateSchema, z.literal('').transform(() => null), z.null()], { error: DATE_MESSAGE })
  .default(null);

export const taskPersonSchema = z.object(
  {
    name: boundedText(200, true),
    login: boundedText(254, false).refine((login) => !login || /^[^\s@]+@[^\s@]+$/.test(login), {
      error: 'Bitte einen gültigen Login auswählen.',
    }),
  },
  { error: 'Bitte die Felder ausfüllen.' }
);

const taskPeopleSchema = z
  .array(taskPersonSchema, { error: `Bitte höchstens ${MAX_TASK_PEOPLE} Personen auswählen.` })
  .max(MAX_TASK_PEOPLE, { error: `Bitte höchstens ${MAX_TASK_PEOPLE} Personen auswählen.` });

export const taskInputSchema = z.object(
  {
    title: boundedText(200, true),
    description: boundedText(2000, false),
    assignee: boundedText(254, false),
    assignees: taskPeopleSchema.optional(),
    dueDate: optionalTaskDateSchema,
    projectId: taskIdSchema.nullable().default(null),
  },
  { error: 'Bitte die Felder ausfüllen.' }
);

export const templateItemSchema = z.object(
  {
    title: boundedText(200, true),
    description: boundedText(2000, false),
    assignee: boundedText(254, false),
    assignees: taskPeopleSchema.optional(),
    daysBefore: z
      .number({ error: DAYS_BEFORE_MESSAGE })
      .int({ error: DAYS_BEFORE_MESSAGE })
      .min(-MAX_DAYS_BEFORE, { error: DAYS_BEFORE_MESSAGE })
      .max(MAX_DAYS_BEFORE, { error: DAYS_BEFORE_MESSAGE }),
  },
  { error: 'Bitte die Felder ausfüllen.' }
);

export const taskTemplateInputSchema = z.object(
  {
    title: boundedText(200, true),
    items: z
      .array(templateItemSchema, { error: ITEMS_MESSAGE })
      .min(1, { error: ITEMS_MESSAGE })
      .max(MAX_TEMPLATE_ITEMS, { error: ITEMS_MESSAGE }),
  },
  { error: 'Bitte die Felder ausfüllen.' }
);

export type TaskPerson = z.output<typeof taskPersonSchema>;
export type TaskInput = z.output<typeof taskInputSchema>;
export type TemplateItem = z.output<typeof templateItemSchema>;
