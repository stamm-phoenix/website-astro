import type { GerichtZutat } from '../../../api/lib/essen-gerichte-model';
import { MAX_WERKZEUGE, mengeText } from '../../../api/lib/essen-gerichte-model';
import type {
  KiAenderung,
  KiNeueZeile,
  KiPruefung,
  KiWerkzeugAenderung,
  KiZutatAngabe,
} from '../../../api/lib/essen-ki-pruefen-model';
import { zeileBody } from './essensplanungGerichte';

export type {
  KiAenderung,
  KiHinweis,
  KiNeueZeile,
  KiPruefung,
  KiWerkzeugAenderung,
} from '../../../api/lib/essen-ki-pruefen-model';

/**
 * Helpers of „Gericht prüfen (KI)“ on the page (`docs/essensplanung.md`, „KI“): what taking over
 * a proposal does, in words for its button, and the request it sends. Without Svelte, so they
 * are unit-tested.
 */

/** What taking over a proposed change does, e.g. „Vollkornnudeln statt Spaghetti, 1 kg“. */
export function aenderungText(
  aenderung: KiAenderung,
  { name, abtropfgewicht = false }: { name?: string; abtropfgewicht?: boolean } = {}
): string {
  const teile: string[] = [];
  if (aenderung.zutat) teile.push(`${aenderung.zutat.name}${name ? ` statt ${name}` : ''}`);
  if (aenderung.menge !== undefined && aenderung.einheit)
    teile.push(mengeText(aenderung.menge, aenderung.einheit, abtropfgewicht) ?? '');
  const formen = [
    ['fuerAlles', 'mit allem'],
    ['fuerVegetarisch', 'vegetarisch'],
    ['fuerVegan', 'vegan'],
  ] as const;
  for (const [feld, label] of formen) {
    if (aenderung[feld] === true) teile.push(`auch für ${label}`);
    if (aenderung[feld] === false) teile.push(`nicht für ${label}`);
  }
  if (aenderung.hinweis !== undefined)
    teile.push(aenderung.hinweis ? `Hinweis „${aenderung.hinweis}“` : 'ohne Hinweis');
  return teile.filter(Boolean).join(', ');
}

/** A line to add in words, e.g. „50 g Salz“ or „Basilikum, nach Gefühl“. */
export function neueZeileText(zeile: KiNeueZeile): string {
  const menge = mengeText(zeile.menge, zeile.einheit);
  return [
    menge ? `${menge} ${zeile.zutat.name}` : `${zeile.zutat.name}, nach Gefühl`,
    ...(zeile.fest ? ['feste Menge'] : []),
    ...(zeile.hinweis ? [zeile.hinweis] : []),
  ].join(', ');
}

/** A change of the tools in words, e.g. „„Topf 10 l“ durch „Topf 30 l“ ersetzen“. */
export function werkzeugText(aenderung: KiWerkzeugAenderung): string {
  if (aenderung.alt === null) return `Werkzeug „${aenderung.neu}“ hinzufügen`;
  if (aenderung.neu === null) return `Werkzeug „${aenderung.alt}“ entfernen`;
  return `Werkzeug „${aenderung.alt}“ durch „${aenderung.neu}“ ersetzen`;
}

/** What the page says once a change of the tools is saved. */
export function werkzeugErfolg(aenderung: KiWerkzeugAenderung): string {
  if (aenderung.alt === null) return `Werkzeug „${aenderung.neu}“ hinzugefügt.`;
  if (aenderung.neu === null) return `Werkzeug „${aenderung.alt}“ entfernt.`;
  return `Werkzeug „${aenderung.alt}“ durch „${aenderung.neu}“ ersetzt.`;
}

const gleich = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * The tools of the dish after the change, or null when it no longer fits them: the tool to
 * change is gone, the new one is there already, or the dish would have too many.
 */
export function werkzeugeNach(
  werkzeuge: readonly string[],
  aenderung: KiWerkzeugAenderung
): string[] | null {
  const { alt, neu } = aenderung;
  const index = alt === null ? -1 : werkzeuge.findIndex((werkzeug) => gleich(werkzeug, alt));
  if (alt !== null && index < 0) return null;
  const doppelt =
    neu !== null && werkzeuge.some((werkzeug, i) => i !== index && gleich(werkzeug, neu));
  if (doppelt) return null;
  if (alt === null) return werkzeuge.length >= MAX_WERKZEUGE ? null : [...werkzeuge, neu!];
  if (neu === null) return werkzeuge.filter((_, i) => i !== index);
  return werkzeuge.map((werkzeug, i) => (i === index ? neu : werkzeug));
}

/** How a request names the ingredient of a line (`essen-gerichte-schema.ts`). */
export interface ZutatFelder {
  zutatId?: number;
  planungZutatId?: number;
  /** A new ingredient, or the name that picks again if `planungZutatId` went meanwhile. */
  neueZutat?: string;
}

/** How a request names the ingredient: of the lists by its id, else a new one by name. */
function zutatFelder(zutat: KiZutatAngabe): ZutatFelder {
  if (!zutat.wahl) return { neueZutat: zutat.name };
  return 'planungZutatId' in zutat.wahl
    ? { planungZutatId: zutat.wahl.planungZutatId, neueZutat: zutat.name }
    : { zutatId: zutat.wahl.zutatId };
}

/**
 * The PATCH of a line with the proposed change, with the version that was checked. Another
 * ingredient replaces the line's own; its name picks again if it went meanwhile.
 */
export function aenderungBody(
  zeile: GerichtZutat,
  aenderung: KiAenderung,
  etag: string
): Omit<ReturnType<typeof zeileBody>, 'planungZutatId'> & ZutatFelder {
  const { zutat, ...felder } = aenderung;
  const { planungZutatId, ...rest } = zeileBody(zeile);
  return {
    ...rest,
    ...(zutat ? zutatFelder(zutat) : { planungZutatId }),
    ...felder,
    etag,
  };
}

/** A line to add as `…/zutaten/sammel` takes it. */
export function neueZeileBody(zeile: KiNeueZeile) {
  return {
    ...zutatFelder(zeile.zutat),
    menge: zeile.menge,
    einheit: zeile.einheit,
    fest: zeile.fest,
    fuerAlles: zeile.fuerAlles,
    fuerVegetarisch: zeile.fuerVegetarisch,
    fuerVegan: zeile.fuerVegan,
    hinweis: zeile.hinweis,
  };
}

/** For whom the dish was checked, e.g. „Geprüft für 10 Personen, ohne Anleitung.“ */
export function geprueftText(pruefung: KiPruefung): string {
  const fuer =
    pruefung.geprueftFuer === null
      ? 'Geprüft ohne Personenzahl'
      : pruefung.personenQuelle === 'anwesend'
        ? `Geprüft für ${pruefung.geprueftFuer} Personen, die bei der Mahlzeit da sind`
        : `Geprüft für ${pruefung.geprueftFuer} Personen`;
  return `${fuer}${pruefung.anleitungGeprueft ? '' : ', ohne Anleitung'}.`;
}
