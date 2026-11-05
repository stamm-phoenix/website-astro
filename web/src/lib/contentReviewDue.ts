import type { ContentReviewItem } from '../../../api/lib/content-review-model';

/** Six calendar months ago, clamped to the last day of a shorter target month. */
export function contentReviewCutoff(now: Date): Date {
  const cutoff = new Date(now);
  const day = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - 6);
  const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
  cutoff.setDate(Math.min(day, lastDay));
  return cutoff;
}

export function contentReviewDue(
  item: Pick<ContentReviewItem, 'reviewedAt' | 'changedSinceReview'>,
  now: Date
): boolean {
  return !item.reviewedAt || item.changedSinceReview ||
    new Date(item.reviewedAt) <= contentReviewCutoff(now);
}
