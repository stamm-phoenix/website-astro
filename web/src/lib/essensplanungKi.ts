import { errorMessage } from './api';
import { mengeText } from '../../../api/lib/essen-gerichte-model';
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
