/**
 * Schema of ticking off a planned dish (`essen-kochen-validation.ts` parses with it; the types are
 * declared in `essen-kochen-model.ts`).
 */
import { z } from 'zod';
import { MAX_MENGE } from './essen-einkauf-model';
import { EINHEITEN_JE_ART } from './essen-gerichte-model';
import type { GerichtEinheit } from './essen-gerichte-model';
import { EINPLANUNG_STATUS, MAX_VERBRAUCH } from './essen-kochen-model';
import type { EinplanungStatus, Verbrauch } from './essen-kochen-model';
import { lenientObject } from './validation/zod';

const EINHEITEN = Object.values(EINHEITEN_JE_ART).flat() as [GerichtEinheit, ...GerichtEinheit[]];
const VERBRAUCH_FEHLER = 'Bitte eine Menge ab 0 eintragen, z. B. 2,5.';
const ZUTAT_FEHLER = 'Diese Zutat gibt es nicht. Bitte lade die Seite neu.';

const eintrag = lenientObject({
  planungZutatId: z
    .number({ error: ZUTAT_FEHLER })
    .int({ error: ZUTAT_FEHLER })
    .positive({ error: ZUTAT_FEHLER }),
  menge: z
    .number({ error: VERBRAUCH_FEHLER })
    .refine((value) => Number.isFinite(value) && value >= 0, { error: VERBRAUCH_FEHLER })
    .refine((value) => value <= MAX_MENGE, { error: 'Die Menge ist zu groß.' })
    // As stored (decimal(12, 3)); a tiny amount stays a little, not „not used“
    .transform((value) => (value === 0 ? 0 : Math.round(value * 1000) / 1000 || 0.001)),
  einheit: z.enum(EINHEITEN, { error: 'Bitte eine Einheit wählen.' }),
});

export const abhakenSchema = lenientObject({
  status: z.enum(EINPLANUNG_STATUS as [EinplanungStatus, ...EinplanungStatus[]], {
    error: 'Bitte gekocht, ausgelassen oder offen wählen.',
  }),
  verbrauch: z.preprocess(
    (value) => value ?? [],
    z
      .array(eintrag, { error: 'Bitte den Verbrauch als Liste senden.' })
      .max(MAX_VERBRAUCH, { error: `Höchstens ${MAX_VERBRAUCH} Zutaten.` })
  ),
}).transform((value) => ({
  status: value.status,
  // Only a cooked dish used something; the same ingredient and unit twice is summed
  verbrauch: value.status === 'gekocht' ? zusammen(value.verbrauch) : [],
}));

function zusammen(liste: Verbrauch[]): Verbrauch[] {
  const summen = new Map<string, Verbrauch>();
  for (const eintrag of liste) {
    const schluessel = `${eintrag.planungZutatId}:${eintrag.einheit}`;
    const summe = summen.get(schluessel);
    if (summe) summe.menge = Math.round((summe.menge + eintrag.menge) * 1000) / 1000;
    else summen.set(schluessel, { ...eintrag });
  }
  return [...summen.values()];
}
