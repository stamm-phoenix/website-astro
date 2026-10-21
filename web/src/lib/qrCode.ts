// QR codes for links and texts (Leitendenbereich → QR-Code), drawn in the browser without any
// external service or redirect. `qrcode-generator` only computes the modules; shapes, colours
// and the logo in the middle are drawn here on a canvas.
import qrcode from 'qrcode-generator';

// The library encodes text as Latin-1 by default; links and texts with umlauts need UTF-8
qrcode.stringToBytes = (text: string): number[] => Array.from(new TextEncoder().encode(text));

export const QR_FORMEN = [
  { value: 'quadrate', label: 'Quadrate' },
  { value: 'punkte', label: 'Punkte' },
  { value: 'abgerundet', label: 'Abgerundet' },
] as const;
export type QrForm = (typeof QR_FORMEN)[number]['value'];

export const QR_ECKEN = [
  { value: 'eckig', label: 'Eckig' },
  { value: 'abgerundet', label: 'Abgerundet' },
  { value: 'rund', label: 'Rund' },
] as const;
export type QrEcken = (typeof QR_ECKEN)[number]['value'];

/** Colours to pick with one click: DPSG blue and red, the colours of the Stufen, black. */
export const QR_FARBEN = [
  { value: '#003056', label: 'DPSG-Blau' },
  { value: '#810a1a', label: 'DPSG-Rot' },
  { value: '#000000', label: 'Schwarz' },
  { value: '#ff6400', label: 'Wölflinge' },
  { value: '#2f53a7', label: 'Jungpfadfinder' },
  { value: '#00823c', label: 'Pfadfinder' },
  { value: '#cc1f2f', label: 'Rover' },
] as const;

/**
 * Logos for the middle of the code: the Lilie of the Stamm and the new Phoenix of the hero on
 * the start page. `aspect` (width / height) is kept here, as browsers may report no natural
 * size for an SVG with only a viewBox.
 */
export const QR_LOGOS = [
  { value: 'lilie', label: 'Lilie', src: '/stammeslilie.png', aspect: 367 / 481 },
  { value: 'phoenix', label: 'Phoenix', src: '/Logo_Phoenix_Neu_Vector.svg', aspect: 1000 / 1053 },
] as const;
export type QrLogo = 'ohne' | (typeof QR_LOGOS)[number]['value'];

export const QR_GROESSEN = [512, 1024, 2048] as const;

/** Quiet zone around the code in modules, as the standard asks for. */
const RAND = 4;
/** Smallest module in the PNG; a decoder missed version 39 codes at 5.7 px per module. */
const MIN_MODUL_PIXEL = 6;

/** Smallest PNG size in pixels for a code of `size` modules. */
export function qrMindestPixel(size: number): number {
  return (size + 2 * RAND) * MIN_MODUL_PIXEL;
}

/** Share of the code's width the logo may cover; error correction H restores up to 30 %. */
const LOGO_ANTEIL = 0.22;

export interface QrOptionen {
  text: string;
  vordergrund: string;
  hintergrund: string;
  transparent: boolean;
  form: QrForm;
  ecken: QrEcken;
  logo: QrLogo;
}

/** A loaded logo with the aspect ratio of its file. */
export interface QrLogoBild {
  image: HTMLImageElement;
  aspect: number;
}

export interface QrMatrix {
  size: number;
  isDark: (row: number, col: number) => boolean;
}

/** Thrown when the text does not fit into a QR code. */
export class QrZuLangError extends Error {
  constructor() {
    super('Der Text ist zu lang für einen QR-Code.');
    this.name = 'QrZuLangError';
  }
}

/**
 * The modules of the QR code; with a logo the highest error correction, so the covered
 * modules can be restored by the scanner.
 */
