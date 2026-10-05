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
  /** When the report was exported from CampFlow (ISO 8601); the API serves it from a cache. */
  exportedAt?: string;
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
  read: (response: Response) => Promise<T>,
  options: { method?: 'PUT'; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const url = new URL(path, CONFIG.playwrightApi.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  // Read outside the try block: a missing key is a configuration error, not an outage
  const apiKey = getEnvironment(EnvironmentVariable.PLAYWRIGHT_API_KEY);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method,
      redirect: 'error',
      headers: {
        'x-api-key': apiKey,
        Accept: accept,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal,
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

function request<T>(
  path: string,
  query: Record<string, string> = {},
  options: { method?: 'PUT'; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  return send(
    path,
    query,
    'application/json',
    async (response) => (await response.json()) as T,
    options
  );
}

export type CampflowSphere = 'ideal' | 'purpose' | 'assets' | 'business';

interface KostenstelleWithCategories extends Kostenstelle {
  categories: { name: string; sphere: CampflowSphere }[];
}

/** Validate upstream mappings before relying on them for a financial write. */
function readKostenstelle(value: unknown): KostenstelleWithCategories {
  if (!value || typeof value !== 'object') throw new PlaywrightApiError(502, 'Invalid cost centre');
  const unit = value as Record<string, unknown>;
  if (
    typeof unit.id !== 'string' ||
    !unit.id.startsWith('cun_') ||
    typeof unit.name !== 'string' ||
    !unit.name.trim() ||
    typeof unit.archived !== 'boolean' ||
    !Array.isArray(unit.categories) ||
    !unit.categories.every((category: unknown) => {
      if (!category || typeof category !== 'object') return false;
      const item = category as Record<string, unknown>;
      return (
        typeof item.name === 'string' &&
        ['ideal', 'purpose', 'assets', 'business'].includes(String(item.sphere))
      );
    })
  )
    throw new PlaywrightApiError(502, 'Invalid cost centre');
  return unit as unknown as KostenstelleWithCategories;
}

/** Ensure the saved expense assignment exists before the contribution becomes attempted. */
export async function ensureCampflowExpenseAssignment(
  costunitName: string,
  categoryName: string,
  sphere: CampflowSphere
): Promise<void> {
  // Bound the entire prerequisite workflow, not just each separate browser request.
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const sameName = (a: string, b: string): boolean =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  const find = async (): Promise<KostenstelleWithCategories | undefined> => {
    const response = await request<unknown>('/campflow/kostenstellen', {}, { signal });
    const data =
      response && typeof response === 'object'
        ? (response as Record<string, unknown>).data
        : undefined;
    if (!Array.isArray(data)) throw new PlaywrightApiError(502, 'Invalid cost centre list');
    return data.map(readKostenstelle).find((unit) => sameName(unit.name, costunitName));
  };
  const put = async (
    path: string,
    body: unknown
  ): Promise<KostenstelleWithCategories | undefined> => {
    try {
      return readKostenstelle(await request<unknown>(path, {}, { method: 'PUT', body, signal }));
    } catch (error: unknown) {
      // A concurrent caller may have created it. Read back; never blindly repeat a PUT.
      if (error instanceof PlaywrightApiError && error.status === 409) return find();
      throw error;
    }
  };
  let unit = await find();
  if (!unit)
    unit = await put('/campflow/kostenstellen', {
      name: costunitName,
      categories: [{ name: categoryName, sphere }],
    });
  if (!unit || !sameName(unit.name, costunitName))
    throw new PlaywrightApiError(502, 'Cost centre creation could not be confirmed');
  if (unit.archived) throw new PlaywrightApiError(409, 'The cost centre is archived');
  if (!unit.categories.some((category) => sameName(category.name, categoryName))) {
    unit = await put(`/campflow/kostenstellen/${encodeURIComponent(unit.id)}/kategorien`, {
      name: categoryName,
      sphere,
    });
  }
  if (
    !unit ||
    unit.archived ||
    !sameName(unit.name, costunitName) ||
    !unit.categories.some((category) => sameName(category.name, categoryName))
  )
    throw new PlaywrightApiError(502, 'Category creation could not be confirmed');
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
/**
 * The Einzelnachweise of a Kostenstelle. The Playwright API keeps the last export; `refresh`
 * makes it export them from CampFlow again (a few seconds).
 */
export async function getEinzelnachweise(
  costUnit: string,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<EinzelnachweiseResponse> {
  return request<EinzelnachweiseResponse>('/campflow/einzelnachweise', {
    costUnit,
    ...(refresh ? { refresh: 'true' } : {}),
  });
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
