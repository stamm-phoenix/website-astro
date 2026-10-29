/** Request bodies of the module Aufgaben that are not a task themselves. */
import { z } from 'zod';
import { lenientObject, parseWith } from './zod';

const doneSchema = lenientObject({
  done: z.boolean({ error: 'Bitte den Erledigt-Status angeben.' }),
});

/** Whether a task is done; sent with every change of a task. */
export function validateTaskDone(body: unknown): boolean {
  return parseWith(doneSchema, body).done;
}

const decisionSchema = lenientObject({
  action: z.enum(['annehmen', 'ablehnen'], { error: 'Unbekannte Entscheidung.' }),
});

/** Whether a suggested task is taken over or declined. */
export function validateTaskDecision(body: unknown): 'annehmen' | 'ablehnen' {
  return parseWith(decisionSchema, body, () => 'form').action;
}
