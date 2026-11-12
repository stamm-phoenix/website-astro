import type { ProtokollPunkt } from './types';

/**
 * Whether an agenda item holds more than its title, so removing it asks first: text, an Aktion,
 * a date, tasks, dates, a project, open tasks or a sub-item with a title or content.
 */
export function punktHatInhalt(punkt: ProtokollPunkt): boolean {
  return Boolean(
    punkt.text.trim() ||
    punkt.aktion ||
    punkt.zeitraum ||
    punkt.aufgaben.length > 0 ||
    punkt.termine.length > 0 ||
    punkt.projekt ||
    punkt.offeneAufgaben.length > 0 ||
    punkt.unterpunkte.some((sub) => sub.titel.trim() || punktHatInhalt(sub))
  );
}
