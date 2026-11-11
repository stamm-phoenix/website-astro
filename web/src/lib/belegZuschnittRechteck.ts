import type { Point, Quad } from './belegScan';

/** An axis-parallel crop in image pixels, from the left/top to the right/bottom edge. */
export interface Rechteck {
  links: number;
  oben: number;
  rechts: number;
  unten: number;
}

/**
 * What is pulled: a corner (`nw`, `ne`, `se`, `sw`), a side (`n`, `e`, `s`, `w`) or the
 * whole rectangle (`mitte`), which keeps its size.
 */
export type Griff = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'mitte';

/** Smallest side as a share of the longer image side, so the crop never collapses. */
const MINDEST_ANTEIL = 0.05;

export function mindestGroesse(width: number, height: number): number {
  return Math.max(width, height) * MINDEST_ANTEIL;
}

/** The smallest rectangle around the corners, inside the image. */
export function rechteckUm(quad: Quad, width: number, height: number): Rechteck {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const rechteck = {
    links: Math.max(0, Math.min(...xs)),
    oben: Math.max(0, Math.min(...ys)),
    rechts: Math.min(width, Math.max(...xs)),
    unten: Math.min(height, Math.max(...ys)),
  };
  // Corners lying on one line would leave nothing; then the whole image is the start
  const min = mindestGroesse(width, height);
  if (rechteck.rechts - rechteck.links < min || rechteck.unten - rechteck.oben < min)
    return { links: 0, oben: 0, rechts: width, unten: height };
  return rechteck;
}

/** Corners in the order of a quad: top left, top right, bottom right, bottom left. */
export function eckenVon(r: Rechteck): Quad {
  return [
    { x: r.links, y: r.oben },
    { x: r.rechts, y: r.oben },
    { x: r.rechts, y: r.unten },
    { x: r.links, y: r.unten },
  ];
}

/** Whether the corners form an axis-parallel rectangle, e.g. one made in this mode. */
export function istRechteck(quad: Quad): boolean {
  const [a, b, c, d] = quad;
  const gleich = (u: number, v: number) => Math.abs(u - v) < 0.5;
  return gleich(a.y, b.y) && gleich(c.y, d.y) && gleich(a.x, d.x) && gleich(b.x, c.x);
}

/** Where a handle sits, for drawing it. */
export function griffPunkt(r: Rechteck, griff: Exclude<Griff, 'mitte'>): Point {
  const mitteX = (r.links + r.rechts) / 2;
  const mitteY = (r.oben + r.unten) / 2;
  const x = griff.includes('w') ? r.links : griff.includes('e') ? r.rechts : mitteX;
  const y = griff.startsWith('n') ? r.oben : griff.startsWith('s') ? r.unten : mitteY;
  return { x, y };
}

/**
 * The rectangle after pulling a handle by `dx`/`dy` from where it was at the start. Pulled
 * edges stay inside the image and at least `mindestGroesse` apart; a moved rectangle keeps
 * its size and stops at the image edge.
 */
export function ziehen(
  start: Rechteck,
  griff: Griff,
  dx: number,
  dy: number,
  width: number,
  height: number
): Rechteck {
  if (griff === 'mitte') {
    const breite = start.rechts - start.links;
    const hoehe = start.unten - start.oben;
    const links = Math.min(width - breite, Math.max(0, start.links + dx));
    const oben = Math.min(height - hoehe, Math.max(0, start.oben + dy));
    return { links, oben, rechts: links + breite, unten: oben + hoehe };
  }
  const min = mindestGroesse(width, height);
  const r = { ...start };
  if (griff.includes('w')) r.links = Math.min(start.rechts - min, Math.max(0, start.links + dx));
  if (griff.includes('e'))
    r.rechts = Math.max(start.links + min, Math.min(width, start.rechts + dx));
  if (griff.startsWith('n')) r.oben = Math.min(start.unten - min, Math.max(0, start.oben + dy));
  if (griff.startsWith('s'))
    r.unten = Math.max(start.oben + min, Math.min(height, start.unten + dy));
  return r;
}

/** `frei`: each corner on its own, for a receipt photographed at an angle. */
export type ZuschnittArt = 'frei' | 'rechteck';
