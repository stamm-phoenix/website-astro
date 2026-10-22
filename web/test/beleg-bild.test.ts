import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bildBearbeiten,
  ausrichten,
  drehen,
  drehungen,
  eckenErweitern,
  eckenAusrichten,
  ganzesBild,
  punktAusrichten,
  spiegeln,
} from '../src/lib/belegBild';
import { fullFrame } from '../src/lib/belegScan';
import type { Pixels, Quad } from '../src/lib/belegScan';

/** A 3 × 2 picture whose red channel numbers the pixels row by row: 0 1 2 / 3 4 5. */
function numbered(): Pixels {
  const data = new Uint8ClampedArray(3 * 2 * 4);
  for (let i = 0; i < 6; i++) {
    data[i * 4] = i;
    data[i * 4 + 3] = 255;
  }
  return { data, width: 3, height: 2 };
}

const reds = (pixels: Pixels): number[] =>
  Array.from({ length: pixels.width * pixels.height }, (_, i) => pixels.data[i * 4]);

test('a quarter turn swaps width and height and moves every pixel', () => {
  const right = drehen(numbered(), 'rechts');
  assert.deepEqual([right.width, right.height], [2, 3]);
  // 0 1 2 / 3 4 5 turned clockwise: 3 0 / 4 1 / 5 2
  assert.deepEqual(reds(right), [3, 0, 4, 1, 5, 2]);
  assert.deepEqual(reds(drehen(numbered(), 'links')), [2, 5, 1, 4, 0, 3]);
  // Four turns are the picture again
  let turned = numbered();
  for (let i = 0; i < 4; i++) turned = drehen(turned, 'rechts');
  assert.deepEqual(reds(turned), reds(numbered()));
});

test('mirroring flips left and right or top and bottom', () => {
  assert.deepEqual(reds(spiegeln(numbered(), 'horizontal')), [2, 1, 0, 5, 4, 3]);
  assert.deepEqual(reds(spiegeln(numbered(), 'vertikal')), [3, 4, 5, 0, 1, 2]);
});

test('points follow the picture, matching the pixels', () => {
  // The pixel at (0, 0) of a 3 × 2 picture lands at the top right after a clockwise turn
  assert.deepEqual(punktAusrichten({ x: 0, y: 0 }, 3, 2, 'rechts'), { x: 2, y: 0 });
  assert.deepEqual(punktAusrichten({ x: 0, y: 0 }, 3, 2, 'links'), { x: 0, y: 3 });
  assert.deepEqual(punktAusrichten({ x: 1, y: 0 }, 3, 2, 'horizontal'), { x: 2, y: 0 });
  assert.deepEqual(punktAusrichten({ x: 1, y: 0 }, 3, 2, 'vertikal'), { x: 1, y: 2 });
});

test('the crop corners stay top left, top right, bottom right, bottom left as seen', () => {
  const quad: Quad = [
    { x: 10, y: 20 },
    { x: 90, y: 25 },
    { x: 85, y: 180 },
    { x: 15, y: 170 },
  ];
  // In a 100 × 200 picture turned clockwise the old bottom left corner is the new top left
  const turned = eckenAusrichten(quad, 100, 200, 'rechts');
  assert.deepEqual(turned[0], { x: 30, y: 15 });
  assert.deepEqual(turned[2], { x: 175, y: 90 });
  // Mirrored twice, the corners are where they were
  const mirrored = eckenAusrichten(
    eckenAusrichten(quad, 100, 200, 'horizontal'),
    100,
    200,
    'horizontal'
  );
  assert.deepEqual(mirrored, quad);
});

test('without crop and with the original colours the picture stays as it is', () => {
  const picture = numbered();
  assert.equal(bildBearbeiten(picture, null, 'original', 2000), picture);
  // A crop straightens the area inside the corners
  const cropped = bildBearbeiten(
    picture,
    [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
    ],
    'original',
    2000
  );
  assert.deepEqual([cropped.width, cropped.height], [2, 2]);
});

test('a thin cut by hand is a crop, untouched corners are the whole picture', () => {
  assert.equal(ganzesBild(fullFrame(1000, 1600), 1000, 1600), true);
  const thin: Quad = [
    { x: 20, y: 20 },
    { x: 980, y: 20 },
    { x: 980, y: 1580 },
    { x: 20, y: 1580 },
  ];
  assert.equal(ganzesBild(thin, 1000, 1600), false);
  const picture: Pixels = {
    data: new Uint8ClampedArray(1000 * 1600 * 4),
    width: 1000,
    height: 1600,
  };
  const cropped = bildBearbeiten(picture, thin, 'original', 2000);
  assert.deepEqual([cropped.width, cropped.height], [960, 1560]);
});

test('a found receipt keeps a thin margin inside the picture', () => {
  const quad: Quad = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 500 },
    { x: 100, y: 500 },
  ];
  // A tenth of the long edge on every side, also across the narrow receipt
  assert.deepEqual(eckenErweitern(quad, 1000, 1000, 0.1), [
    { x: 60, y: 60 },
    { x: 340, y: 60 },
    { x: 340, y: 540 },
    { x: 60, y: 540 },
  ]);
  // Never beyond the picture
  assert.deepEqual(eckenErweitern(quad, 305, 505, 0.1)[2], { x: 305, y: 505 });
});

test('the degrees of the check become turns', () => {
  assert.deepEqual(drehungen(0), []);
  assert.deepEqual(drehungen(90), ['rechts']);
  assert.deepEqual(drehungen(180), ['rechts', 'rechts']);
  assert.deepEqual(drehungen(270), ['links']);
});

test('a perspective crop turns with the picture, content and all', () => {
  // 1000 × 1600, the red channel marks the corner of the receipt at its top left
  const data = new Uint8ClampedArray(1000 * 1600 * 4).fill(255);
  for (let y = 190; y < 230; y++)
    for (let x = 100; x < 140; x++) data[(y * 1000 + x) * 4 + 1] = data[(y * 1000 + x) * 4 + 2] = 0;
  const picture: Pixels = { data, width: 1000, height: 1600 };
  const quad: Quad = [
    { x: 100, y: 200 },
    { x: 400, y: 100 },
    { x: 800, y: 1200 },
    { x: 300, y: 650 },
  ];
  const before = bildBearbeiten(picture, quad, 'original', 2000);
  for (const [schritt, size] of [
    ['rechts', [before.height, before.width]],
    ['links', [before.height, before.width]],
    ['horizontal', [before.width, before.height]],
    ['vertikal', [before.width, before.height]],
  ] as const) {
    const turned = bildBearbeiten(
      ausrichten(picture, schritt),
      eckenAusrichten(quad, 1000, 1600, schritt),
      'original',
      2000
    );
    assert.deepEqual([turned.width, turned.height], size, schritt);
    // The red corner ends up where the step puts the receipt's top left corner
    const at = (x: number, y: number) => turned.data[(y * turned.width + x) * 4 + 1];
    const w = turned.width - 3;
    const h = turned.height - 3;
    const corner = { rechts: [w, 2], links: [2, h], horizontal: [w, 2], vertikal: [2, h] }[schritt];
    assert.equal(at(corner[0], corner[1]), 0, schritt);
  }
});
