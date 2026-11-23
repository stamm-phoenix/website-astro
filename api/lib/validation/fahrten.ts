import { z } from 'zod';
import { ValidationError } from './errors';
import { lenientObject, parseWith } from './zod';

export const MAX_FAHRTEN_NACHRICHT = 1000;
const MAX_AUTOS = 100;
const MAX_MITFAHRENDE = 20;

const personId = z
  .string({ error: 'Eine Person im Plan ist ungültig. Bitte lade die Seite neu.' })
  .trim()
  .min(1, { error: 'Eine Person im Plan ist ungültig. Bitte lade die Seite neu.' })
  .max(100, { error: 'Eine Person im Plan ist ungültig. Bitte lade die Seite neu.' });

const autoSchema = z.object(
  {
    fahrer: personId,
    mitfahrende: z
      .array(personId, { error: 'Die Mitfahrenden eines Autos sind ungültig.' })
      .max(MAX_MITFAHRENDE, { error: 'In einem Auto sitzen zu viele Mitfahrende.' }),
  },
  { error: 'Ein Auto im Plan ist ungültig. Bitte lade die Seite neu.' }
);

const autosSchema = z
  .array(autoSchema, { error: 'Der Plan ist ungültig. Bitte lade die Seite neu.' })
  .max(MAX_AUTOS, { error: 'Der Plan hat zu viele Autos.' })
  .default([]);

const fahrtenMailSchema = lenientObject({
  fahrten: lenientObject({ hin: autosSchema, rueck: autosSchema }),
  nachricht: z
    .string({ error: 'Die Nachricht ist ungültig.' })
    .trim()
    .max(MAX_FAHRTEN_NACHRICHT, {
      error: `Die Nachricht darf höchstens ${MAX_FAHRTEN_NACHRICHT} Zeichen lang sein.`,
    })
    .default(''),
});

/** The cars of Hin- and Rückfahrt as planned in the browser, and a note for all drivers. */
export type FahrtenMailInput = z.output<typeof fahrtenMailSchema>;

/** Validates the request to tell the drivers of an Aktion their cars by mail. */
export function validateFahrtenMail(value: unknown): FahrtenMailInput {
  const input = parseWith(fahrtenMailSchema, value);
  if (input.fahrten.hin.length === 0 && input.fahrten.rueck.length === 0) {
    throw new ValidationError({ form: 'Im Plan fährt niemand. Es gibt niemanden zu informieren.' });
  }
  return input;
}
