import { sql, type RawBuilder } from 'kysely';

/**
 * Canonical JSON uses explicit field order, ISO date and stable image ordering.
 * Alias c is the blog parent. Lock it before persisting a review: image mutations
 * also lock the parent first, keeping the fingerprint and review coherent.
 */
export function blogContentHash(): RawBuilder<Buffer> {
  return sql<Buffer>`HASHBYTES('SHA2_256', (
    SELECT c.title, CONVERT(char(10), c.post_date, 23) AS post_date, c.content,
      JSON_QUERY((
        SELECT i.[file], i.alt, i.[position], i.width, i.height
        FROM content.blog_image i WHERE i.post_id = c.id
        ORDER BY i.[position], i.[file]
        FOR JSON PATH, INCLUDE_NULL_VALUES
      )) AS images
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
  ))`;
}
