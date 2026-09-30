import { EnvironmentVariable, getEnvironment } from './environment';

const CAMPFLOW_BASE_URL = 'https://api.campflow.de';
const REQUEST_TIMEOUT_MS = 20_000;
/** Safety net against endless cursor loops. */
const MAX_PAGES = 50;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${getEnvironment(EnvironmentVariable.CAMPFLOW_API_TOKEN)}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
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

  return items;
}

/** Loads all events; the embed snippet is dropped as it is of no use here. */
export async function getCampflowEvents(): Promise<CampflowEvent[]> {
  const events = await campflowGetAll<CampflowEvent>('/events');
  for (const event of events) delete event.embed_snippet;
  return events;
}

/** Removes payment details that should not leave the API. */
export function sanitizePerson(person: CampflowPerson): CampflowPerson {
  const sanitized: CampflowPerson = { ...person };
  for (const field of REDACTED_PERSON_FIELDS) delete sanitized[field];
  return sanitized;
}
