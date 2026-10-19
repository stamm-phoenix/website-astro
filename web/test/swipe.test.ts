import { describe, expect, test } from 'bun:test';
import {
  commits,
  moveTrack,
  releaseVelocity,
  rubberBand,
  settleDuration,
  startTrack,
} from '../src/lib/swipe';

describe('settleDuration', () => {
  test('a slow or missing release velocity takes the full duration', () => {
    expect(settleDuration(300, 0, 220)).toBe(220);
    expect(settleDuration(300, 0.1, 220)).toBe(220);
  });

  test('a flick finishes faster, starting at the speed of the finger', () => {
    // 6.25 * 100 px / 4 px/ms = 156 ms: the curve starts at 4 px/ms
    expect(settleDuration(100, 4, 220)).toBe(156);
  });

  test('a very fast flick still takes the minimum, so the movement stays visible', () => {
    expect(settleDuration(40, 10, 220)).toBe(120);
  });

  test('Reduced Motion (duration 0) jumps', () => {
    expect(settleDuration(300, 2, 0)).toBe(0);
  });
});

describe('commits', () => {
  test('past the threshold or a flick finishes the gesture', () => {
    expect(commits(120, 0, 100)).toBe(true);
    expect(commits(20, 0.8, 100)).toBe(true);
    expect(commits(20, 0.1, 100)).toBe(false);
  });

  test('a flick back cancels even past the threshold', () => {
    expect(commits(150, -0.8, 100)).toBe(false);
  });
});

describe('releaseVelocity', () => {
  test('a finger that rested before letting go was not flicking', () => {
    const track = startTrack(0, 0, 0);
    moveTrack(track, 0, 40, 10);
    expect(releaseVelocity(track, 'y', 20)).toBe(4);
    expect(releaseVelocity(track, 'y', 200)).toBe(0);
  });
});

test('rubberBand gives a little and stops at its limit', () => {
  expect(rubberBand(0)).toBe(0);
  expect(rubberBand(16)).toBe(8);
  expect(rubberBand(10_000)).toBe(24);
});
