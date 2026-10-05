/**
 * Scan function for receipt photos, like the document scanners of phone camera apps: find the
 * receipt, straighten it, cut away the background and even out the lighting.
 *
 * Deliberately no generative AI: every output pixel is computed from the photo, nothing is
 * redrawn or invented. The functions work on plain pixel arrays, the canvas glue is in
 * `scanBelegPhoto`.
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners of the receipt: top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point];

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ScanMode = 'farbe' | 'graustufen';

/** Edge of the copy used for finding the receipt; enough for its outline, fast to search. */
const DETECT_EDGE = 320;
/** Below this share of the photo the found area is probably not the receipt. */
const MIN_RECEIPT_AREA = 0.12;
/** Above this share the photo already shows only the receipt, e.g. a scan of the phone. */
const FULL_FRAME_AREA = 0.9;
/** Size of the blocks for estimating the paper colour; larger than letters, smaller than shadows. */
const BACKGROUND_BLOCK = 48;

export function fullFrame(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

export function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Whether the quad covers (nearly) the whole photo, i.e. there is nothing to cut away. */
export function isFullFrame(quad: Quad, width: number, height: number): boolean {
  return quadArea(quad) >= FULL_FRAME_AREA * width * height;
}

function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

export function toGray(pixels: Pixels): Uint8Array {
  const gray = new Uint8Array(pixels.width * pixels.height);
  for (let p = 0; p < gray.length; p++) gray[p] = luminance(pixels.data, p * 4);
  return gray;
}

/** Threshold that best separates dark and bright pixels (Otsu's method). */
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of gray) histogram[value]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Mean over a (2r+1)² square, computed separably. */
export function boxBlur(gray: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const horizontal = new Float32Array(gray.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    let count = 0;
    for (let x = -r; x < width; x++) {
      if (x + r < width) {
        sum += gray[y * width + x + r];
        count++;
      }
      if (x - r - 1 >= 0) {
        sum -= gray[y * width + x - r - 1];
        count--;
      }
      if (x >= 0) horizontal[y * width + x] = sum / count;
    }
  }
  const out = new Uint8Array(gray.length);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = -r; y < height; y++) {
      if (y + r < height) {
        sum += horizontal[(y + r) * width + x];
        count++;
      }
      if (y - r - 1 >= 0) {
        sum -= horizontal[(y - r - 1) * width + x];
        count--;
      }
      if (y >= 0) out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

/**
 * Finds the receipt as the largest bright area and returns its corners, or null if there is
 * no clear candidate. Works for paper on a darker background; for everything else the corners
 * are adjusted by hand.
 */
export function detectReceipt(source: Uint8Array, width: number, height: number): Quad | null {
  // Blur first, so lines of print don't cut the paper into pieces
  const radius = Math.max(2, Math.round(Math.max(width, height) / 80));
  const gray = boxBlur(source, width, height, radius);
  const threshold = otsuThreshold(gray);
  const visited = new Uint8Array(gray.length);
  const queue = new Int32Array(gray.length);
  let best: number[] | null = null;
  let bestSize = 0;

  for (let start = 0; start < gray.length; start++) {
    if (visited[start] || gray[start] <= threshold) continue;
    // Breadth-first search over the bright pixels connected to `start`
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    // Extremes for the corners: min/max of x+y and x−y
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    const corners = [0, 0, 0, 0];
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = (p - x) / width;
      const s = x + y;
      const d = x - y;
      if (s < minSum) [minSum, corners[0]] = [s, p];
      if (d > maxDiff) [maxDiff, corners[1]] = [d, p];
      if (s > maxSum) [maxSum, corners[2]] = [s, p];
      if (d < minDiff) [minDiff, corners[3]] = [d, p];
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && !visited[n] && gray[n] > threshold) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      best = [...corners];
    }
  }

  if (!best || bestSize < MIN_RECEIPT_AREA * gray.length) return null;
  const quad = best.map((p) => {
    const x = p % width;
    return { x: x + 0.5, y: (p - x) / width + 0.5 };
  }) as Quad;
  if (quadArea(quad) < MIN_RECEIPT_AREA * width * height) return null;
  // Blurring rounds the corners off; better a sliver of table than a cut-off receipt
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = quad.reduce((sum, p) => sum + p.y, 0) / 4;
  return quad.map(({ x, y }) => {
    const length = Math.hypot(x - cx, y - cy) || 1;
    const grow = radius * 0.5;
    return {
      x: Math.min(width, Math.max(0, x + ((x - cx) / length) * grow)),
      y: Math.min(height, Math.max(0, y + ((y - cy) / length) * grow)),
    };
  }) as Quad;
}

