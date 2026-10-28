import { createHash } from 'node:crypto';
import type { InvocationContext } from '@azure/functions';
import { CONFIG } from './config';
import { InvalidNikolausStateError, mutateNikolausState } from './nikolaus-state';
import { readRequestBudget } from './request-budget';
import type { RequestBudget } from './request-budget';

type MailQuotaState = RequestBudget;

const permitBrand = Symbol('nikolaus-mail-permit');
export interface NikolausMailPermit {
  readonly [permitBrand]: true;
}
const permits = new WeakSet<NikolausMailPermit>();

export class NikolausMailQuotaError extends Error {
  constructor() {
    super('Der Nikolaus-Mailversand ist vorübergehend begrenzt. Bitte später erneut versuchen.');
    this.name = 'NikolausMailQuotaError';
  }
}

function parseQuota(value: unknown, now: number, key: string): MailQuotaState {
  const quota = readRequestBudget(value, now);
  if (!quota) throw new InvalidNikolausStateError(key);
  return quota;
}

/** A denied or failed reservation is never refunded after an ambiguous storage response. */
async function reserveBudget(
  key: string,
  now: number,
  hourly: number,
  daily: number
): Promise<boolean> {
  return Boolean(
    await mutateNikolausState(
      key,
      (value) => parseQuota(value, now, key),
      (current) => {
        if (current.hourCount >= hourly || current.dayCount >= daily) return undefined;
        return { ...current, hourCount: current.hourCount + 1, dayCount: current.dayCount + 1 };
      }
    )
  );
}

/** A shared sender budget covers all instances and previews using that sender/list. */
export async function reserveNikolausMailQuota(
  context?: Pick<InvocationContext, 'warn'>,
  now = Date.now(),
  purpose: 'mail' | 'resend' = 'mail'
): Promise<NikolausMailPermit | undefined> {
  const sender = CONFIG.mail.nikolausSender.trim().toLowerCase();
  const key = `mailquota:${createHash('sha256').update(sender).digest('hex')}`;
  const { mailHourlyLimit: hourly, mailDailyLimit: daily } = CONFIG.nikolaus;
  // Keep anonymous admission separate so older sender writers cannot erase its counters.
  // Resends consume at most one fifth of the sender budget, then the shared quota too.
  const result =
    (purpose !== 'resend' ||
      (await reserveBudget(`${key}:resend`, now, Math.floor(hourly / 5), Math.floor(daily / 5)))) &&
    (await reserveBudget(key, now, hourly, daily));
  if (!result) {
    const event = `[nikolaus-mail-quota] ${JSON.stringify({ event: 'limit', senderKey: key })}`;
    if (context) context.warn(event);
    else console.warn(event);
    return undefined;
  }
  const permit: NikolausMailPermit = { [permitBrand]: true };
  permits.add(permit);
  return permit;
}

/** Admission permits are single-use and cannot be forged from an HTTP request body. */
export function consumeNikolausMailPermit(permit: NikolausMailPermit): boolean {
  if (!permits.has(permit)) return false;
  permits.delete(permit);
  return true;
}
