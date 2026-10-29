import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { campflowGetAll } from './campflow';
import type { CampflowPerson } from './campflow';
import { getDb, inTransaction, lockResource, parseId } from './db';
import { InvalidSammelDataError, sammelUrl } from './sammelbestellung-list';
import { email } from './sammelbestellung-validation';
import { ValidationError } from './validation/errors';
import { sendSammelInvitationMail } from './sammelbestellung-mails';
import type { SammelAktion } from './sammelbestellung-model';

interface Recipient {
  address: string;
  status: 'pending' | 'attempted' | 'sent';
}
interface InvitationJob {
  recipients: Recipient[];
}

/** Includes primary and CC addresses of current members, once per normalized address. */
export function sammelInvitationRecipients(persons: CampflowPerson[], today: string): string[] {
  const addresses = new Set<string>();
  for (const person of persons) {
    if (typeof person.leave_date === 'string' && person.leave_date && person.leave_date <= today)
      continue;
    if (typeof person.join_date === 'string' && person.join_date > today) continue;
    const values = [
      person.primary_email,
      ...(Array.isArray(person.cc_emails) ? person.cc_emails : []),
    ];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      try {
        addresses.add(email(value));
      } catch {
        /* Skip invalid contact fields, never guess addresses. */
      }
    }
  }
  if (addresses.size > 500)
    throw new ValidationError({
      form: 'Mehr als 500 Empfänger. Bitte den Versand mit dem Team abstimmen.',
    });
  return [...addresses].sort();
}

/** Binds the confirmation to the exact deduplicated audience, without exposing addresses. */
export function sammelAudienceVersion(addresses: string[]): string {
  return createHash('sha256').update(JSON.stringify(addresses)).digest('hex');
}

async function loadJob(campaignId: number): Promise<InvitationJob | null> {
  const rows = await getDb()
    .selectFrom('sammel.invitation')
    .select(['address', 'status'])
    .where('campaign_id', '=', campaignId)
    .orderBy('address')
    .execute();
  return rows.length ? { recipients: rows } : null;
}

/** Stores the confirmed audience once; a concurrent confirmation keeps the first one. */
async function startJob(campaignId: number, addresses: string[]): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, `sammel:invitation:${campaignId}`);
    const started = await trx
      .selectFrom('sammel.invitation')
      .select('address')
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();
    if (started) return;
    // SQL Server takes at most 2100 parameters per statement
    for (let index = 0; index < addresses.length; index += 500)
      await trx
        .insertInto('sammel.invitation')
        .values(
          addresses
            .slice(index, index + 500)
            .map((address) => ({ campaign_id: campaignId, address, status: 'pending' as const }))
        )
        .execute();
  });
}

/** Reserves the next pending address; concurrent steps never get the same one. */
async function reserveNext(campaignId: number): Promise<string | undefined> {
  // READCOMMITTEDLOCK: READPAST needs locking reads, Azure SQL reads row versions by default
  const result = await sql<{ address: string }>`
    WITH next AS (
      SELECT TOP (1) address, status FROM sammel.invitation WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
      WHERE campaign_id = ${campaignId} AND status = 'pending'
      ORDER BY address
    )
    UPDATE next SET status = 'attempted' OUTPUT inserted.address;
  `.execute(getDb());
  return result.rows[0]?.address;
}

/** Returns only counts. Attempted deliveries are never retried automatically after uncertain results. */
function summary(job: InvitationJob): {
  total: number;
  pending: number;
  sent: number;
  uncertain: number;
} {
  return {
    total: job.recipients.length,
    pending: job.recipients.filter((row) => row.status === 'pending').length,
    sent: job.recipients.filter((row) => row.status === 'sent').length,
    uncertain: job.recipients.filter((row) => row.status === 'attempted').length,
  };
}

/** Previews the audience or advances one durably reserved delivery per request. */
export async function sammelInvitationStep(
  campaign: SammelAktion,
  action: 'preview' | 'send',
  siteUrl: string,
  version?: unknown
): Promise<ReturnType<typeof summary> & { version?: string; started: boolean }> {
  const campaignId = parseId(campaign.id);
  if (campaignId === undefined) throw new InvalidSammelDataError(campaign.id, 'id');
  const current = await loadJob(campaignId);
  if (action === 'preview' && current) return { ...summary(current), started: true };
  if (!current) {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(
      new Date()
    );
    const addresses = sammelInvitationRecipients(
      await campflowGetAll<CampflowPerson>('/lists/member/persons'),
      today
    );
    const audienceVersion = sammelAudienceVersion(addresses);
    if (action === 'preview')
      return {
        total: addresses.length,
        pending: addresses.length,
        sent: 0,
        uncertain: 0,
        started: false,
        version: audienceVersion,
      };
    if (version !== audienceVersion)
      throw new ValidationError({
        form: 'Der CampFlow-Verteiler hat sich geändert. Bitte die Empfängerzahl erneut bestätigen.',
      });
    if (!addresses.length)
      throw new ValidationError({ form: 'Keine gültigen E-Mail-Adressen in CampFlow gefunden.' });
    await startJob(campaignId, addresses);
  }
  // Reserve before sending, so concurrent tabs or instances never send twice.
  const next = await reserveNext(campaignId);
  if (next) {
    await sendSammelInvitationMail(next, campaign, sammelUrl(siteUrl, 'campaign', campaign.id));
    const result = await getDb()
      .updateTable('sammel.invitation')
      .set({ status: 'sent' })
      .where('campaign_id', '=', campaignId)
      .where('address', '=', next)
      .where('status', '=', 'attempted')
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1)
      throw new InvalidSammelDataError(campaign.id, 'Einladungsversand');
  }
  return { ...summary((await loadJob(campaignId))!), started: true };
}
