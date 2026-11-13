/** Browser-safe reading of the version a row carries as its etag (`toVersion` in `db.ts`). */

/** Format of an etag: a quoted, fixed-width hex rowversion. */
export const ETAG_PATTERN = /^"([0-9a-f]{16})"$/;

/** The rowversion of an etag, which grows with every change in the database; `null` if malformed. */
export function etagNumber(etag: string | undefined): bigint | null {
  const match = ETAG_PATTERN.exec(etag?.trim() ?? '');
  return match ? BigInt(`0x${match[1]}`) : null;
}

/** Whether `candidate` is a later version than `current`; `false` if either is malformed. */
export function etagNewer(candidate: string, current: string): boolean {
  const next = etagNumber(candidate);
  const old = etagNumber(current);
  return next !== null && old !== null && next > old;
}
