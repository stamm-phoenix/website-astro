import { z } from 'zod';
import { getGraphStatus } from './sharepoint-data-access';
import { getClient } from './token';

/**
 * Shared building blocks of the Graph access of the module „E-Mail“ (`postfach-graph.ts`,
 * `postfach-anhaenge.ts`): the seam for the tests, the paths, the immutable IDs and the readers of
 * collections. All IDs are immutable IDs (`Prefer: IdType="ImmutableId"`), so a message keeps its
 * ID when someone moves it in Outlook.
 */

export const TIMEOUT_MS = 10_000;

export const IMMUTABLE = 'IdType="ImmutableId"';

/** Graph refused the mailbox: the app may not read it, or it does not exist. */
export class PostfachZugriffError extends Error {
  constructor(public readonly address: string) {
    super(`Graph refused the mailbox ${address}.`);
    this.name = 'PostfachZugriffError';
  }
}

/** Graph refused a change of the mailbox: the app may read it, but not change it. */
export class PostfachSchreibError extends Error {
  constructor(public readonly address: string) {
    super(`Graph refused to change the mailbox ${address}.`);
    this.name = 'PostfachSchreibError';
  }
}

/** The attachment cannot be downloaded here (too large, or an attached item instead of a file). */
export class AnhangNichtLadbarError extends Error {
  constructor() {
    super('The attachment cannot be downloaded through the API.');
    this.name = 'AnhangNichtLadbarError';
  }
}

/** Graph requests of this module; a seam for the tests. */
export const postfachGraph = {
  async get(path: string, query: Record<string, string>, prefer: string[]): Promise<unknown> {
    return getClient()
      .api(path)
      .query(query)
      .header('Prefer', prefer.join(', '))
      .option('signal', AbortSignal.timeout(TIMEOUT_MS))
      .get();
  },
  /** The next page of a collection, from its `@odata.nextLink`. */
  async next(url: string, prefer: string[]): Promise<unknown> {
    return getClient()
      .api(url)
      .header('Prefer', prefer.join(', '))
      .option('signal', AbortSignal.timeout(TIMEOUT_MS))
      .get();
  },
  async post(path: string, body: unknown): Promise<unknown> {
    return getClient().api(path).option('signal', AbortSignal.timeout(TIMEOUT_MS)).post(body);
  },
  /** Changes a message; the path holds its immutable ID. */
  async patch(path: string, body: unknown): Promise<unknown> {
    return getClient()
      .api(path)
      .header('Prefer', IMMUTABLE)
      .option('signal', AbortSignal.timeout(TIMEOUT_MS))
      .patch(body);
  },
};

export function mailboxPath(address: string): string {
  return `/users/${encodeURIComponent(address)}`;
}

/** Maps a refusal of Graph (403, 404) to `PostfachZugriffError`; other errors pass. */
export async function guarded<T>(address: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    const status = getGraphStatus(error);
    if (status === 401 || status === 403 || status === 404) throw new PostfachZugriffError(address);
    throw error;
  }
}

export const text = z.string().catch('');

export const collectionSchema = z.object({
  value: z.array(z.unknown()),
  '@odata.nextLink': z.string().optional(),
});

/**
 * A continuation must stay on Graph and continue the same kind of collection (`/messages`,
 * `/attachments`). Graph may write the mailbox differently in it (e.g. by ID), so the whole path
 * is not compared.
 */
export function nextLinkOf(response: unknown, path: string): string | null {
  const parsed = collectionSchema.safeParse(response);
  const next = parsed.success ? parsed.data['@odata.nextLink'] : undefined;
  if (!next) return null;
  const url = new URL(next);
  const sammlung = path.slice(path.lastIndexOf('/'));
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.endsWith(sammlung))
    throw new Error('Invalid Graph continuation');
  return next;
}

/** Entries that do not parse are skipped, so one odd message does not hide the mailbox. */
export function readCollection<S extends z.ZodType>(schema: S, response: unknown): z.output<S>[] {
  const parsed = collectionSchema.safeParse(response);
  if (!parsed.success) throw new Error('Invalid Graph message collection');
  return parsed.data.value.flatMap((item) => {
    const entry = schema.safeParse(item);
    return entry.success ? [entry.data] : [];
  });
}
