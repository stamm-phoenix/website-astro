import { errorMessage } from './api';
import { EINHEITEN_JE_ART, einheitText, mengeText } from '../../../api/lib/essen-gerichte-model';
import type { EssenEinheitenart } from '../../../api/lib/essen-validation';
import type { GerichtEinheit } from './types';
import { leseMenge, mengeFeld } from './essensplanungGerichte';
import type { KiAenderung } from '../../../api/lib/essen-ki-model';

export type {
  KiAenderung,
  KiHinweis,
  KiMass,
  KiPruefung,
  KiRezept,
  KiRezeptZeile,
  KiUmrechnung,
  KiZutatWahl,
} from '../../../api/lib/essen-ki-model';

/** Helpers of the AI in a Planung (`docs/essensplanung.md`, „KI“). */

/**
 * What the page says when the AI did not answer: the server's message (e.g. „KI gerade nicht
 * verfügbar, bitte in etwa 30 Sekunden noch einmal versuchen“), else that the connection failed.
 */
export function kiFehlerText(error: unknown): string {
  return errorMessage(
    error,
    'Die KI hat nicht geantwortet. Prüfe deine Internetverbindung und versuche es noch einmal.'
  );
}

/** What taking over a proposed change does, e.g. „1 kg, nicht für vegetarisch“. */
export function aenderungText(aenderung: KiAenderung, abtropfgewicht = false): string {
  const teile: string[] = [];
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
  return teile.filter(Boolean).join(', ');
}

/** Rounds like the recipe import: a tenth below 10, whole numbers above, three places for kg and l. */
function runde(menge: number, einheit: GerichtEinheit): number {
  if (einheit === 'kg' || einheit === 'l') return Math.max(0.001, Math.round(menge * 1000) / 1000);
  return Math.max(0.1, menge < 10 ? Math.round(menge * 10) / 10 : Math.round(menge));
}

/** A line of the recipe preview as typed: amount as text, unit and note. */
export interface VorschauMenge {
  menge: string;
  einheit: GerichtEinheit;
  hinweis: string;
}

/**
 * Amount and unit of a preview line once an ingredient of `art` is chosen for it: kept when the
 * unit fits, pieces converted into grams with the weight per piece of the list; otherwise the
 * amount is emptied, the recipe's amount goes into the note and `neuEintragen` says the amount
 * must be typed again (never „6 Stück“ silently becoming 6 g).
 */
export function mengeFuerZutat(
  zeile: VorschauMenge,
  art: EssenEinheitenart,
  grammProStueck: number | null
): VorschauMenge & { neuEintragen: boolean } {
  const einheiten = EINHEITEN_JE_ART[art];
  const passt = einheiten.includes(zeile.einheit);
  const menge = leseMenge(zeile.menge);
  if (menge === null || Number.isNaN(menge))
    return { ...zeile, einheit: passt ? zeile.einheit : einheiten[0], neuEintragen: false };
  if (passt) return { ...zeile, neuEintragen: false };
  if (art === 'masse' && zeile.einheit === 'stueck' && grammProStueck !== null)
    return {
      ...zeile,
      menge: mengeFeld(runde(menge * grammProStueck, 'g')),
      einheit: 'g',
      neuEintragen: false,
    };
  const angabe = `${mengeFeld(menge)} ${einheitText(zeile.einheit)}`;
  return {
    menge: '',
    einheit: einheiten[0],
    hinweis: [angabe, zeile.hinweis].filter(Boolean).join(', ').slice(0, 100),
    neuEintragen: true,
  };
}

/** An amount typed in the preview, scaled by `faktor` (other people); text that is no number stays. */
export function skaliereMenge(text: string, faktor: number, einheit: GerichtEinheit): string {
  const menge = leseMenge(text);
  if (menge === null || Number.isNaN(menge)) return text;
  return mengeFeld(runde(menge * faktor, einheit));
}
