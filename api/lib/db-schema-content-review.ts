import type { ColumnType } from 'kysely';
import type { ContentReviewKind } from './content-review-model';

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
