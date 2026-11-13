import { MAX_ZEITBLOECKE_PRO_TAG } from './kurzbeschreibung';
import type { ZeitBlock, ZeitplanTag } from './kurzbeschreibung';

/**
 * The days to change. Until something was entered the page shows the days of the Aktion without
 * keeping them; the first change keeps them with the entries.
 */
export function ensureTage(kurz: { tage: ZeitplanTag[] }, shown: ZeitplanTag[]): ZeitplanTag[] {
  if (kurz.tage.length === 0) {
    kurz.tage = shown.map((tag) => ({ datum: tag.datum, bloecke: [] }));
  }
  return kurz.tage;
}

export type MoveResult = { kind: 'full'; datum: string } | { kind: 'moved'; block: ZeitBlock };

/**
 * Moves a block up or down; at the edge of a day it moves on to the day before or after
 * (`full` when that day is already full).
 */
export function moveBlock(
  days: ZeitplanTag[],
  tagIndex: number,
  index: number,
  delta: -1 | 1
): MoveResult {
  const from = days[tagIndex].bloecke;
  const target = index + delta;
  const crossing = target < 0 || target >= from.length;
  if (crossing && days[tagIndex + delta].bloecke.length >= MAX_ZEITBLOECKE_PRO_TAG) {
    return { kind: 'full', datum: days[tagIndex + delta].datum };
  }
  const [block] = from.splice(index, 1);
  if (target >= 0 && target <= from.length) {
    from.splice(target, 0, block);
  } else {
    const day = days[tagIndex + delta];
    if (delta < 0) day.bloecke.push(block);
    else day.bloecke.unshift(block);
  }
  return { kind: 'moved', block };
}

/** Drops the dragged block before `to.index` of a day; `false` and unchanged when that other day is full. */
export function dropBlock(
  days: ZeitplanTag[],
  from: { tagIndex: number; index: number },
  to: { tagIndex: number; index: number }
): boolean {
  const [block] = days[from.tagIndex].bloecke.splice(from.index, 1);
  const sameDay = from.tagIndex === to.tagIndex;
  const index = sameDay && to.index > from.index ? to.index - 1 : to.index;
  const target = days[to.tagIndex].bloecke;
  if (!sameDay && target.length >= MAX_ZEITBLOECKE_PRO_TAG) {
    days[from.tagIndex].bloecke.splice(from.index, 0, block);
    return false;
  }
  target.splice(index, 0, block);
  return true;
}
