import type { HttpResponseInit } from '@azure/functions';
import { CONFIG } from './config';
import { EnvironmentVariable, getEnvironment } from './environment';
import {
  belegUploadedSchema,
  categoryListSchema,
  errorDetailSchema,
  kostenstelleSchema,
  kostenstellenListSchema,
} from './playwright-api-schema';
import type { CampflowSphere, KostenstelleWithCategories } from './playwright-api-schema';
import { errorResponse } from './response-utils';

export type { CampflowSphere } from './playwright-api-schema';

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
  /** The Kategorien of the Kostenstelle, to book a receipt on one of them. */
  categories: { id: string; name: string }[];
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
    message: string,
    /** The API's own explanation (`error` of its JSON body), e.g. which Kategorie is missing. */
    public detail = ''
  ) {
    super(message);
    this.name = 'PlaywrightApiError';
  }
}

/** The `error` text of a failed response of the Playwright API, if it sent one. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = errorDetailSchema.safeParse(await response.json());
    return body.success ? body.data.error : '';
  } catch {
    return '';
  }
}

async function send<T>(
  path: string,
  query: Record<string, string>,
  accept: string,
  read: (response: Response) => Promise<T>,
  options: { method?: 'PUT' | 'POST'; body?: unknown; signal?: AbortSignal } = {}
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
        `Playwright API request ${url.pathname} failed: ${response.status} ${response.statusText}`,
        await errorDetail(response)
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
  options: { method?: 'PUT' | 'POST'; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  return send(
    path,
    query,
    'application/json',
    async (response) => (await response.json()) as T,
    options
  );
}

/** Validate upstream mappings before relying on them for a financial write. */
function readKostenstelle(value: unknown): KostenstelleWithCategories {
  const result = kostenstelleSchema.safeParse(value);
  if (!result.success) throw new PlaywrightApiError(502, 'Invalid cost centre');
  return result.data;
}

/**
 * Whether two names of a Kostenstelle or Kategorie are the same, ignoring case and runs of spaces:
 * the website saves names with single spaces (`Reader.text`), CampFlow may hold more.
 */
export function sameCampflowName(a: string, b: string): boolean {
  const fold = (text: string): string => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
  return fold(a) === fold(b);
}

/** Ensure the saved expense assignment exists before the contribution becomes attempted. */
export async function ensureCampflowExpenseAssignment(
  costunitName: string,
  categoryName: string,
  sphere: CampflowSphere,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  // Bound the entire prerequisite workflow, not just each separate browser request.
  const signal = options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const sameName = sameCampflowName;
  const find = async (): Promise<KostenstelleWithCategories | undefined> => {
    const response = await request<unknown>('/campflow/kostenstellen', {}, { signal });
    const list = kostenstellenListSchema.safeParse(response);
    if (!list.success) throw new PlaywrightApiError(502, 'Invalid cost centre list');
    const matches = list.data.data
      .map(readKostenstelle)
      .filter((unit) => sameName(unit.name, costunitName));
    // An archived one of the same name only counts if there is no other
    return matches.find((unit) => !unit.archived) ?? matches[0];
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

/**
 * The small preview of a receipt as CampFlow's list shows it, by number or, not booked yet, by
 * its ID (`rcp_…`). The Playwright API keeps it once fetched.
 */
export function getBelegVorschau(nummer: string): Promise<Uint8Array> {
  return send(
    `/campflow/belege/${encodeURIComponent(nummer)}/vorschau`,
    {},
    'image/png',
    async (response) => new Uint8Array(await response.arrayBuffer())
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

/**
 * All Sammlungen and Beiträge of CampFlow's page „Beiträge“, unchecked (see `readBeitraege`).
 * The Playwright API keeps the last result; `refresh` makes it read CampFlow again (about ten
 * seconds).
 */
export function getBeitraege({ refresh = false }: { refresh?: boolean } = {}): Promise<unknown> {
  return request<unknown>('/campflow/beitraege', refresh ? { refresh: 'true' } : {});
}

/**
 * The persons of a CampFlow event (`evt_…`) with their Beiträge, unchecked (see
 * `readAktionBeitraege`). The Playwright API keeps the last result per event; `refresh` makes it
 * read CampFlow again (a few seconds).
 */
export function getAktionBeitraege(
  eventId: string,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<unknown> {
  return request<unknown>(
    `/campflow/aktionen/${encodeURIComponent(eventId)}/beitraege`,
    refresh ? { refresh: 'true' } : {}
  );
}

/**
 * All receipts of CampFlow's page „Belege“ with booking and payment state, unchecked (see
 * `readCampflowBelege`). The Playwright API keeps the last result until `refresh` or an upload.
 */
export function getCampflowBelege({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<unknown> {
  return request<unknown>('/campflow/belege', refresh ? { refresh: 'true' } : {});
}

/**
 * All Kostenstellen of the workspace with their Kategorien, archived ones included. The
 * Playwright API keeps the last list; `refresh` makes it read CampFlow again.
 */
export async function getKostenstellen({
  refresh = false,
  signal,
}: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<Kostenstelle[]> {
  const response = await request<{
    data: { id: string; name: string; archived?: boolean; categories?: unknown }[];
  }>('/campflow/kostenstellen', refresh ? { refresh: 'true' } : {}, { signal });
  return response.data.map(({ id, name, archived, categories }) => ({
    id,
    name,
    archived: archived === true,
    categories: categoryListSchema.parse(categories),
  }));
}

/**
 * Income and expenses of every Kostenstelle and its Kategorien, only the sums, unchecked (see
 * `readKostenstellenSummen`). The Playwright API keeps the last export; `refresh` makes it export
 * CampFlow's report again (a few seconds).
 */
export function getKostenstellenSummen({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<unknown> {
  return request<unknown>('/campflow/kostenstellen/summen', refresh ? { refresh: 'true' } : {});
}

/** A receipt to upload to CampFlow and book as an expense (`POST /campflow/belege`). */
export interface CampflowBelegUpload {
  /** File name in CampFlow; the Playwright API's key against duplicates, unique per receipt. */
  filename: string;
  content: Uint8Array;
  description: string;
  /** `YYYY-MM-DD` */
  date: string;
  /**
   * An income instead of an expense. Only sent for income, so expenses work also with a
   * Playwright API that does not know the field yet.
   */
  type?: 'income';
  /** Positive. */
  amountCent: number;
  /** „Auslage durch“: who gets the money back, null if nobody; always null for income. */
  disburser: string | null;
  /** `cun_…` */
  costUnit: string;
  /** `cat_…` */
  category: string;
}

export interface CampflowBelegUploaded {
  /** False if CampFlow had the receipt already, e.g. from an attempt whose answer was lost. */
  created: boolean;
  number: string;
  receiptId: string;
  expenseId: string;
}

/**
 * Uploads a receipt to CampFlow and books it. The Playwright API returns an existing booking
 * with the same file name instead of creating a second one, so repeating a call with the same
 * file name, Kostenstelle and Kategorie after a lost answer is safe.
 */
export async function uploadCampflowBeleg(
  beleg: CampflowBelegUpload,
  options: { signal?: AbortSignal } = {}
): Promise<CampflowBelegUploaded> {
  const { content, ...fields } = beleg;
  const response = await request<unknown>(
    '/campflow/belege',
    {},
    {
      method: 'POST',
      body: { ...fields, content: Buffer.from(content).toString('base64') },
      signal: options.signal,
    }
  );
  const uploaded = belegUploadedSchema.safeParse(response);
  if (!uploaded.success) throw new PlaywrightApiError(502, 'Invalid receipt upload response');
  return uploaded.data;
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
