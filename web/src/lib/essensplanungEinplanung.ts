import type { Einplanung, PlanungAnsicht, PlanungMahlzeit, PlanungTag } from './types';

/** Helpers of planning dishes at meals (`docs/essensplanung.md`, Einplanung). */

/** What the dialog of planned dishes opens for. */
export interface Auftrag {
  modus: 'neu' | 'aendern' | 'kopieren';
  /** The meal the dialog starts at. */
  mahlzeitId: number;
  /** The planned dish to change or copy; null for a new one. */
  einplanungId: number | null;
}

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });

/** „×0,5“, or nothing for the usual factor 1. */
export function faktorText(faktor: number): string {
  return faktor === 1 ? '' : `×${ZAHL.format(faktor)}`;
}

/** A factor for an input field, „0,5“. */
export function faktorFeld(faktor: number): string {
  return String(faktor).replace('.', ',');
}

/** The body that saves a planned dish as it is, e.g. to move it within its meal. */
export function einplanungBody(einplanung: Einplanung, mahlzeitId: number) {
  return {
    etag: einplanung.etag,
    mahlzeitId,
    gerichtId: einplanung.gerichtId,
    faktor: einplanung.faktor,
    zustaendigId: einplanung.zustaendigId,
    zustaendigText: einplanung.zustaendigId === null ? einplanung.zustaendig : '',
  };
}

export interface Platz {
  tag: PlanungTag;
  mahlzeit: PlanungMahlzeit;
  einplanung: Einplanung;
}

/** Where a dish is planned, in the order of the plan. */
export function plaetzeVon(ansicht: PlanungAnsicht, gerichtId: number): Platz[] {
  return ansicht.tage.flatMap((tag) =>
    tag.mahlzeiten.flatMap((mahlzeit) =>
      mahlzeit.einplanungen
        .filter((einplanung) => einplanung.gerichtId === gerichtId)
        .map((einplanung) => ({ tag, mahlzeit, einplanung }))
    )
  );
}

/** Finds a planned dish with its meal. */
export function platzVon(ansicht: PlanungAnsicht, einplanungId: number): Platz | undefined {
  for (const tag of ansicht.tage) {
    for (const mahlzeit of tag.mahlzeiten) {
      const einplanung = mahlzeit.einplanungen.find((e) => e.id === einplanungId);
      if (einplanung) return { tag, mahlzeit, einplanung };
    }
  }
  return undefined;
}
