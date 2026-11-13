import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentReviewCutoff, contentReviewDue } from '../src/lib/contentReviewDue.ts';

test('the due label and filter do not include March reviews on August 31', () => {
  const now = new Date(2027, 7, 31, 12);
  const item = { reviewedAt: new Date(2027, 2, 1, 12).toISOString(), changedSinceReview: false };
  assert.equal(contentReviewDue(item, now), false);
  assert.equal([item].filter((row) => contentReviewDue(row, now)).length, 0);
  assert.equal(contentReviewDue(item, new Date(2027, 8, 1, 12)), true);
});

test('calendar subtraction clamps month ends, including leap years', () => {
  for (const [year, day] of [
    [2027, 28],
    [2028, 29],
  ]) {
    const cutoff = contentReviewCutoff(new Date(year, 7, 31, 12));
    assert.equal(cutoff.getMonth(), 1);
    assert.equal(cutoff.getDate(), day);
    assert.equal(cutoff.getHours(), 12);
    assert.equal(
      contentReviewDue(
        { reviewedAt: cutoff.toISOString(), changedSinceReview: false },
        new Date(year, 7, 31, 12)
      ),
      true
    );
  }
});

test('unreviewed and changed content stays due regardless of its age', () => {
  const now = new Date(2027, 7, 31, 12);
  assert.equal(contentReviewDue({ reviewedAt: null, changedSinceReview: false }, now), true);
  assert.equal(
    contentReviewDue({ reviewedAt: now.toISOString(), changedSinceReview: true }, now),
    true
  );
});
