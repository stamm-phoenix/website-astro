import { createHash } from 'node:crypto';
import { campflowGetAll } from './campflow';
import type { CampflowPerson } from './campflow';
import { EnvironmentVariable, getEnvironment } from './environment';
import { getSharePointListItem, updateSharePointListItem } from './sharepoint-data-access';
import { InvalidSammelDataError, sammelUrl } from './sammelbestellung-list';
import { email, object } from './sammelbestellung-validation';
import { ValidationError } from './pflege-validation';
import { sendSammelInvitationMail } from './sammelbestellung-mails';
import type { SammelAktion } from './sammelbestellung-model';

interface Recipient {
  address: string;
  status: 'pending' | 'attempted' | 'sent';
}
interface InvitationJob { recipients: Recipient[]; }

/** Includes primary and CC addresses of current members, once per normalized address. */
export function sammelInvitationRecipients(persons: CampflowPerson[], today: string): string[] {
  const addresses = new Set<string>();
  for (const person of persons) {
    if (typeof person.leave_date === 'string' && person.leave_date && person.leave_date <= today) continue;
    if (typeof person.join_date === 'string' && person.join_date > today) continue;
    const values = [person.primary_email, ...(Array.isArray(person.cc_emails) ? person.cc_emails : [])];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      try { addresses.add(email(value)); } catch { /* Skip invalid contact fields, never guess addresses. */ }
    }
  }
  if (addresses.size > 500) throw new ValidationError({ form: 'Mehr als 500 Empfänger. Bitte den Versand mit dem Team abstimmen.' });
  return [...addresses].sort();
}

/** Binds the confirmation to the exact deduplicated audience, without exposing addresses. */
export function sammelAudienceVersion(addresses: string[]): string {
  return createHash('sha256').update(JSON.stringify(addresses)).digest('hex');
}

async function loadJob(id: string): Promise<{ etag: string; job: InvitationJob | null }> {
  const raw = await getSharePointListItem(getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID), id);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidSammelDataError(id, 'Eintrag');
  const row = raw as Record<string, unknown>;
  if (typeof row.eTag !== 'string' || !row.eTag || row.eTag === '*') throw new InvalidSammelDataError(id, 'eTag');
  if (!row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) throw new InvalidSammelDataError(id, 'fields');
  const fields = row.fields as Record<string, unknown>;
  const value = fields.Einladungsversand;
  if (value === undefined || value === null || value === '') return { etag: String(row.eTag ?? ''), job: null };
  try {
    const parsed = object(JSON.parse(String(value)));
    if (!Array.isArray(parsed.recipients) || parsed.recipients.length > 500) throw new Error('Invalid recipients');
    const recipients = parsed.recipients.map((value): Recipient => {
      const recipient = object(value);
      if (!['pending', 'attempted', 'sent'].includes(String(recipient.status))) throw new Error('Invalid delivery state');
      return { address: email(recipient.address), status: recipient.status as Recipient['status'] };
    });
    if (new Set(recipients.map((row) => row.address)).size !== recipients.length) throw new Error('Duplicate recipient');
    return { etag: String(row.eTag ?? ''), job: { recipients } };
  } catch { throw new InvalidSammelDataError(id, 'Einladungsversand'); }
}

async function saveJob(id: string, job: InvitationJob, etag: string): Promise<void> {
  const serialized = JSON.stringify(job);
  if (serialized.length > 60_000) throw new ValidationError({ form: 'Der Versandverteiler ist zu groß.' });
  await updateSharePointListItem(getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID), id, { Einladungsversand: serialized }, etag);
}

/** Returns only counts. Attempted deliveries are never retried automatically after uncertain results. */
function summary(job: InvitationJob): { total: number; pending: number; sent: number; uncertain: number } {
  return { total: job.recipients.length, pending: job.recipients.filter((row) => row.status === 'pending').length, sent: job.recipients.filter((row) => row.status === 'sent').length, uncertain: job.recipients.filter((row) => row.status === 'attempted').length };
}

/** Previews the audience or advances one durably reserved delivery per request. */
export async function sammelInvitationStep(campaign: SammelAktion, action: 'preview' | 'send', version?: unknown): Promise<ReturnType<typeof summary> & { version?: string; started: boolean }> {
  let current = await loadJob(campaign.id);
  if (action === 'preview' && current.job) return { ...summary(current.job), started: true };
  if (!current.job) {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
    const addresses = sammelInvitationRecipients(await campflowGetAll<CampflowPerson>('/lists/member/persons'), today);
    const audienceVersion = sammelAudienceVersion(addresses);
    if (action === 'preview') return { total: addresses.length, pending: addresses.length, sent: 0, uncertain: 0, started: false, version: audienceVersion };
    if (version !== audienceVersion) throw new ValidationError({ form: 'Der CampFlow-Verteiler hat sich geändert. Bitte die Empfängerzahl erneut bestätigen.' });
    if (!addresses.length) throw new ValidationError({ form: 'Keine gültigen E-Mail-Adressen in CampFlow gefunden.' });
    await saveJob(campaign.id, { recipients: addresses.map((address) => ({ address, status: 'pending' })) }, current.etag);
    current = await loadJob(campaign.id);
  }
  const job = current.job!;
  const next = job.recipients.find((row) => row.status === 'pending');
  if (!next) return { ...summary(job), started: true };
  // Reserve before sending. ETags prevent concurrent tabs or instances from sending twice.
  next.status = 'attempted';
  await saveJob(campaign.id, job, current.etag);
  await sendSammelInvitationMail(next.address, campaign, sammelUrl('campaign', campaign.id));
  // Preserve unrelated campaign changes and delivery reservations when recording success.
  const latest = await loadJob(campaign.id);
  const delivered = latest.job?.recipients.find((row) => row.address === next.address);
  if (!delivered || delivered.status !== 'attempted') throw new InvalidSammelDataError(campaign.id, 'Einladungsversand');
  delivered.status = 'sent';
  await saveJob(campaign.id, latest.job!, latest.etag);
  return { ...summary(latest.job!), started: true };
}
