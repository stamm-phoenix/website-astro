import { z } from 'zod';
import type { EssenKatalog } from './essen-gerichte-model';
import { kiText } from './essen-ki-model';
import type { EssenEinheitenart } from './essen-validation';

/**
 * Reading the AI's details of ingredients added by their name alone (`docs/essensplanung.md`,
 * „Zutaten schnell anlegen“). Without database or network, so the mock API uses it too.
 */

export const KI_EINHEITENARTEN = ['masse', 'volumen', 'stueck', 'packung', 'bund'] as const;
export const KI_ERNAEHRUNG = ['vegan', 'vegetarisch', 'fleisch'] as const;

/** What the AI says about one ingredient; null where it does not know. */
export interface KiZutatAngaben {
  planungZutatId: number;
  kategorieId: number | null;
  einheitenart: EssenEinheitenart | null;
  /** Both null while the diet is unknown; vegan includes vegetarian. */
  vegetarisch: boolean | null;
  vegan: boolean | null;
  /** The allergens it contains; null while the diet is unknown, then nothing is said. */
  allergene: number[] | null;
}

/** The key of an ingredient in the question, so the answer cannot name another Planung's. */
export const kiZutatSchluessel = (planungZutatId: number): string => `z${planungZutatId}`;

const eintragSchema = z.object({
  schluessel: kiText(20),
  kategorie: z.unknown(),
  einheitenart: z.unknown(),
  ernaehrung: z.unknown(),
  allergene: z.unknown(),
});

/**
 * Reads the answer: one entry per asked ingredient, the first one per key. Categories and
 * allergens count only with an id of the lists, the kind of unit and the diet only with a known
 * word; anything else is null, so the stand-in stays.
 */
export function leseKiZutaten(
  raw: unknown,
  gefragt: readonly number[],
  katalog: Pick<EssenKatalog, 'kategorien' | 'unvertraeglichkeiten'>
): KiZutatAngaben[] {
  const eintraege = z.object({ zutaten: z.array(z.unknown()) }).parse(raw).zutaten;
  const kategorien = new Set(katalog.kategorien.map((k) => k.id));
  const allergene = new Set(katalog.unvertraeglichkeiten.map((u) => u.id));
  const ergebnis = new Map<number, KiZutatAngaben>();
  for (const roh of eintraege) {
    const eintrag = eintragSchema.safeParse(roh);
    if (!eintrag.success) continue;
    const id = gefragt.find((g) => kiZutatSchluessel(g) === eintrag.data.schluessel);
    if (id === undefined || ergebnis.has(id)) continue;
    const { kategorie, einheitenart, ernaehrung } = eintrag.data;
    const art = KI_ERNAEHRUNG.find((wort) => wort === ernaehrung) ?? null;
    ergebnis.set(id, {
      planungZutatId: id,
      kategorieId: typeof kategorie === 'number' && kategorien.has(kategorie) ? kategorie : null,
      einheitenart: KI_EINHEITENARTEN.find((wort) => wort === einheitenart) ?? null,
      vegetarisch: art === null ? null : art !== 'fleisch',
      vegan: art === null ? null : art === 'vegan',
      allergene:
        art === null
          ? null
          : Array.isArray(eintrag.data.allergene)
            ? [
                ...new Set(
                  eintrag.data.allergene.filter(
                    (a): a is number => typeof a === 'number' && allergene.has(a)
                  )
                ),
              ].sort((a, b) => a - b)
            : [],
    });
  }
  return [...ergebnis.values()];
}
