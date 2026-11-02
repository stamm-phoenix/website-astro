import { z } from 'zod';
import { MAX_EINHEIT, normalisiereEinheit } from './essen-gerichte-model';

/**
 * The unit of an amount as the forms send it (`docs/essensplanung.md`, „Einheiten“): a known
 * unit or one typed by the user, stored as `normalisiereEinheit` writes it.
 */

const WAEHLEN = 'Bitte eine Einheit wählen.';

const einheitText = z
  .string({ error: WAEHLEN })
  .min(1, { error: WAEHLEN })
  .max(MAX_EINHEIT, { error: `Die Einheit darf höchstens ${MAX_EINHEIT} Zeichen lang sein.` })
  // Control characters cannot be typed; they would only break lists and files
  .refine((value) => !/\p{Cc}/u.test(value), { error: 'Bitte eine Einheit wie „g“ eintragen.' });

/** An optional unit: anything but text, and empty text, is null. */
export const einheitFeld = z.preprocess(
  (value) => (typeof value === 'string' ? normalisiereEinheit(value) : null),
  einheitText.nullable()
);

/** A unit that must be given, e.g. of a tick or of what a cooked dish used. */
export const einheitPflicht = z.preprocess(
  (value) => (typeof value === 'string' ? (normalisiereEinheit(value) ?? '') : value),
  einheitText
);
