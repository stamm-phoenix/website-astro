import { sql } from 'kysely';
import {
  getDb,
  inTransaction,
  RecordNotFoundError,
  requireVersion,
  toVersion,
  VersionConflictError,
} from './db';
import type { Db } from './db';
import type { ContentReviewItem, ContentReviewKind } from './content-review-model';

export const REVIEW_DOMAINS = {
  blog: { table: 'content.blog_post', title: 'title' },
  faq: { table: 'content.faq', title: 'question' },
  gruppenstunde: { table: 'content.gruppenstunde', title: 'stufe' },
  leitende: { table: 'content.leitende', title: 'name' },
  aktion: { table: 'content.aktion', title: 'title' },
  download: { table: 'content.download', title: 'file_name' },
} as const;
export function reviewReference(
  kind: ContentReviewKind,
  id: string
): {
  blog_id?: number;
  faq_id?: number;
  gruppenstunde_id?: number;
  leitende_id?: number;
  aktion_id?: number;
  download_id?: string;
} {
  return kind === 'download' ? { download_id: id } : { [`${kind}_id`]: Number(id) };
}
export function isReviewKind(value: string): value is ContentReviewKind {
  return Object.hasOwn(REVIEW_DOMAINS, value);
}
interface ReviewRow {
  id: string | number;
  title: string;
  version: Buffer;
  updated_at: Date;
  updated_by: string;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  source_version: Buffer | null;
  campflow: string | null;
}
async function listKind(
  db: Db,
  kind: ContentReviewKind,
  id?: string
): Promise<ContentReviewItem[]> {
  const domain = REVIEW_DOMAINS[kind];
  const { rows } = await sql<ReviewRow>`
    SELECT c.id, ${sql.ref(`c.${domain.title}`)} AS title, c.version, c.updated_at, c.updated_by,
      r.reviewed_at, r.reviewed_by, r.source_version,
      ${kind === 'aktion' ? sql`c.campflow_id` : sql`NULL`} AS campflow
    FROM ${sql.table(domain.table)} c
    LEFT JOIN content.review r ON r.kind = ${kind} AND r.content_id = CAST(c.id AS nvarchar(128))
    ${id === undefined ? sql`` : sql`WHERE CAST(c.id AS nvarchar(128)) = ${id}`}
  `.execute(db);
  return rows.map((row) => ({
    kind,
    id: String(row.id),
    title: row.title,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewedBy: row.reviewed_by,
    changedSinceReview: row.source_version !== null && !row.source_version.equals(row.version),
    etag: toVersion(row.version),
    campflowOwned: row.campflow !== null,
  }));
}
export async function getContentReviews(db: Db = getDb()): Promise<ContentReviewItem[]> {
  const lists = await Promise.all(
    (Object.keys(REVIEW_DOMAINS) as ContentReviewKind[]).map((kind) => listKind(db, kind))
  );
  return lists.flat().sort((a, b) => a.title.localeCompare(b.title, 'de'));
}
/** Source row locks also serialize reviews against edits and deletes. No client identity/time is accepted. */
export async function markContentReviewed(
  kind: ContentReviewKind,
  id: string,
  etag: string,
  actor: string
): Promise<ContentReviewItem> {
  const version = requireVersion(etag);
  return inTransaction(async (trx) => {
    const { rows } = await sql<{
      version: Buffer;
    }>`SELECT version FROM ${sql.table(REVIEW_DOMAINS[kind].table)} WITH (UPDLOCK, HOLDLOCK)
      WHERE CAST(id AS nvarchar(128)) = ${id}`.execute(trx);
    if (!rows.length) throw new RecordNotFoundError();
    if (!rows[0].version.equals(version)) throw new VersionConflictError();
    const values = {
      source_version: version,
      reviewed_at: sql<Date>`SYSUTCDATETIME()`,
      reviewed_by: actor,
    };
    const result = await trx
      .updateTable('content.review')
      .set(values)
      .where('kind', '=', kind)
      .where('content_id', '=', id)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n)
      await trx
        .insertInto('content.review')
        .values({ kind, content_id: id, ...reviewReference(kind, id), ...values })
        .execute();
    return (await listKind(trx, kind, id))[0];
  });
}