export function qrMatrix(text: string, mitLogo: boolean): QrMatrix {
  const qr = qrcode(0, mitLogo ? 'H' : 'M');
  qr.addData(text);
  try {
    qr.make();
  } catch {
    throw new QrZuLangError();
  }
  return { size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

/** Whether a module belongs to one of the three finder patterns (7×7 in the corners). */
function inFinder(row: number, col: number, size: number): boolean {
  const near = (value: number): boolean => value < 7;
  const far = (value: number): boolean => value >= size - 7;
  return (near(row) && near(col)) || (near(row) && far(col)) || (far(row) && near(col));
}

/**
 * Centres of the 5×5 alignment patterns (from version 2 on), as in the QR standard; the formula
 * is the one of Project Nayuki's QR code generator.
 */
export function alignmentCenters(size: number): [number, number][] {
  const version = (size - 17) / 4;
  if (version < 2) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  const last = positions.length - 1;
  const centers: [number, number][] = [];
  positions.forEach((row, i) =>
    positions.forEach((col, j) => {
      // The corners with a finder pattern have none
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      centers.push([row, col]);
    })
  );
  return centers;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function kontrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Hints when the colours make the code hard or impossible to scan. */
export function farbHinweis(optionen: QrOptionen): string | null {
  const hintergrund = optionen.transparent ? '#ffffff' : optionen.hintergrund;
  if (relativeLuminance(optionen.vordergrund) > relativeLuminance(hintergrund)) {
    return 'Der Code ist heller als der Hintergrund. Viele Scanner lesen nur dunkle Codes auf hellem Grund.';
  }
  if (kontrast(optionen.vordergrund, hintergrund) < 4) {
    return 'Geringer Kontrast – der Code wird eventuell nicht erkannt.';
  }
  return null;
}

/** A rectangle with rounded corners as path; `radius` is clamped to half the shorter side. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

function drawModules(
  ctx: CanvasRenderingContext2D,
  matrix: QrMatrix,
  form: QrForm,
  cell: number,
  offset: number,
  skip: (row: number, col: number) => boolean
): void {
  ctx.beginPath();
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.isDark(row, col) || skip(row, col)) continue;
      const x = offset + col * cell;
      const y = offset + row * cell;
      if (form === 'punkte') {
        ctx.moveTo(x + cell * 0.95, y + cell / 2);
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.45, 0, 2 * Math.PI);
      } else if (form === 'abgerundet') {
        roundedRect(ctx, x, y, cell, cell, cell * 0.35);
      } else {
        // Slightly larger, so neighbouring squares show no hairline gaps when anti-aliased
        ctx.rect(x, y, cell + 0.5, cell + 0.5);
      }
    }
  }
  ctx.fill();
}

/**
 * A finder (7 modules) or alignment pattern (5 modules) as one shape: a ring one module wide
 * and a solid centre, so scanners find it whatever form the other modules have.
 */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  modules: 7 | 5,
  ecken: QrEcken,
  cell: number
): void {
  const radius = (side: number): number =>
    ecken === 'rund' ? side / 2 : ecken === 'abgerundet' ? side * 0.28 : 0;
  const outer = modules * cell;
  const inner = (modules - 2) * cell;
  const centre = (modules - 4) * cell;
  ctx.beginPath();
  roundedRect(ctx, x, y, outer, outer, radius(outer));
  // The second shape cuts out the inside (evenodd)
  roundedRect(ctx, x + cell, y + cell, inner, inner, radius(inner));
  ctx.fill('evenodd');
  ctx.beginPath();
  roundedRect(ctx, x + 2 * cell, y + 2 * cell, centre, centre, radius(centre));
  ctx.fill();
}

/**
 * Draws the QR code on a square canvas of `pixels` side length, with the quiet zone around it.
 * `logo` is the image of `optionen.logo`, drawn in the middle; null leaves the middle as code.
 */
export function drawQrCode(
  canvas: HTMLCanvasElement,
  matrix: QrMatrix,
  optionen: QrOptionen,
  pixels: number,
  logo: QrLogoBild | null
): void {
  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, pixels, pixels);
  if (!optionen.transparent) {
    ctx.fillStyle = optionen.hintergrund;
    ctx.fillRect(0, 0, pixels, pixels);
  }

  const cell = pixels / (matrix.size + 2 * RAND);
  const offset = RAND * cell;

  // Area kept free for the logo, in whole modules around the centre
  const showLogo = optionen.logo !== 'ohne' && logo !== null;
  const logoModules = Math.ceil((matrix.size * LOGO_ANTEIL) / 2) * 2 + 1;
  const logoStart = Math.floor((matrix.size - logoModules) / 2);
  const inLogo = (row: number, col: number): boolean =>
    showLogo &&
    row >= logoStart &&
    row < logoStart + logoModules &&
    col >= logoStart &&
    col < logoStart + logoModules;
  // Alignment patterns under the logo are left out like the other modules there
  const alignments = alignmentCenters(matrix.size).filter(
    ([row, col]) =>
      !showLogo ||
      row + 2 < logoStart ||
      row - 2 >= logoStart + logoModules ||
      col + 2 < logoStart ||
      col - 2 >= logoStart + logoModules
  );
  const inAlignment = (row: number, col: number): boolean =>
    alignments.some(([r, c]) => Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2);

  ctx.fillStyle = optionen.vordergrund;
  drawModules(
    ctx,
    matrix,
    optionen.form,
    cell,
    offset,
    (row, col) => inFinder(row, col, matrix.size) || inLogo(row, col) || inAlignment(row, col)
  );
  const last = matrix.size - 7;
  for (const [row, col] of [
    [0, 0],
    [0, last],
    [last, 0],
  ]) {
    drawPattern(ctx, offset + col * cell, offset + row * cell, 7, optionen.ecken, cell);
  }
  for (const [row, col] of alignments) {
    const x = offset + (col - 2) * cell;
    const y = offset + (row - 2) * cell;
    drawPattern(ctx, x, y, 5, optionen.ecken, cell);
  }

  if (showLogo && logo) {
    const box = logoModules * cell;
    const boxX = offset + logoStart * cell;
    const inner = box - 2 * cell * 0.6;
    // Fit the logo into the free square, keeping its aspect ratio
    const width = logo.aspect >= 1 ? inner : inner * logo.aspect;
    const height = logo.aspect >= 1 ? inner / logo.aspect : inner;
    ctx.drawImage(logo.image, boxX + (box - width) / 2, boxX + (box - height) / 2, width, height);
  }
}

/** File name of the PNG from the link's host or the start of the text. */
export function qrDateiname(text: string): string {
  let name = text.trim();
  try {
    const url = new URL(name);
    name = `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    // Not a link: use the text itself
  }
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return `QR-Code ${cleaned || 'Stamm Phoenix'}.png`;
}

/** Whether the text looks like a web address without `https://`, e.g. „stamm-phoenix.de“. */
export function fehltProtokoll(text: string): boolean {
  const value = text.trim();
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value) && !/^[a-z]+:/i.test(value);
}
