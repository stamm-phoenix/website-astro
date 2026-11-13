import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SWIPE_START } from '../src/lib/swipe';
import { HorizontalSwipe } from '../src/lib/swipeGesture';

function swipe(): HorizontalSwipe {
  const gesture = new HorizontalSwipe();
  gesture.begin(100, 100, 0, 320);
  return gesture;
}

describe('HorizontalSwipe', () => {
  test('a small movement is neither a swipe nor a scroll yet', () => {
    const gesture = swipe();
    assert.deepEqual(gesture.move(100 + SWIPE_START - 1, 100, 10), { kind: 'wait' });
    assert.equal(gesture.active, false);
  });

  test('sideways movement begins the swipe once, then keeps moving it', () => {
    const gesture = swipe();
    assert.deepEqual(gesture.move(100 + SWIPE_START + 2, 103, 10), {
      kind: 'begin',
      dx: SWIPE_START + 2,
    });
    assert.deepEqual(gesture.move(150, 104, 20), { kind: 'move', dx: 50 });
    assert.equal(gesture.active, true);
    assert.equal(gesture.width, 320);
  });

  test('a movement that is not more sideways than vertical is dropped for good', () => {
    const gesture = swipe();
    assert.deepEqual(gesture.move(100 + SWIPE_START, 100 + SWIPE_START, 10), { kind: 'drop' });
    // Even a later sideways movement of the same touch is left to the browser
    assert.deepEqual(gesture.move(200, 110, 20), { kind: 'wait' });
    assert.equal(gesture.end(30), null);
  });

  test('a swipe that already began is not dropped by a later vertical movement', () => {
    const gesture = swipe();
    gesture.move(130, 100, 10);
    assert.deepEqual(gesture.move(130, 200, 20), { kind: 'move', dx: 30 });
  });

  test('the release reports distance and the speed of the last movement', () => {
    const gesture = swipe();
    gesture.move(120, 100, 10);
    gesture.move(180, 100, 20);
    assert.deepEqual(gesture.end(30), { dx: 80, velocity: 6, width: 320 });
    assert.equal(gesture.active, false);
  });

  test('a finger that rested before letting go has no speed', () => {
    const gesture = swipe();
    gesture.move(120, 100, 10);
    gesture.move(180, 100, 20);
    assert.equal(gesture.end(500)?.velocity, 0);
  });

  test('a tap and a cancelled touch release nothing', () => {
    const tap = swipe();
    assert.equal(tap.end(50), null);
    const cancelled = swipe();
    cancelled.move(150, 100, 10);
    assert.equal(cancelled.cancel(), true);
    assert.equal(cancelled.end(20), null);
    assert.equal(swipe().cancel(), false);
  });

  test('a new touch starts over', () => {
    const gesture = swipe();
    gesture.move(150, 100, 10);
    gesture.begin(10, 10, 100, 200);
    assert.equal(gesture.active, false);
    assert.deepEqual(gesture.move(40, 10, 110), { kind: 'begin', dx: 30 });
    assert.equal(gesture.width, 200);
  });
});
