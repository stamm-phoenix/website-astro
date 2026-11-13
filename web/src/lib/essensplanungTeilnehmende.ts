import type { Ernaehrung, Teilnehmende } from '../../../api/lib/essen-teilnehmende-model';
import type { PlanungAnsicht } from '../../../api/lib/essen-planung-model';

/** Helpers of the participants of a Planung (`docs/essensplanung.md`, Teilnehmende). */

export const ERNAEHRUNG_TEXT: Record<Ernaehrung, string> = {
  alles: 'mit allem',
  vegetarisch: 'vegetarisch',
  vegan: 'vegan',
};

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** „1,2“. */
export function zahlText(zahl: number): string {
  return ZAHL.format(zahl);
}

/** „1_2 Mittagessen“ for a meal of the plan; empty when it is not in the plan any more. */
export function mahlzeitText(ansicht: PlanungAnsicht, mahlzeitId: number): string {
  for (const tag of ansicht.tage) {
    const mahlzeit = tag.mahlzeiten.find((m) => m.id === mahlzeitId);
    if (mahlzeit) return `${mahlzeit.kennung} ${mahlzeit.name}`;
  }
  return '';
}

/** Shown when a limit is a deleted meal: the row then counts at no meal (`anwesend`). */
export const GRENZE_GELOESCHT = 'isst bei keiner Mahlzeit mit, weil ihre Mahlzeit gelöscht ist';

/**
 * „ab 1_2 Mittagessen bis 2_1 Frühstück“; empty for the whole Planung; `GRENZE_GELOESCHT` when
 * a limit is not in the plan any more.
 */
export function zeitraumText(ansicht: PlanungAnsicht, zeile: Teilnehmende): string {
  const von = zeile.vonMahlzeitId === null ? '' : mahlzeitText(ansicht, zeile.vonMahlzeitId);
  const bis = zeile.bisMahlzeitId === null ? '' : mahlzeitText(ansicht, zeile.bisMahlzeitId);
  if ((zeile.vonMahlzeitId !== null && !von) || (zeile.bisMahlzeitId !== null && !bis))
    return GRENZE_GELOESCHT;
  return [von && `ab ${von}`, bis && `bis ${bis}`].filter(Boolean).join(' ');
}

/** The diets in the order of the columns of the matrices. */
export const ERNAEHRUNGEN: readonly Ernaehrung[] = ['alles', 'vegetarisch', 'vegan'];

/** The persons of rows by diet. */
export function jeErnaehrung(zeilen: readonly Teilnehmende[]): Record<Ernaehrung, number> {
  const summe: Record<Ernaehrung, number> = { alles: 0, vegetarisch: 0, vegan: 0 };
  for (const zeile of zeilen) summe[zeile.ernaehrung] += zeile.anzahl;
  return summe;
}

/**
 * The names of a row's intolerances; while their list is missing, the row still says that it
 * has some („1 (Liste nicht geladen)“).
 */
export function unvertraeglichkeitenNamen(
  zeile: Teilnehmende,
  namen: ReadonlyMap<number, string>
): string[] {
  const bekannt = zeile.unvertraeglichkeiten.map((id) => namen.get(id) ?? '').filter(Boolean);
  const offen = zeile.unvertraeglichkeiten.length - bekannt.length;
  return offen
    ? [...bekannt, `${offen}${bekannt.length ? ' weitere' : ''} (Liste nicht geladen)`]
    : bekannt;
}
