import { sql } from 'kysely';
import { inTransaction, lockResource } from './db';
import { REVIEW_DOMAINS, reviewReference } from './content-review';
import type { ContentReviewKind } from './content-review-model';

/** Invented examples; retries preserve existing reviews and leave further rows unreviewed. */
export async function seedPreviewContentReviews(): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, 'preview:content-review');
    for (const kind of Object.keys(REVIEW_DOMAINS) as ContentReviewKind[]) {
      const rows = await trx
        .selectFrom(REVIEW_DOMAINS[kind].table)
        .select(['id', 'version'])
        .orderBy('id')
        .limit(2)
        .execute();
      for (const [index, row] of rows.entries()) {
        const contentId = String(row.id);
        const exists = await trx
          .selectFrom('content.review')
          .select('content_id')
          .where('kind', '=', kind)
          .where('content_id', '=', contentId)
          .executeTakeFirst();
        if (!exists)
          await trx
            .insertInto('content.review')
            .values({
              kind,
              content_id: contentId,
              ...reviewReference(kind, contentId),
              source_version: row.version,
              reviewed_at:
                index === 0
                  ? sql<Date>`SYSUTCDATETIME()`
                  : sql<Date>`DATEADD(month, -8, SYSUTCDATETIME())`,
              reviewed_by: 'Redaktion (Testdaten)',
            })
            .execute();
      }
    }
  });
}
