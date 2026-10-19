import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  commits,
  moveTrack,
  releaseVelocity,
  rubberBand,
  settleDuration,
  settleEasing,
  startTrack,
} from '../src/lib/swipe';

describe('settleDuration', () => {
  test('a slow or missing release velocity takes the full duration', () => {
    assert.equal(settleDuration(300, 0, 220), 220);
    assert.equal(settleDuration(300, 0.1, 220), 220);
  });

  test('a flick finishes faster, starting at the speed of the finger', () => {
    // 6.25 * 100 px / 4 px/ms = 156 ms: the curve starts at 4 px/ms
    assert.equal(settleDuration(100, 4, 220), 156);
  });

  test('a very fast flick still takes the minimum, so the movement stays visible', () => {
    assert.equal(settleDuration(40, 10, 220), 120);
  });

  test('Reduced Motion (duration 0) jumps', () => {
    assert.equal(settleDuration(300, 2, 0), 0);
  });
});

describe('commits', () => {
  test('past the threshold or a flick finishes the gesture', () => {
    assert.equal(commits(120, 0, 100), true);
    assert.equal(commits(20, 0.8, 100), true);
    assert.equal(commits(20, 0.1, 100), false);
  });

  test('a flick back cancels even past the threshold', () => {
    assert.equal(commits(150, -0.8, 100), false);
  });
});

describe('releaseVelocity', () => {
  test('a finger that rested before letting go was not flicking', () => {
    const track = startTrack(0, 0, 0);
    moveTrack(track, 0, 40, 10);
    assert.equal(releaseVelocity(track, 'y', 20), 4);
    assert.equal(releaseVelocity(track, 'y', 200), 0);
  });
});

test('rubberBand gives a little and stops at its limit', () => {
  assert.equal(rubberBand(0), 0);
  assert.equal(rubberBand(16), 8);
  assert.equal(rubberBand(10_000), 24);
});

describe('settleEasing', () => {
  test('a slow finger gets a curve that starts at its speed', () => {
    // 1 px/ms over 400 px in 220 ms: slope 0.55, so y1 = 0.16 * 0.55
    assert.equal(settleEasing(400, 1, 220), 'cubic-bezier(0.16, 0.088, 0.3, 1)');
  });

  test('a fast finger or no finger keeps the shared curve', () => {
    assert.equal(settleEasing(40, 10, 120), 'var(--motion-enter)');
    assert.equal(settleEasing(400, 0, 220), 'var(--motion-enter)');
  });
});
