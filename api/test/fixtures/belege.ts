import { HttpRequest, InvocationContext } from '@azure/functions';
import type { TestContext } from 'node:test';
import * as blobStorage from '../../lib/blob-storage';
import * as taskDirectory from '../../lib/task-directory';

/** Shared helpers of the tests of the Belege: login, input, photos and storage in memory. */

export const STAFF_ROLES = ['authenticated', 'team_leitende'];
/** In the team „Kasse“ unless a test gives a principal `STAFF_ROLES`. */
export const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: [...STAFF_ROLES, 'team_kasse'],
};
export const INPUT = {
  shop: 'REWE',
  date: '2026-09-30',
  amountCent: 1234,
  paidBy: 'Alex Beispiel',
  payout: true,
  kostenstelle: 'Sommerlager 2026',
  kategorie: 'Verpflegungskosten',
  note: '',
};

/** Minimal JPEG header with a frame of the given size. */
export function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    ...new Array<number>(12).fill(0),
  ]);
}

export interface Storage {
  context: InvocationContext;
  blobs: Map<string, Buffer>;
  times: Map<string, Date>;
}

/** Blob Storage in memory and a quiet context. */
export function setup(t: TestContext): Storage {
  const blobs = new Map<string, Buffer>();
  const times = new Map<string, Date>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
    times.set(name, new Date());
  });
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, lastModified: times.get(name) ?? new Date() }))
  );
  t.mock.method(console, 'warn', () => undefined);
  // No team „Kasse“ to notify unless a test gives one
  t.mock.method(taskDirectory, 'readTaskDirectory', async () => []);
  const context = new InvocationContext({ functionName: 'belege-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return { context, blobs, times };
}

export function request(
  method: string,
  body?: unknown,
  options: { id?: string; etag?: string; principal?: unknown; query?: string } = {}
): HttpRequest {
  const binary = body instanceof Uint8Array;
  const headers: Record<string, string> = {
    'content-type': binary ? 'image/jpeg' : 'application/json',
  };
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? PRINCIPAL)
    ).toString('base64');
  }
  if (options.etag) headers['if-match'] = options.etag;
  return new HttpRequest({
    url: `http://localhost/api/intern/pflege/belege${options.query ?? ''}`,
    method,
    headers,
    params: options.id ? { id: options.id } : {},
    body:
      body === undefined || method === 'GET'
        ? undefined
        : binary
          ? { bytes: body }
          : { string: JSON.stringify(body) },
  });
}
