/**
 * Read-only access to NaMi, the member register of the DPSG (`docs/nami-abgleich.md`). The only
 * request that is not a GET is the login; nothing is ever written to NaMi.
 *
 * Checked against the real NaMi in November 2026: `POST …/auth/manual/sessionStartup` answers
 * with a redirect to `…/auth/loginActivatin/<token>/API`, and only the GET of that address
 * activates the session (`statusCode` 0). Lists answer `{ success, data, totalEntries }`, an
 * expired session `{ success: false, message: "Session expired" }`. The address of a member is
 * only in its single view, not in the list.
 */
import { CONFIG } from './config';
import { EnvironmentVariable, findEnvironment } from './environment';
import { namiMemberDetail, namiMemberListEntry, type NamiMitglied } from './nami-schema';

const REQUEST_TIMEOUT_MS = 15_000;
/**
 * The whole load (login, list, single views) ends within this time, below the 30 seconds the
 * browser waits for a read (`web/src/lib/apiTimeout.ts`) and the 45 seconds of the Static Web
 * App; single views still missing then keep no address.
 */
const LOAD_BUDGET_MS = 25_000;
/** Single views read at the same time; NaMi is slow, but must not be flooded. */
const DETAIL_CONCURRENCY = 6;
/** How long a load is reused; the page offers „Neu laden“ for a newer state. */
const SHARED_TTL_MS = 5 * 60_000;

export type { NamiMitglied } from './nami-schema';

export class NamiError extends Error {
  constructor(
    /** 401 for a missing or refused login, 502/504 for NaMi not answering as expected. */
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'NamiError';
  }
}

interface NamiSession {
  cookie: string;
  /** Aborts every request of the load once its time budget is used up. */
  deadline?: AbortSignal;
}

interface NamiAnswer {
  response: Response;
  /** The parsed JSON body, `null` when there is none or it is no JSON. */
  body: unknown;
}

/**
 * Sends a request and reads its whole body within the time limit, so an answer whose body
 * stalls fails like one that never came.
 */
async function call(
  url: string,
  init: RequestInit = {},
  deadline?: AbortSignal
): Promise<NamiAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = deadline ? AbortSignal.any([controller.signal, deadline]) : controller.signal;
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      // No JSON; callers treat it as a missing answer
    }
    return { response, body };
  } catch (error: unknown) {
    throw new NamiError(
      signal.aborted ? 504 : 502,
      `NaMi request ${new URL(url).pathname} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function sessionCookie(response: Response): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const match = /^JSESSIONID=([^;]+)/.exec(header);
    if (match) return `JSESSIONID=${match[1]}`;
  }
  return undefined;
}

/** Logs in with the account of the environment; the login is the only request that is not a GET. */
export async function namiLogin(deadline?: AbortSignal): Promise<NamiSession> {
  const username = findEnvironment(EnvironmentVariable.NAMI_USERNAME);
  const password = findEnvironment(EnvironmentVariable.NAMI_PASSWORD);
  if (!username || !password) throw new NamiError(401, 'NaMi login is not configured');

  const base = CONFIG.nami.baseUrl;
  const startup = await call(
    `${base}/nami/auth/manual/sessionStartup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ username, password, Login: 'API', redirectTo: './app.jsp' }),
    },
    deadline
  );
  let cookie = sessionCookie(startup.response);
  let answer = startup;
  const location = startup.response.headers.get('location');
  if (startup.response.status >= 300 && startup.response.status < 400 && location) {
    // NaMi names its own address with http://; the activation must stay on https
    const activation = new URL(location, base);
    if (activation.host !== new URL(base).host) {
      throw new NamiError(502, 'NaMi redirected the login to another host');
    }
    activation.protocol = new URL(base).protocol;
    answer = await call(
      activation.href,
      { headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) } },
      deadline
    );
    cookie = sessionCookie(answer.response) ?? cookie;
  }

  const body = answer.body as { statusCode?: unknown } | null;
  if (!answer.response.ok || body?.statusCode !== 0) {
    throw new NamiError(401, `NaMi login refused (status ${answer.response.status})`);
  }
  if (!cookie) throw new NamiError(502, 'NaMi login set no session');
  return { cookie, deadline };
}

