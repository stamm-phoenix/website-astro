import { CONFIG } from './config';
import { inTransaction, lockResource } from './db';
import { getSharePointListItems } from './sharepoint-data-access';
import type { ImportSummary, ListItem } from './sharepoint-import-common';
import { isImported, markImported, text } from './sharepoint-import-common';

/**
 * Takeover of the SharePoint list „InstagramToken“ into `content.instagram_token` (migration
 * `0026_aktionen_belege_instagram.sql`), see `sharepoint-import.ts`. Without a stored token the
 * website starts again from `INSTAGRAM_ACCESS_TOKEN` (`instagram-token.ts`). The token is never
 * logged.
 */

export interface SourceInstagramToken {
  token: string;
  /** ISO time of the last refresh, or null if unknown. */
  refreshedAt: string | null;
}

/** Reads the first token of the SharePoint list „InstagramToken“, if any. */
export async function readInstagramTokenList(): Promise<SourceInstagramToken | undefined> {
  const items = (await getSharePointListItems(CONFIG.sharepoint.lists.instagramToken, {
    expand: 'fields',
  })) as ListItem<Record<string, unknown>>[];
  for (const { fields } of items) {
    const token = text(fields.Token);
    if (!token) continue;
    const refreshedAt = Date.parse(text(fields.RefreshedAt));
    return {
      token,
      refreshedAt: Number.isNaN(refreshedAt) ? null : new Date(refreshedAt).toISOString(),
    };
  }
  return undefined;
}

/** Copies the token; see `importSharePointList`. */
export async function importInstagramToken(): Promise<ImportSummary | undefined> {
  const list = 'instagram';
  const source = await readInstagramTokenList();
  return inTransaction(async (trx) => {
    await lockResource(trx, `content:sharepoint-import:${list}`);
    if (await isImported(trx, list)) return undefined;
    // A token stored meanwhile (from INSTAGRAM_ACCESS_TOKEN) is not overwritten
    const exists = await trx.selectFrom('content.instagram_token').select('id').executeTakeFirst();
    if (source && !exists) {
      await trx
        .insertInto('content.instagram_token')
        .values({ id: 1, token: source.token, refreshed_at: source.refreshedAt })
        .execute();
    }
    const summary: ImportSummary = { items: source && !exists ? 1 : 0 };
    await markImported(trx, list, summary);
    return summary;
  });
}
