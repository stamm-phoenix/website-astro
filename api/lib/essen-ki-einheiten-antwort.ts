import { z } from 'zod';
import type { EinheitenVorkommen, KiEinheiten } from './essen-einheiten-model';
import { sichererFaktor, vorkommendeEinheiten } from './essen-einheiten-model';
import { MAX_EINHEIT, normalisiereEinheit } from './essen-gerichte-model';
import { kiText } from './essen-ki-model';

/**
 * Reading the AI's proposal to bring the units of one ingredient into line
 * (`docs/essensplanung.md`, „Einheiten“). Without database or network, so the mock API uses it
 * too.
 */

/** Largest factor between two units that is still an estimate („1 kg = 1000 g“ is certain). */
const MAX_FAKTOR = 100_000;

const antwortSchema = z.object({
  ziel: kiText(40),
  begruendung: kiText(300),
  faktoren: z.array(z.unknown()),
});

const faktorSchema = z.object({
  einheit: kiText(40),
  faktor: z.preprocess(
    (value) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_FAKTOR
        ? value
        : null,
    z.number().nullable()
  ),
});

/**
 * Reads the proposal: the target unit as the page stores units, and per unit found a factor.
 * Certain factors (g and kg, ml and l, the target itself) are worked out, not taken from the
 * model; an implausible or missing one is null, so the member types it.
 */
export function leseKiEinheiten(
  raw: unknown,
  planungZutatId: number,
  vorkommen: readonly EinheitenVorkommen[]
): KiEinheiten {
  const antwort = antwortSchema.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the units');
  const ziel = normalisiereEinheit(antwort.data.ziel);
  if (!ziel || ziel.length > MAX_EINHEIT) throw new Error('No target unit');
  const vonModell = new Map<string, number | null>();
  for (const value of antwort.data.faktoren) {
    const eintrag = faktorSchema.safeParse(value);
    if (!eintrag.success) continue;
    const einheit = normalisiereEinheit(eintrag.data.einheit);
    if (einheit) vonModell.set(einheit.toLocaleLowerCase('de'), eintrag.data.faktor);
  }
  return {
    planungZutatId,
    ziel,
    begruendung: antwort.data.begruendung,
    faktoren: vorkommendeEinheiten(vorkommen).map((einheit) => ({
      einheit,
      faktor:
        sichererFaktor(einheit, ziel) ?? vonModell.get(einheit.toLocaleLowerCase('de')) ?? null,
    })),
  };
}
