import { EnvironmentVariable, findEnvironment } from './environment';

const CAMPFLOW_BASE_URL = 'https://api.campflow.de';
const REQUEST_TIMEOUT_MS = 20_000;
/** Safety net against endless cursor loops. */
const MAX_PAGES = 50;

/** Format of CampFlow event ids, e.g. `evt_AbC123`. */
export const CAMPFLOW_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;

/** An event as returned by `GET /events`. */
export interface CampflowEvent {
  id: string;
  title: string;
  published: boolean;
  start_date: string | null;
  end_date: string | null;
  max_persons: number | null;
  archived: boolean;
  url: string | null;
  collection: { id: string; name: string } | null;
  [key: string]: unknown;
}

/** A custom field of a list, as returned by `GET /lists/{id}/custom_columns`. */
export interface CampflowColumn {
  id: string;
  name: string;
  type: string;
  allowed_values: string[] | null;
  external_id: string | null;
}

/** A person of a list. Besides the standard fields it holds custom fields as `col_…` keys. */
export interface CampflowPerson {
  id: string;
  [key: string]: unknown;
}

interface CampflowResponse<T> {
  data: T;
  meta?: { next_cursor?: string | null };
}

export class CampflowError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'CampflowError';
  }
}

/** Person fields that are never passed on to the browser. */
export const REDACTED_PERSON_FIELDS = ['bank_account', 'sepa_mandate'];

async function request<T>(
  path: string,
  query: Record<string, string> = {}
): Promise<CampflowResponse<T>> {
  const url = new URL(path, CAMPFLOW_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  // A missing token is an access problem, so callers can name it instead of failing with a 500
  const token = findEnvironment(EnvironmentVariable.CAMPFLOW_API_TOKEN);
  if (!token) throw new CampflowError(401, `${EnvironmentVariable.CAMPFLOW_API_TOKEN} is not set`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      throw new CampflowError(
        controller.signal.aborted ? 504 : 502,
        `CampFlow request ${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!response.ok) {
      throw new CampflowError(
        response.status,
        `CampFlow request ${url.pathname} failed: ${response.status} ${response.statusText}`
      );
    }
    return (await response.json()) as CampflowResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

/** Loads a single CampFlow resource. */
export async function campflowGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  return (await request<T>(path, query)).data;
}

/** Loads all pages of a paginated CampFlow collection. */
export async function campflowGetAll<T>(
  path: string,
  query: Record<string, string> = {}
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await request<T[]>(path, cursor ? { ...query, cursor } : query);
    items.push(...response.data);
    cursor = response.meta?.next_cursor;
    if (!cursor) break;
  }

  if (cursor) throw new CampflowError(502, 'CampFlow pagination limit exceeded');
  return items;
}

/** How long a shared load is reused; a change in CampFlow shows up after at most this time. */
const SHARED_TTL_MS = 60_000;

/**
 * Requests share a running load and its result for a minute after it arrived, so a page and the
 * pages opened from it do not each wait for CampFlow; a failed load is not kept. Callers must not
 * change the result.
 */
function sharedLoad<T>(load: () => Promise<T>): {
  get: () => Promise<T>;
  getWithTime: () => Promise<{ value: T; loadedAt: Date }>;
  reset: () => void;
} {
  let current: { promise: Promise<T>; expires: number; startedAt: Date } | undefined;
  function entry(): NonNullable<typeof current> {
    if (current && current.expires > Date.now()) return current;
    const started = { promise: load(), expires: Infinity, startedAt: new Date() };
    current = started;
    started.promise.then(
      () => {
        started.expires = Date.now() + SHARED_TTL_MS;
      },
      () => {
        if (current === started) current = undefined;
      }
    );
    return started;
  }
  return {
    get: () => entry().promise,
    async getWithTime() {
      const { promise, startedAt } = entry();
      return { value: await promise, loadedAt: startedAt };
    },
    reset() {
      current = undefined;
    },
  };
}

const events = sharedLoad(async () => {
  const loaded = await campflowGetAll<CampflowEvent>('/events');
  for (const event of loaded) delete event.embed_snippet;
  return loaded;
});

const members = sharedLoad(() => campflowGetAll<CampflowPerson>('/lists/member/persons'));

/** All events, without the embed snippet as it is of no use here; shared for a minute. */
export function getCampflowEvents(): Promise<CampflowEvent[]> {
  return events.get();
}

/** All persons of the member list; shared for a minute. */
export function getCampflowMembers(): Promise<CampflowPerson[]> {
  return members.get();
}

/**
 * All persons of the member list with the time CampFlow was asked; shared for a minute, unless
 * `refresh` asks CampFlow again (the new load is then shared with the other modules).
 */
export function getCampflowMembersWithTime(
  refresh = false
): Promise<{ value: CampflowPerson[]; loadedAt: Date }> {
  if (refresh) members.reset();
  return members.getWithTime();
}

/** Forgets the shared loads (for tests). */
export function resetCampflowLoads(): void {
  events.reset();
  members.reset();
}

/** Removes payment details that should not leave the API. */
export function sanitizePerson(person: CampflowPerson): CampflowPerson {
  const sanitized: CampflowPerson = { ...person };
  for (const field of REDACTED_PERSON_FIELDS) delete sanitized[field];
  return sanitized;
}
