import { createHash } from 'node:crypto';
import type { InvocationContext } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from './environment';
import { InvalidNikolausStateError, mutateNikolausState } from './nikolaus-state';

interface MailQuotaState {
  hour: number;
  hourCount: number;
  day: number;
  dayCount: number;
}

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

function limit(variable: string, fallback: number): number {
  const raw = process.env[variable];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid quota limit: ${variable}`);
  return value;
}

function parseQuota(value: unknown, now: number, key: string): MailQuotaState {
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  if (value === undefined) return { hour, hourCount: 0, day, dayCount: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidNikolausStateError(key);
  const row = value as Record<string, unknown>;
  for (const field of ['hour', 'hourCount', 'day', 'dayCount'])
    if (!Number.isSafeInteger(row[field]) || Number(row[field]) < 0)
      throw new InvalidNikolausStateError(key);
  if (Number(row.hour) > hour || Number(row.day) > day) throw new InvalidNikolausStateError(key);
  return {
    hour,
    day,
    hourCount: row.hour === hour ? Number(row.hourCount) : 0,
    dayCount: row.day === day ? Number(row.dayCount) : 0,
  };
}

/** A shared sender budget covers all instances and previews using that sender/list. */
export async function reserveNikolausMailQuota(
  context?: Pick<InvocationContext, 'warn'>,
  now = Date.now()
): Promise<NikolausMailPermit | undefined> {
  const sender = getEnvironment(EnvironmentVariable.NIKOLAUS_MAIL_SENDER).trim().toLowerCase();
  const key = `mailquota:${createHash('sha256').update(sender).digest('hex')}`;
  const hourly = limit('NIKOLAUS_MAIL_HOURLY_LIMIT', 100);
  const daily = limit('NIKOLAUS_MAIL_DAILY_LIMIT', 500);
  const result = await mutateNikolausState(
    key,
    (value) => parseQuota(value, now, key),
    (current) => {
      if (current.hourCount >= hourly || current.dayCount >= daily) return undefined;
      return { ...current, hourCount: current.hourCount + 1, dayCount: current.dayCount + 1 };
    }
  );
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
