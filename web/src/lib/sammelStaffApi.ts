import { sendApi } from './api';
import type { SammelAktion } from './types';

/** Version-checked, reversible campaign archive action with its matching result. */
export async function archiveSammelCampaign(campaign: SammelAktion): Promise<string> {
  await sendApi('PATCH', `/intern/pflege/sammelbestellungen/${campaign.id}`, {
    etag: campaign.etag,
    archived: !campaign.archived,
  });
  return campaign.archived
    ? 'Sammelbestellung wiederhergestellt.'
    : 'Sammelbestellung archiviert. Alle Bestellungen bleiben erhalten.';
}
