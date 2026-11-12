import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DRAG_COMMIT,
  DRAG_START,
  claimsNativeDrag,
  classifyMove,
  dragCommits,
  dragDirection,
} from '../src/lib/sidebarDrag';

describe('dragDirection', () => {
  test('the open sidebar folds to the left, the folded one unfolds to the right', () => {
    assert.equal(dragDirection(false), -1);
    assert.equal(dragDirection(true), 1);
  });
});

describe('classifyMove', () => {
  test('a small slip of the mouse while clicking is no drag', () => {
    assert.equal(classifyMove(-(DRAG_START - 1), 3, -1), 'wait');
    assert.equal(classifyMove(DRAG_START - 1, 0, 1), 'wait');
  });

  test('moving far enough sideways in the direction starts the drag', () => {
    assert.equal(classifyMove(-DRAG_START, 2, -1), 'drag');
    assert.equal(classifyMove(DRAG_START, -2, 1), 'drag');
  });

  test('moving the other way or mostly up and down gives the movement back', () => {
    assert.equal(classifyMove(DRAG_START, 0, -1), 'none');
    assert.equal(classifyMove(-DRAG_START, 0, 1), 'none');
    assert.equal(classifyMove(-4, DRAG_START, -1), 'none');
    assert.equal(classifyMove(-DRAG_START, -DRAG_START, -1), 'none');
  });
});

describe('dragCommits', () => {
  test('a drag let go early springs back', () => {
    assert.equal(dragCommits(-(DRAG_COMMIT - 1), 0, -1), false);
    assert.equal(dragCommits(DRAG_COMMIT - 1, 0, 1), false);
  });

  test('a drag far enough in the direction folds or unfolds', () => {
    assert.equal(dragCommits(-(DRAG_COMMIT + 1), 0, -1), true);
    assert.equal(dragCommits(DRAG_COMMIT + 1, 0, 1), true);
  });

  test('a flick in the direction is enough, one back against it cancels', () => {
    assert.equal(dragCommits(-20, -1, -1), true);
    assert.equal(dragCommits(-(DRAG_COMMIT + 20), 1, -1), false);
    assert.equal(dragCommits(20, 1, 1), true);
  });
});

describe('claimsNativeDrag', () => {
  test('a link the browser starts dragging in the direction is taken for the sidebar', () => {
    assert.equal(claimsNativeDrag(-4, 1, -1), true);
    assert.equal(claimsNativeDrag(4, -2, 1), true);
  });

  test('against the direction or up and down, the link is dragged as usual', () => {
    assert.equal(claimsNativeDrag(4, 0, -1), false);
    assert.equal(claimsNativeDrag(-4, 0, 1), false);
    assert.equal(claimsNativeDrag(-1, 4, -1), false);
    assert.equal(claimsNativeDrag(0, 0, -1), false);
  });
});
