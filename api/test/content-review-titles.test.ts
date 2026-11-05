import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReviewTitles, type ReviewWithCampflow } from '../lib/content-review-titles';

const item: ReviewWithCampflow = {
  kind: 'aktion',
  id: '1',
  title: 'Stored title',
  campflowId: 'evt_test',
  campflowOwned: true,
  etag: '"0000000000000001"',
  changedSinceReview: false,
  updatedAt: '2026-11-01',
  updatedBy: 'editor',
  reviewedAt: '2026-11-02',
  reviewedBy: 'reviewer',
};

test('CampFlow display rename preserves website version and review status', async () => {
  const [resolved] = await resolveReviewTitles([item], async () => [
    { id: 'other', title: 'Unrelated' },
    { id: 'evt_test', title: 'Current title' },
  ]);
  assert.equal(resolved.title, 'Current title');
  assert.equal(resolved.etag, item.etag);
  assert.equal(resolved.changedSinceReview, false);
  assert.equal(resolved.reviewedAt, item.reviewedAt);
  assert.equal(Object.hasOwn(resolved, 'campflowId'), false);
});

test('missing event and external outage fall back to stored title', async () => {
  for (const load of [
    async () => [],
    async () => {
      throw new Error('CampFlow unavailable');
    },
    async () => [{ id: 'evt_test', title: ' ' }],
  ]) {
    const [resolved] = await resolveReviewTitles([item], load);
    assert.equal(resolved.title, 'Stored title');
    assert.equal(resolved.etag, item.etag);
    assert.equal(resolved.changedSinceReview, false);
  }
});