/** Width and height of the straightened receipt, at most `maxEdge` on the long side. */
export function outputSize(quad: Quad, maxEdge: number): { width: number; height: number } {
  const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2]));
  const height = Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2]));
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Solves `a · x = b` by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-12) throw new Error('Degenerate quad');
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Homography mapping the corners of the output rectangle to `quad`, as
 * `[a, b, c, d, e, f, g, h]` with x' = (ax + by + c) / (gx + hy + 1), y' = (dx + ey + f) / (…).
 */
export function homography(quad: Quad, width: number, height: number): number[] {
  const from = fullFrame(width, height);
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = quad[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  return solve(a, b);
}

/** Straightens the area inside `quad` into a rectangle of the given size (bilinear sampling). */
export function warpPerspective(source: Pixels, quad: Quad, width: number, height: number): Pixels {
  const [a, b, c, d, e, f, g, h] = homography(quad, width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = source;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const w = g * cx + h * cy + 1;
      const sx = Math.min(sw - 1, Math.max(0, (a * cx + b * cy + c) / w - 0.5));
      const sy = Math.min(sh - 1, Math.max(0, (d * cx + e * cy + f) / w - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = data[(y0 * sw + x0) * 4 + ch] * (1 - fx) + data[(y0 * sw + x1) * 4 + ch] * fx;
        const bottom =
          data[(y1 * sw + x0) * 4 + ch] * (1 - fx) + data[(y1 * sw + x1) * 4 + ch] * fx;
        out[o + ch] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/**
 * Colour of the paper per block: the brightest tenth of each block, which is the paper and
 * not the print. Returns a grid of RGB values, smoothed with its neighbours.
 */
export function estimatePaper(
  pixels: Pixels,
  block = BACKGROUND_BLOCK
): { grid: Float32Array; columns: number; rows: number } {
  const columns = Math.max(1, Math.ceil(pixels.width / block));
  const rows = Math.max(1, Math.ceil(pixels.height / block));
  const raw = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const values: number[] = [];
      const yEnd = Math.min(pixels.height, (row + 1) * block);
      const xEnd = Math.min(pixels.width, (column + 1) * block);
      for (let y = row * block; y < yEnd; y += 2) {
        for (let x = column * block; x < xEnd; x += 2) values.push((y * pixels.width + x) * 4);
      }
      values.sort((i, j) => luminance(pixels.data, j) - luminance(pixels.data, i));
      const bright = values.slice(0, Math.max(1, Math.ceil(values.length / 10)));
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (const i of bright) sum += pixels.data[i + ch];
        raw[(row * columns + column) * 3 + ch] = sum / bright.length;
      }
    }
  }
  // Smooth with the 3×3 neighbourhood so block borders don't show
  const grid = new Float32Array(raw.length);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const r = row + dy;
            const c = column + dx;
            if (r < 0 || r >= rows || c < 0 || c >= columns) continue;
            sum += raw[(r * columns + c) * 3 + ch];
            count++;
          }
        }
        grid[(row * columns + column) * 3 + ch] = sum / count;
      }
    }
  }
  return { grid, columns, rows };
}

/**
 * Evens out the lighting: divides every pixel by the paper colour around it (removes shadows,
 * colour casts and overexposure gradients), then stretches the contrast so the paper is white
 * and the print dark. `graustufen` drops the colour.
 */
