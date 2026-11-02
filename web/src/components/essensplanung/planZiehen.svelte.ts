import { zielPosition } from '../../lib/essensplanungPlan';
import type { Einplanung, PlanungMahlzeit } from '../../lib/types';
import { planeEin, verschiebe } from './planAktionen';
import type { PlanKontext } from './planKontext';

/**
 * Dragging in the plan (native drag and drop): a planned dish to another meal or place (with
 * Ctrl or Alt a copy), or a dish from the list of all dishes into a meal. The drag data of the
 * browser cannot be read while dragging over, so what is dragged is kept here.
 */

export type Gezogen =
  | { art: 'einplanung'; einplanung: Einplanung; name: string }
  | { art: 'gericht'; gerichtId: number; name: string };

export const ziehen = $state<{
  gezogen: Gezogen | null;
  /** The meal and the index (0-based, before that dish) a drop would go to. */
  ziel: { mahlzeitId: number; index: number } | null;
}>({ gezogen: null, ziel: null });

/** Starts dragging; the text is what other programs get, e.g. the name of the dish. */
export function starte(event: DragEvent, gezogen: Gezogen): void {
  ziehen.gezogen = gezogen;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('text/plain', gezogen.name);
}

export function beende(): void {
  ziehen.gezogen = null;
  ziehen.ziel = null;
}

/** A planned dish is copied with Ctrl (Windows, Linux) or Alt (macOS); a dish from the list always. */
function kopiert(event: DragEvent): boolean {
  return ziehen.gezogen?.art === 'gericht' || event.ctrlKey || event.altKey;
}

/** The index between the cards of a meal the pointer is over, from their middles. */
function indexBei(element: HTMLElement, y: number): number {
  const karten = [...element.querySelectorAll<HTMLElement>('[data-karte]')];
  const index = karten.findIndex((karte) => {
    const box = karte.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  return index < 0 ? karten.length : index;
}

/** Dragging over a meal: marks where the dish would go. */
export function ueber(event: DragEvent, mahlzeit: PlanungMahlzeit): void {
  if (!ziehen.gezogen) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = kopiert(event) ? 'copy' : 'move';
  const index = indexBei(event.currentTarget as HTMLElement, event.clientY);
  if (ziehen.ziel?.mahlzeitId !== mahlzeit.id || ziehen.ziel.index !== index)
    ziehen.ziel = { mahlzeitId: mahlzeit.id, index };
}

export function verlassen(event: DragEvent, mahlzeit: PlanungMahlzeit): void {
  const nach = event.relatedTarget as Node | null;
  if (nach && (event.currentTarget as HTMLElement).contains(nach)) return;
  if (ziehen.ziel?.mahlzeitId === mahlzeit.id) ziehen.ziel = null;
}

/** Drops into a meal: plans, moves or copies the dish there. */
export async function ablegen(
  event: DragEvent,
  kontext: PlanKontext,
  mahlzeit: PlanungMahlzeit
): Promise<void> {
  const gezogen = ziehen.gezogen;
  if (!gezogen) return;
  event.preventDefault();
  const index = ziehen.ziel?.mahlzeitId === mahlzeit.id ? ziehen.ziel.index : 0;
  const kopie = kopiert(event);
  beende();
  if (gezogen.art === 'gericht') {
    await planeEin(kontext, mahlzeit, gezogen.gerichtId, { position: index + 1 });
    return;
  }
  const { einplanung } = gezogen;
  const gleich = mahlzeit.einplanungen.some((e) => e.id === einplanung.id);
  const position = zielPosition(
    mahlzeit.einplanungen,
    index,
    gleich && !kopie ? einplanung.id : null
  );
  // Dropped where it was: nothing to do
  if (gleich && !kopie && mahlzeit.einplanungen[position - 1]?.id === einplanung.id) return;
  await verschiebe(kontext, einplanung, mahlzeit, position, kopie);
}
