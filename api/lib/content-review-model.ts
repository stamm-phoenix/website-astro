import type { ColumnType } from 'kysely';
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

/** Review metadata is separate so marking a review never changes content audit fields. */
export interface ContentReviewTable {
  kind: ContentReviewKind;
  content_id: string;
  blog_id: ColumnType<number | null, number | null | undefined, number | null>;
  faq_id: ColumnType<number | null, number | null | undefined, number | null>;
  gruppenstunde_id: ColumnType<number | null, number | null | undefined, number | null>;
  leitende_id: ColumnType<number | null, number | null | undefined, number | null>;
  aktion_id: ColumnType<number | null, number | null | undefined, number | null>;
  download_id: ColumnType<string | null, string | null | undefined, string | null>;
  source_version: Buffer;
  reviewed_at: Date;
  reviewed_by: string;
}