export function enhance(pixels: Pixels, mode: ScanMode, block = BACKGROUND_BLOCK): Pixels {
  const { grid, columns, rows } = estimatePaper(pixels, block);
  const out = new Uint8ClampedArray(pixels.data.length);
  const sample = (gx: number, gy: number, ch: number): number => {
    const x = Math.min(columns - 1, Math.max(0, gx));
    const y = Math.min(rows - 1, Math.max(0, gy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(columns - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const at = (c: number, r: number): number => grid[(r * columns + c) * 3 + ch];
    return (
      (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
      (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
    );
  };

  const normalized = new Float32Array(pixels.width * pixels.height * 3);
  const histogram = new Array<number>(256).fill(0);
  for (let y = 0; y < pixels.height; y++) {
    const gy = (y + 0.5) / block - 0.5;
    for (let x = 0; x < pixels.width; x++) {
      const gx = (x + 0.5) / block - 0.5;
      const p = y * pixels.width + x;
      let lum = 0;
      for (let ch = 0; ch < 3; ch++) {
        const paper = Math.max(24, sample(gx, gy, ch));
        const value = Math.min(1, pixels.data[p * 4 + ch] / paper);
        normalized[p * 3 + ch] = value;
        lum += value * (ch === 0 ? 0.299 : ch === 1 ? 0.587 : 0.114);
      }
      histogram[Math.round(lum * 255)]++;
    }
  }

  // Black point: the darkest 1 % of the pixels become black
  let count = 0;
  let black = 0;
  const limit = (pixels.width * pixels.height) / 100;
  while (black < 254 && count + histogram[black] < limit) count += histogram[black++];
  const blackPoint = Math.min(black / 255, 0.6);
  const white = 0.92; // slightly grey paper becomes white
  const stretch = (value: number): number =>
    Math.round(Math.min(1, Math.max(0, (value - blackPoint) / (white - blackPoint))) * 255);

  for (let p = 0; p < pixels.width * pixels.height; p++) {
    const r = normalized[p * 3];
    const g = normalized[p * 3 + 1];
    const b = normalized[p * 3 + 2];
    if (mode === 'graustufen') {
      const value = stretch(0.299 * r + 0.587 * g + 0.114 * b);
      out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = value;
    } else {
      out[p * 4] = stretch(r);
      out[p * 4 + 1] = stretch(g);
      out[p * 4 + 2] = stretch(b);
    }
    out[p * 4 + 3] = 255;
  }
  return { data: out, width: pixels.width, height: pixels.height };
}

// --- Canvas glue ---

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas not available');
  return context;
}

export function readPixels(source: CanvasImageSource, width: number, height: number): Pixels {
  const context = canvasOf(width, height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}

export function toCanvas(pixels: Pixels): HTMLCanvasElement {
  const context = canvasOf(pixels.width, pixels.height);
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height),
    0,
    0
  );
  return context.canvas;
}

/** Finds the receipt in a photo; returns the corners in the photo's coordinates. */
export function findReceipt(photo: Pixels): Quad | null {
  const scale = Math.min(1, DETECT_EDGE / Math.max(photo.width, photo.height));
  const width = Math.max(3, Math.round(photo.width * scale));
  const height = Math.max(3, Math.round(photo.height * scale));
  const small = readPixels(toCanvas(photo), width, height);
  const quad = detectReceipt(toGray(small), width, height);
  if (!quad) return null;
  return quad.map(({ x, y }) => ({
    x: Math.min(photo.width, x / scale),
    y: Math.min(photo.height, y / scale),
  })) as Quad;
}

/** Straightens and enhances the receipt inside `quad`. */
export function scanReceipt(photo: Pixels, quad: Quad, mode: ScanMode, maxEdge: number): Pixels {
  const size = outputSize(quad, maxEdge);
  return enhance(warpPerspective(photo, quad, size.width, size.height), mode);
}
