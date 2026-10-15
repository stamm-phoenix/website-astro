import { inTransaction, lockResource, parseId } from './db';

const HOUR_LIMIT = 100;
const DAY_LIMIT = 500;

/**
 * Reserves before order creation, across instances and restarts, without refunding failed
 * attempts. Counts are kept per UTC hour and day; a new window starts at zero.
 */
export async function reserveSammelLinkRequest(id: string, now = Date.now()): Promise<boolean> {
  const campaignId = parseId(id);
  if (campaignId === undefined) return false;
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  return inTransaction(async (trx) => {
    await lockResource(trx, `sammel:link-quota:${campaignId}`);
    const campaign = await trx
      .selectFrom('sammel.campaign')
      .select('id')
      .where('id', '=', campaignId)
      .executeTakeFirst();
    if (!campaign) return false;
    const stored = await trx
      .selectFrom('sammel.link_quota')
      .selectAll()
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();
    const hourCount = stored?.hour_window === hour ? stored.hour_count : 0;
    const dayCount = stored?.day_window === day ? stored.day_count : 0;
    if (hourCount >= HOUR_LIMIT || dayCount >= DAY_LIMIT) return false;
    const values = {
      hour_window: hour,
      hour_count: hourCount + 1,
      day_window: day,
      day_count: dayCount + 1,
    };
    if (stored)
      await trx
        .updateTable('sammel.link_quota')
        .set(values)
        .where('campaign_id', '=', campaignId)
        .execute();
    else
      await trx
        .insertInto('sammel.link_quota')
        .values({ campaign_id: campaignId, ...values })
        .execute();
    return true;
  });
}
