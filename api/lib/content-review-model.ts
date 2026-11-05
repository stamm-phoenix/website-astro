/** Public content domains included in the internal review overview. */
export type ContentReviewKind =
  'blog' | 'faq' | 'gruppenstunde' | 'leitende' | 'aktion' | 'download';

export interface ContentReviewItem {
  kind: ContentReviewKind;
  id: string;
  title: string;
  updatedAt: string;
  updatedBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  etag: string;
  campflowOwned: boolean;
  changedSinceReview: boolean;
}
