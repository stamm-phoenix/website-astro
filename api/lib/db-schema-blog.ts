import type { ColumnType, Generated } from 'kysely';
type ReadOnly<T> = ColumnType<T, never, never>;
type SqlDate = ColumnType<Date | string, string, string>;
export interface BlogPostTable {
  workflow_json: Generated<string | null>;
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  title: string;
  post_date: SqlDate;
  published: boolean;
  /** Canonical HTML with `<img data-bild>` placeholders. */
  content: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface BlogImageTable {
  post_id: number;
  file: string;
  /** 0 is the cover image. */
  position: number;
  alt: Generated<string>;
  width: number;
  height: number;
}
