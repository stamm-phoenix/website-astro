import type { HttpResponseInit } from '@azure/functions';
import { CONFIG } from './config';
import { EnvironmentVariable, getEnvironment } from './environment';
import { errorResponse } from './response-utils';

/** Stays below the HTTP limit of the Functions; an export takes about five seconds. */
const REQUEST_TIMEOUT_MS = 40_000;

/** One row of CampFlow's report „Einzelnachweise“ (Kasse → Auswertungen). */
export interface Einzelnachweis {
  receiptNumber: string | null;
  type: string | null;
  description: string | null;
  costUnit: string | null;
  category: string | null;
  paidBy: string | null;
  date: string | null;
  currency: string | null;
  amount: number;
  /** Income is positive, expenses are negative. */
  amountEur: number;
  unassignedAmount: number;
  unassignedAmountEur: number;
}

export interface Kostenstelle {
  id: string;
  name: string;
  archived: boolean;
}

export interface EinzelnachweiseResponse {
  costUnit: { id: string; name: string };
  entries: Einzelnachweis[];
}

export class PlaywrightApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'PlaywrightApiError';
  }
}

async function send<T>(
  path: string,
  query: Record<string, string>,
  accept: string,
  read: (response: Response) => Promise<T>
): Promise<T> {
  const url = new URL(path, CONFIG.playwrightApi.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  // Read outside the try block: a missing key is a configuration error, not an outage
  const apiKey = getEnvironment(EnvironmentVariable.PLAYWRIGHT_API_KEY);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, Accept: accept },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PlaywrightApiError(
        response.status,
        `Playwright API request ${url.pathname} failed: ${response.status} ${response.statusText}`
      );
    }
    return await read(response);
  } catch (error: unknown) {
    if (error instanceof PlaywrightApiError) throw error;
    // Timeouts and network errors look like an unavailable upstream to the caller
    throw new PlaywrightApiError(504, `Playwright API request ${url.pathname} failed: ${error}`);
  } finally {
    clearTimeout(timeout);
  }
}

function request<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  return send(path, query, 'application/json', async (response) => (await response.json()) as T);
}

/** One page of a receipt as PNG, as CampFlow shows it in its preview. */
export interface BelegBild {
  png: Uint8Array<ArrayBuffer>;
  /** Number of pages of the receipt. */
  pages: number;
}

/** A page (from 1) of the receipt with the given number (`receiptNumber` of the Einzelnachweise). */
export function getBelegBild(nummer: string, page: number): Promise<BelegBild> {
  return send(
    `/campflow/belege/${encodeURIComponent(nummer)}/bild`,
    { page: String(page) },
    'image/png',
    async (response) => ({
      png: new Uint8Array(await response.arrayBuffer()),
      pages: Math.max(1, Number(response.headers.get('x-campflow-pages')) || 1),
    })
  );
}

/** All income and expenses of a Kostenstelle, by its name or `cun_…` ID. */
export async function getEinzelnachweise(costUnit: string): Promise<EinzelnachweiseResponse> {
  return request<EinzelnachweiseResponse>('/campflow/einzelnachweise', { costUnit });
}

/** All Kostenstellen of the workspace, archived ones included. */
export async function getKostenstellen(): Promise<Kostenstelle[]> {
  const response = await request<{ data: { id: string; name: string; archived?: boolean }[] }>(
    '/campflow/kostenstellen'
  );
  return response.data.map(({ id, name, archived }) => ({ id, name, archived: archived === true }));
}

/** Maps errors of the Playwright API to API responses; other errors are rethrown. */
export function playwrightErrorResponse(
  error: unknown,
  costUnit?: string,
  notFound?: HttpResponseInit
): HttpResponseInit {
  if (!(error instanceof PlaywrightApiError)) throw error;

  switch (error.status) {
    case 404:
      if (notFound) return notFound;
      return errorResponse(
        404,
        'KOSTENSTELLE_NOT_FOUND',
        costUnit
          ? `Die Kostenstelle „${costUnit}“ gibt es in CampFlow nicht.`
          : 'Diese Kostenstelle gibt es in CampFlow nicht.'
      );
    case 401:
    case 403:
      return errorResponse(
        502,
        'PLAYWRIGHT_API_FORBIDDEN',
        'Der Zugriff auf die CampFlow-Auswertungen wurde verweigert. Bitte prüfe den API-Key.'
      );
    case 503:
      return errorResponse(
        502,
        'EINZELNACHWEISE_UNAVAILABLE',
        'Für die CampFlow-Auswertungen ist kein CampFlow-Login eingerichtet.'
      );
    default:
      return errorResponse(
        502,
        'EINZELNACHWEISE_UNAVAILABLE',
        'Die Einzelnachweise konnten nicht aus CampFlow geladen werden. Bitte versuche es später erneut.'
      );
  }
}
