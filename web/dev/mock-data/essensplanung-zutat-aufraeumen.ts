/**
 * Like `essen-zutat-aufraeumen.ts` of the API: ingredients of a Planung go with their last use.
 * `aendere` of the mock notes the used ones before a change and removes those nothing uses after.
 */
import type { MockPlanung } from './essensplanung-planung';

/** The ingredients of the Planung a line, stock, extra need, purchase or cooked dish uses. */
export function genutzteZutaten(planung: MockPlanung): Set<number> {
  return new Set(
    [
      ...planung.gerichte.flatMap((g) => g.zutaten),
      ...planung.bestand,
      ...planung.zusatzbedarf,
      ...planung.tage
        .flatMap((t) => t.mahlzeiten.flatMap((m) => m.einplanungen))
        .flatMap((e) => e.verbrauch),
      ...planung.einkaeufe.flatMap((e) => [...e.posten, ...e.regeln]),
    ].map((nutzung) => nutzung.planungZutatId)
  );
}

/** Removes the ingredients of `vorher` that nothing uses any more. */
export function entferneUngenutzte(planung: MockPlanung, vorher: ReadonlySet<number>): void {
  const jetzt = genutzteZutaten(planung);
  planung.zutaten = planung.zutaten.filter((zutat) => !vorher.has(zutat.id) || jetzt.has(zutat.id));
}