/** Reads a NaMi resource with GET; everything but the login goes through here. */
export async function namiGet(session: NamiSession, path: string): Promise<unknown> {
  const { response, body: answer } = await call(
    `${CONFIG.nami.baseUrl}${path}`,
    { method: 'GET', headers: { Accept: 'application/json', Cookie: session.cookie } },
    session.deadline
  );
  if (!response.ok) {
    throw new NamiError(502, `NaMi request failed: ${response.status} ${response.statusText}`);
  }
  const body = answer as {
    success?: unknown;
    data?: unknown;
    message?: unknown;
  } | null;
  if (!body || body.success !== true) {
    const message = typeof body?.message === 'string' ? body.message : 'no data';
    throw new NamiError(/session/i.test(message) ? 401 : 502, `NaMi answered: ${message}`);
  }
  return body.data;
}

/** Ends the session; a failure changes nothing for the caller. */
async function namiLogout(session: NamiSession): Promise<void> {
  try {
    await call(`${CONFIG.nami.baseUrl}/nami/auth/logout`, {
      method: 'GET',
      headers: { Cookie: session.cookie },
    });
  } catch {
    // The session expires on its own
  }
}

/** Runs `work` for all items, at most `limit` at a time. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * All members of our Stamm in NaMi, active and inactive, each with the address of its single
 * view. A single view that fails keeps the member without address.
 */
export async function loadNamiMitglieder(): Promise<NamiMitglied[]> {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), LOAD_BUDGET_MS);
  timer.unref?.();
  const deadline = budget.signal;
  try {
    return await loadWithin(deadline);
  } finally {
    clearTimeout(timer);
  }
}

async function loadWithin(deadline: AbortSignal): Promise<NamiMitglied[]> {
  const session = await namiLogin(deadline);
  try {
    const gruppierung = `/nami/mitglied/filtered-for-navigation/gruppierung/gruppierung/${CONFIG.nami.gruppierungId}`;
    const list = await namiGet(session, `${gruppierung}/flist?page=1&start=0&limit=5000`);
    if (!Array.isArray(list)) throw new NamiError(502, 'NaMi sent no member list');
    const members = list.flatMap((entry: unknown) => {
      const parsed = namiMemberListEntry.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
    return await mapLimited(members, DETAIL_CONCURRENCY, async (member) => {
      // Once the time is up, the remaining members keep no address instead of failing the load
      if (deadline.aborted) return member;
      try {
        const detail = namiMemberDetail.safeParse(
          await namiGet(session, `${gruppierung}/${member.id}`)
        );
        return detail.success ? { ...member, ...detail.data } : member;
      } catch (error: unknown) {
        if (error instanceof NamiError && error.status === 401 && !deadline.aborted) throw error;
        return member;
      }
    });
  } finally {
    await namiLogout(session);
  }
}

let shared: { promise: Promise<NamiMitglied[]>; loadedAt: Date; expires: number } | undefined;

/**
 * The NaMi members with the time NaMi was asked; shared for five minutes unless `refresh` asks
 * NaMi again. A failed load is not kept, and the result is dropped after the five minutes.
 */
export function getNamiMitglieder(
  refresh = false
): Promise<{ value: NamiMitglied[]; loadedAt: Date }> {
  if (refresh || !shared || shared.expires <= Date.now()) {
    const started = { promise: loadNamiMitglieder(), loadedAt: new Date(), expires: Infinity };
    shared = started;
    started.promise.then(
      () => {
        started.expires = Date.now() + SHARED_TTL_MS;
        const timer = setTimeout(() => {
          if (shared === started) shared = undefined;
        }, SHARED_TTL_MS);
        timer.unref?.();
      },
      () => {
        if (shared === started) shared = undefined;
      }
    );
  }
  const { promise, loadedAt } = shared;
  return promise.then((value) => ({ value, loadedAt }));
}

/** Forgets the shared load (for tests). */
export function resetNamiLoad(): void {
  shared = undefined;
}
