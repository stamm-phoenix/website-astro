import { MAX_PUNKTE, MAX_UNTERPUNKTE, punktNummer } from './protokollEditor';
import type { ProtokollPunkt } from './types';

/**
 * The agenda as one list with indentation, as the outline shows it: a sub-item belongs to the
 * nearest item above it at level 0.
 */
export interface ReihenfolgeZeile {
  punkt: ProtokollPunkt;
  ebene: 0 | 1;
  nummer: string;
}

export function zeilenOf(punkte: ProtokollPunkt[]): ReihenfolgeZeile[] {
  return punkte.flatMap((punkt, index) => [
    { punkt, ebene: 0 as const, nummer: punktNummer(index) },
    ...punkt.unterpunkte.map((sub, subIndex) => ({
      punkt: sub,
      ebene: 1 as const,
      nummer: punktNummer(index, subIndex),
    })),
  ]);
}

/** Rows moved together from `from`: an item with its sub-items, or one sub-item. */
export function blockLength(zeilen: ReihenfolgeZeile[], from: number): number {
  if (zeilen[from]?.ebene !== 0) return 1;
  let end = from + 1;
  while (zeilen[end]?.ebene === 1) end++;
  return end - from;
}

/**
 * The level the block from `from` takes when it is dropped before row `to` of the remaining
 * rows, as close to `wunsch` as allowed, or `null` if it cannot go there:
 * - the first row is an item, never a sub-item;
 * - in the middle of sub-items only a sub-item fits (an item there would take over the
 *   sub-items below it);
 * - an item with sub-items stays an item, there is only one level below.
 */
export function zielEbene(
  zeilen: ReihenfolgeZeile[],
  from: number,
  to: number,
  wunsch: 0 | 1
): 0 | 1 | null {
  const length = blockLength(zeilen, from);
  const rest = [...zeilen.slice(0, from), ...zeilen.slice(from + length)];
  const erlaubt = new Set<0 | 1>([0, 1]);
  if (to === 0) erlaubt.delete(1);
  if (rest[to]?.ebene === 1) erlaubt.delete(0);
  if (length > 1) erlaubt.delete(1);
  if (erlaubt.has(wunsch)) return wunsch;
  return erlaubt.size > 0 ? ([...erlaubt][0] ?? null) : null;
}

export interface Verschiebung {
  punkte: ProtokollPunkt[];
  /** The new number of the moved item, e.g. „2b.“. */
  nummer: string;
}

/**
 * Moves the block from `from` before row `to` of the remaining rows at level `ebene`. Returns
 * the new agenda, or `null` if the move breaks a rule of `zielEbene` or a limit
 * (`MAX_PUNKTE`, `MAX_UNTERPUNKTE`). The items are copied; they keep their IDs and content.
 */
export function verschiebe(
  punkte: ProtokollPunkt[],
  from: number,
  to: number,
  ebene: 0 | 1
): Verschiebung | null {
  const zeilen = zeilenOf(punkte);
  if (from < 0 || from >= zeilen.length) return null;
  if (zielEbene(zeilen, from, to, ebene) !== ebene) return null;
  const length = blockLength(zeilen, from);
  const block = zeilen.slice(from, from + length);
  const rest = [...zeilen.slice(0, from), ...zeilen.slice(from + length)];
  if (to < 0 || to > rest.length) return null;
  const moved: ReihenfolgeZeile[] = [{ ...block[0], ebene }, ...block.slice(1)];
  const ordered = [...rest.slice(0, to), ...moved, ...rest.slice(to)];

  const result: ProtokollPunkt[] = [];
  let nummer = '';
  for (const zeile of ordered) {
    const isMoved = zeile.punkt.id === block[0].punkt.id;
    if (zeile.ebene === 0) {
      result.push({ ...zeile.punkt, unterpunkte: [] });
      if (isMoved) nummer = punktNummer(result.length - 1);
    } else {
      const parent = result.at(-1);
      if (!parent) return null;
      parent.unterpunkte.push({ ...zeile.punkt, unterpunkte: [] });
      if (isMoved) nummer = punktNummer(result.length - 1, parent.unterpunkte.length - 1);
    }
  }
  if (result.length > MAX_PUNKTE) return null;
  if (result.some((p) => p.unterpunkte.length > MAX_UNTERPUNKTE)) return null;
  return { punkte: result, nummer };
}

/** Moves one row up or down among its siblings (an item with its sub-items). */
export function verschiebeSchritt(
  punkte: ProtokollPunkt[],
  from: number,
  delta: -1 | 1
): Verschiebung | null {
  const zeilen = zeilenOf(punkte);
  const zeile = zeilen[from];
  if (!zeile) return null;
  if (zeile.ebene === 1) {
    const neighbor = zeilen[from + delta];
    if (neighbor?.ebene !== 1) return null;
    // Without the moved row, the next sibling takes its place
    return verschiebe(punkte, from, delta < 0 ? from - 1 : from + 1, 1);
  }
  const starts = zeilen.flatMap((z, index) => (z.ebene === 0 ? [index] : []));
  const at = starts.indexOf(from);
  const neighbor = starts[at + delta];
  if (neighbor === undefined) return null;
  if (delta < 0) return verschiebe(punkte, from, neighbor, 0);
  const length = blockLength(zeilen, from);
  return verschiebe(punkte, from, neighbor - length + blockLength(zeilen, neighbor), 0);
}

/** An item without sub-items becomes the last sub-item of the item above it. */
export function alsUnterpunkt(punkte: ProtokollPunkt[], from: number): Verschiebung | null {
  const zeilen = zeilenOf(punkte);
  if (zeilen[from]?.ebene !== 0 || blockLength(zeilen, from) > 1) return null;
  return verschiebe(punkte, from, from, 1);
}

/** A sub-item becomes an item right after its parent and the parent's other sub-items. */
export function alsHauptpunkt(punkte: ProtokollPunkt[], from: number): Verschiebung | null {
  const zeilen = zeilenOf(punkte);
  if (zeilen[from]?.ebene !== 1) return null;
  let end = from + 1;
  while (zeilen[end]?.ebene === 1) end++;
  // Index among the remaining rows: the moved row is gone
  return verschiebe(punkte, from, end - 1, 0);
}

/** The drag handle of an agenda item in the editor, handed down to every item. */
export interface Griff {
  down: (event: PointerEvent, id: string) => void;
  key: (event: KeyboardEvent, id: string) => void;
}
