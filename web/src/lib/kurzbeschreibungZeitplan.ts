// Placing the Zeitplan of the Kurzbeschreibung in columns (`kurzbeschreibungPdf.ts`). Pure
// geometry without jsPDF, so it can be unit-tested.
import { BRIEF_FUSS_SPACE, FOLGESEITE_TOP } from './abrechnungBriefPdf';
import { PAGE_HEIGHT } from './pdfBasis';

export const ZEITPLAN_GAP = 6;
export const ZEITPLAN_FONT = 8.5;
export const ZEITPLAN_LINE = 3.5;
export const ZEITPLAN_ROW_GAP = 0.9;
export const ZEITPLAN_HEADER = 7;

export interface ZeitplanItem {
  /** Index of the day. */
  tag: number;
  /** The day's heading, or a block with its wrapped text. */
  header: boolean;
  zeit: string;
  lines: string[];
  height: number;
}

export interface PlacedItem {
  item: ZeitplanItem;
  /** The day's heading again, above a block that continues a day in a new column. */
  continued: boolean;
  /** Counted from the page the Zeitplan starts on, which is 1. */
  page: number;
  column: number;
  y: number;
}

/**
 * Places the items of the Zeitplan in columns, newspaper style: down the first column, then the
 * next, then on to a new page. A day's heading stays with its first block, and a day that goes on
 * in a new column gets its heading again. `limit` caps the height of the first page's columns,
 * to balance them; `null` when anything does not fit within the given pages.
 */
export function placeZeitplan(
  items: ZeitplanItem[],
  columns: number,
  firstTop: number,
  limit: number,
  maxPages = Infinity
): PlacedItem[] | null {
  const bottom = PAGE_HEIGHT - BRIEF_FUSS_SPACE - 2;
  const placed: PlacedItem[] = [];
  let page = 1;
  let column = 0;
  let top = firstTop;
  let end = Math.min(bottom, firstTop + limit);
  let y = top;
  const nextColumn = (): boolean => {
    column++;
    if (column >= columns) {
      if (page >= maxPages) return false;
      page++;
      column = 0;
      top = FOLGESEITE_TOP + 4;
      end = bottom;
    }
    y = top;
    return true;
  };
  for (const [index, item] of items.entries()) {
    const next = items[index + 1];
    // A heading needs room for its first block below it
    const needed = item.header && next && !next.header ? item.height + next.height : item.height;
    const continues = (): boolean => !item.header && y === top;
    const height = (): number => needed + (continues() ? ZEITPLAN_HEADER : 0);
    // On to the next column; on the first page, whose columns start lower, on to the next
    // page if need be
    while (y + height() > end && (y > top || page === 1)) {
      if (!nextColumn()) return null;
    }
    // Taller than a whole page: fails a try within limits, otherwise drawn anyway
    if (y + height() > end && maxPages !== Infinity) return null;
    const continued = continues();
    if (continued) y += ZEITPLAN_HEADER;
    placed.push({ item, continued, page, column, y });
    y += item.height;
  }
  return placed;
}
