import type { PlanungAnsicht } from '../../../api/lib/essen-planung-model';

/** Who is responsible for the dishes of a Planung, gathered from all their meals in the plan. */

export interface GerichtZustaendige {
  /** The shown names, each once, in the order of the plan. */
  namen: string[];
  /** Whether the viewer is responsible at least once. */
  ich: boolean;
}

const schluessel = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');

/**
 * The responsible persons per dish. The viewer counts as a member and as a free name equal to
 * their own, e.g. typed before they joined.
 */
export function zustaendigeJeGericht(
  ansicht: Pick<PlanungAnsicht, 'tage' | 'mitglieder' | 'ichId'>
): Map<number, GerichtZustaendige> {
  const ich = ansicht.mitglieder.find((m) => m.id === ansicht.ichId);
  const meinName = ich ? schluessel(ich.name) : null;
  const ergebnis = new Map<number, GerichtZustaendige>();
  const tage = [...ansicht.tage].sort((a, b) => a.datum.localeCompare(b.datum));
  for (const tag of tage) {
    for (const mahlzeit of [...tag.mahlzeiten].sort((a, b) => a.position - b.position)) {
      for (const einplanung of mahlzeit.einplanungen) {
        const name = einplanung.zustaendig.trim();
        if (!name) continue;
        const eintrag = ergebnis.get(einplanung.gerichtId) ?? { namen: [], ich: false };
        if (!eintrag.namen.some((n) => schluessel(n) === schluessel(name)))
          eintrag.namen.push(name);
        if (
          (ansicht.ichId !== null && einplanung.zustaendigId === ansicht.ichId) ||
          (einplanung.zustaendigId === null && meinName !== null && schluessel(name) === meinName)
        )
          eintrag.ich = true;
        ergebnis.set(einplanung.gerichtId, eintrag);
      }
    }
  }
  return ergebnis;
}
