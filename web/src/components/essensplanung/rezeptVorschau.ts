import { EINHEITEN_JE_ART } from '../../../../api/lib/essen-gerichte-model';
import { mengeFeld, zutatWahl, type ZutatWahl } from '../../lib/essensplanungGerichte';
import { vorschlagKey, type KiRezeptZeile, type VorschauMenge } from '../../lib/essensplanungKi';
import type { EssenKatalog, GerichtEinheit, PlanungZutat } from '../../lib/types';
import type { Vorschlag } from '../../lib/vorschlaege';

/**
 * The lines of a recipe the AI read or wrote, as the preview edits them before they are taken
 * over (`RezeptImportDialog.svelte`, `RezeptVorschau.svelte`).
 */

export interface VorschauZeile {
  an: boolean;
  original: string;
  zutatText: string;
  auswahl: ZutatWahl | null;
  menge: string;
  einheit: GerichtEinheit;
  hinweis: string;
  fuerAlles: boolean;
  fuerVegetarisch: boolean;
  fuerVegan: boolean;
  /** The other way to give the amount: the recipe's („20 EL“) or the converted one. */
  alternative: VorschauMenge | null;
  fehler: Record<string, string>;
}

/** The ingredient chosen for a line, of the Planung or the central list. */
export function zutatVon(
  auswahl: ZutatWahl | null,
  zutaten: readonly PlanungZutat[],
  katalog: EssenKatalog
) {
  if (!auswahl) return undefined;
  return auswahl.art === 'planung'
    ? zutaten.find((z) => z.id === auswahl.id)
    : katalog.zutaten.find((z) => z.id === auswahl.id);
}

/** A line of the AI's answer as the preview shows it; unknown ingredients start unticked. */
export function vorschauZeile(
  ki: KiRezeptZeile,
  vorschlaege: readonly Vorschlag[],
  zutaten: readonly PlanungZutat[],
  katalog: EssenKatalog
): VorschauZeile {
  const key = vorschlagKey(ki.zutat, zutaten);
  const vorschlag = key ? vorschlaege.find((option) => option.key === key) : undefined;
  const auswahl = vorschlag ? zutatWahl(vorschlag) : null;
  const art = zutatVon(auswahl, zutaten, katalog)?.einheitenart;
  // Without an amount the unit follows the ingredient; an amount keeps the recipe's unit
  const einheit = ki.einheit ?? (art ? EINHEITEN_JE_ART[art][0] : 'g');
  return {
    an: Boolean(vorschlag),
    original: ki.original,
    zutatText: vorschlag?.value ?? ki.name,
    auswahl,
    menge: mengeFeld(ki.menge),
    einheit,
    hinweis: ki.hinweis,
    fuerAlles: ki.fuerAlles,
    fuerVegetarisch: ki.fuerVegetarisch,
    fuerVegan: ki.fuerVegan,
    alternative: ki.rezeptMenge
      ? { menge: mengeFeld(ki.rezeptMenge.menge), einheit: ki.rezeptMenge.einheit }
      : null,
    fehler: {},
  };
}

/** A line as `…/zutaten/sammel` takes it. */
export function zeileFuerSammel(zeile: VorschauZeile, menge: number | null) {
  return {
    ...(zeile.auswahl!.art === 'planung'
      ? { planungZutatId: zeile.auswahl!.id }
      : { zutatId: zeile.auswahl!.id }),
    menge,
    einheit: menge === null ? null : zeile.einheit,
    fuerAlles: zeile.fuerAlles,
    fuerVegetarisch: zeile.fuerVegetarisch,
    fuerVegan: zeile.fuerVegan,
    hinweis: zeile.hinweis,
  };
}

/** What the member may have changed of a line, to tell edited lines apart. */
export const schnappschuss = (zeile: VorschauZeile): string =>
  JSON.stringify([zeile.an, zeile.zutatText, zeile.menge, zeile.einheit, zeile.hinweis]);
