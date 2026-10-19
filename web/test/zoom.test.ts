import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rubberBand } from '../src/lib/swipe';
import {
  NO_ZOOM,
  clampPan,
  containedSize,
  isDoubleTap,
  panLimit,
  pinchZoom,
  zoomAround,
} from '../src/lib/zoom';

describe('zoomAround', () => {
  test('keeps the point under the finger in place', () => {
    const zoomed = zoomAround(NO_ZOOM, 2.5, { x: 40, y: -20 });
    assert.deepEqual(zoomed, { scale: 2.5, x: -60, y: 30 });
    // The picture point that was at (40, -20) is still there: centre + scale * offset
    assert.equal(zoomed.x + zoomed.scale * 40, 40);
    // And back to the whole picture
    assert.deepEqual(zoomAround(zoomed, 1, { x: 0, y: 0 }), { scale: 1, x: -24, y: 12 });
  });

  test('stays between 1× and 4×', () => {
    assert.equal(zoomAround(NO_ZOOM, 10, { x: 0, y: 0 }).scale, 4);
    assert.equal(zoomAround(NO_ZOOM, 0.2, { x: 0, y: 0 }).scale, 1);
  });
});

describe('pinchZoom', () => {
  test('the scale follows the distance between the fingers', () => {
    assert.equal(pinchZoom(NO_ZOOM, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200).scale, 2);
    assert.equal(pinchZoom(NO_ZOOM, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 1000).scale, 4);
    assert.equal(pinchZoom(NO_ZOOM, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 50).scale, 1);
  });

  test('the picture point between the fingers moves with them', () => {
    const zoomed = pinchZoom(NO_ZOOM, { x: 50, y: 0 }, 100, { x: 70, y: 10 }, 200);
    assert.deepEqual(zoomed, { scale: 2, x: -30, y: 10 });
    assert.equal(zoomed.x + zoomed.scale * 50, 70);
  });
});

describe('panLimit and clampPan', () => {
  test('a picture smaller than the view cannot move', () => {
    assert.deepEqual(panLimit({ width: 390, height: 260 }, { width: 390, height: 600 }, 1), {
      x: 0,
      y: 0,
    });
  });

  test('a zoomed picture moves until its edge reaches the view edge', () => {
    const limit = panLimit({ width: 390, height: 260 }, { width: 390, height: 600 }, 2.5);
    assert.deepEqual(limit, { x: 292.5, y: 25 });
    assert.deepEqual(clampPan({ scale: 2.5, x: 400, y: -100 }, limit), {
      scale: 2.5,
      x: 292.5,
      y: -25,
    });
  });

  test('past the edge the picture gives only a little with a rubber band', () => {
    const clamped = clampPan({ scale: 2, x: 116, y: 0 }, { x: 100, y: 0 }, rubberBand);
    assert.equal(clamped.x, 108);
  });
});

test('containedSize fits the picture into the box', () => {
  assert.deepEqual(containedSize({ width: 390, height: 600 }, 1.5), { width: 390, height: 260 });
  assert.deepEqual(containedSize({ width: 1000, height: 500 }, 1), { width: 500, height: 500 });
});

describe('isDoubleTap', () => {
  const first = { x: 100, y: 100, time: 1000 };

  test('two taps close in time and place', () => {
    assert.equal(isDoubleTap(first, { x: 110, y: 110, time: 1250 }), true);
  });

  test('too slow, too far apart or without a first tap', () => {
    assert.equal(isDoubleTap(first, { x: 100, y: 100, time: 1400 }), false);
    assert.equal(isDoubleTap(first, { x: 140, y: 100, time: 1100 }), false);
    assert.equal(isDoubleTap(null, first), false);
  });
});
