import { enhance, fullFrame, outputSize, warpPerspective } from './belegScan';
import type { Pixels, Point, Quad, ScanMode } from './belegScan';

/**
 * The small image editor of the receipt form: rotating and mirroring the photo, cropping it to
 * the receipt and evening out its colours. Pure functions on pixel arrays; the canvas glue is
 * in `belegPhotoDraft.svelte.ts`.
 */

/** `original`: the colours of the photo as they are, e.g. for a scan of the phone. */
export type FotoFarben = ScanMode | 'original';

export type Drehung = 'links' | 'rechts';
export type Spiegelung = 'horizontal' | 'vertikal';
export type Ausrichtung = Drehung | Spiegelung;

/** Rotates by a quarter turn, `rechts` clockwise. */
export function drehen(pixels: Pixels, richtung: Drehung): Pixels {
  const { data, width, height } = pixels;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The new picture is `height` wide
      const nx = richtung === 'rechts' ? height - 1 - y : y;
      const ny = richtung === 'rechts' ? x : width - 1 - x;
      const from = (y * width + x) * 4;
      const to = (ny * height + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { data: out, width: height, height: width };
}

/** Mirrors left to right (`horizontal`) or top to bottom (`vertikal`). */
export function spiegeln(pixels: Pixels, achse: Spiegelung): Pixels {
  const { data, width, height } = pixels;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = achse === 'horizontal' ? width - 1 - x : x;
      const ny = achse === 'vertikal' ? height - 1 - y : y;
      const from = (y * width + x) * 4;
      const to = (ny * width + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { data: out, width, height };
}

/** Rotates or mirrors the picture. */
export function ausrichten(pixels: Pixels, schritt: Ausrichtung): Pixels {
  return schritt === 'links' || schritt === 'rechts'
    ? drehen(pixels, schritt)
    : spiegeln(pixels, schritt);
}

/** Where a point of a `width` × `height` picture lands when it is rotated or mirrored. */
export function punktAusrichten(
  point: Point,
  width: number,
  height: number,
  schritt: Ausrichtung
): Point {
  switch (schritt) {
    case 'rechts':
      return { x: height - point.y, y: point.x };
    case 'links':
      return { x: point.y, y: width - point.x };
    case 'horizontal':
      return { x: width - point.x, y: point.y };
    case 'vertikal':
      return { x: point.x, y: height - point.y };
  }
}

/**
 * Which old corner becomes top left, top right, bottom right, bottom left: the corners of a crop
 * are kept in this order as seen, so the cropped receipt turns with the picture.
 */
const ECKEN_NACH: Record<Ausrichtung, [number, number, number, number]> = {
  rechts: [3, 0, 1, 2],
  links: [1, 2, 3, 0],
  horizontal: [1, 0, 3, 2],
  vertikal: [3, 2, 1, 0],
};

/** Moves the crop corners along when the picture is rotated or mirrored. */
export function eckenAusrichten(
  quad: Quad,
  width: number,
  height: number,
  schritt: Ausrichtung
): Quad {
  return ECKEN_NACH[schritt].map((i) => punktAusrichten(quad[i], width, height, schritt)) as Quad;
}

/**
 * Moves the corners outwards by `anteil` of the receipt's longest edge, across and along it,
 * within the picture: a found receipt keeps a margin, so no letter at its edge is cut, also
 * where curled paper leaves the straight edge the corners make.
 */
export function eckenErweitern(quad: Quad, width: number, height: number, anteil: number): Quad {
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = quad.reduce((sum, p) => sum + p.y, 0) / 4;
  const longest = Math.max(
    ...quad.map((p, i) => Math.hypot(quad[(i + 1) % 4].x - p.x, quad[(i + 1) % 4].y - p.y))
  );
  const margin = longest * anteil;
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return quad.map((p) => ({
    x: clamp(p.x + Math.sign(p.x - cx) * margin, width),
    y: clamp(p.y + Math.sign(p.y - cy) * margin, height),
  })) as Quad;
}

/** The turns that make the text upright, from the degrees clockwise the check names. */
export function drehungen(grad: 0 | 90 | 180 | 270): Drehung[] {
  if (grad === 90) return ['rechts'];
  if (grad === 180) return ['rechts', 'rechts'];
  if (grad === 270) return ['links'];
  return [];
}

/**
 * Whether hand-placed corners sit exactly on the corners of the picture, i.e. cut nothing away.
 * Unlike `isFullFrame`, which tolerates the edges an automatic detection leaves, even a thin cut
 * by hand counts.
 */
export function ganzesBild(quad: Quad, width: number, height: number): boolean {
  return fullFrame(width, height).every(
    (corner, i) => Math.abs(corner.x - quad[i].x) < 0.5 && Math.abs(corner.y - quad[i].y) < 0.5
  );
}

/**
 * The edited photo: the receipt cut out along `quad` and straightened (or the whole picture
 * without one), then with evened-out colours unless `farben` is `original`.
 */
export function bildBearbeiten(
  bild: Pixels,
  quad: Quad | null,
  farben: FotoFarben,
  maxEdge: number
): Pixels {
  let cropped = bild;
  if (quad) {
    const size = outputSize(quad, maxEdge);
    cropped = warpPerspective(bild, quad, size.width, size.height);
  }
  return farben === 'original' ? cropped : enhance(cropped, farben);
}
