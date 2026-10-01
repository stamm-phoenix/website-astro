import { EnvironmentVariable, getEnvironment } from './environment';
import { InvalidSammelDataError } from './sammelbestellung-list';
import { getGraphStatus, getSharePointListItem, updateSharePointListItem } from './sharepoint-data-access';

interface LinkQuota {
  hour: number;
  hourCount: number;
  day: number;
  dayCount: number;
}

const HOUR_LIMIT = 100;
const DAY_LIMIT = 500;
const QUOTA_FIELD = 'LinkversandLimit';

/** Reads durable UTC window counters; a missing value starts an unused quota, corrupt data fails closed. */
function readQuota(value: unknown, id: string, now: number): LinkQuota {
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  if (value === undefined || value === null || value === '')
    return { hour, hourCount: 0, day, dayCount: 0 };
  try {
    const raw: unknown = typeof value === 'string' ? JSON.parse(value) : undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid quota');
    const record = raw as Record<string, unknown>;
    for (const field of ['hour', 'hourCount', 'day', 'dayCount'])
      if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 0)
        throw new Error('Invalid counter');
    return {
      hour,
      day,
      hourCount: record.hour === hour ? Number(record.hourCount) : 0,
      dayCount: record.day === day ? Number(record.dayCount) : 0,
    };
  } catch {
    throw new InvalidSammelDataError(id, QUOTA_FIELD);
  }
}

/** Reserves before order creation, across instances and restarts, without refunding failed attempts. */
export async function reserveSammelLinkRequest(id: string, now = Date.now()): Promise<boolean> {
  const list = getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID);
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await getSharePointListItem(list, id);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    if (typeof row.eTag !== 'string' || !row.eTag || row.eTag === '*')
      throw new InvalidSammelDataError(id, 'eTag');
    if (!row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields))
      throw new InvalidSammelDataError(id, QUOTA_FIELD);
    const fields = row.fields as Record<string, unknown>;
    const quota = readQuota(fields[QUOTA_FIELD], id, now);
    if (quota.hourCount >= HOUR_LIMIT || quota.dayCount >= DAY_LIMIT) return false;
    quota.hourCount++;
    quota.dayCount++;
    try {
      await updateSharePointListItem(list, id, { [QUOTA_FIELD]: JSON.stringify(quota) }, row.eTag);
      return true;
    } catch (error: unknown) {
      if (getGraphStatus(error) !== 412) throw error;
    }
  }
  return false;
}
