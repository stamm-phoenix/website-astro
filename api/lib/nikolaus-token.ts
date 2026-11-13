import { createHash, timingSafeEqual } from 'node:crypto';

/** The SHA-256 of a management token, as stored in `nikolaus.booking.token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two stored hashes, e.g. the hash of the token a request sent
 * (computed once) against the hash of a booking.
 */
export function sameTokenHash(stored: string, expected: string): boolean {
  if (!stored || !expected) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time comparison of a plain token against the stored hash. */
export function verifyToken(booking: { tokenHash: string }, token: string): boolean {
  if (!booking.tokenHash || !token) return false;
  return sameTokenHash(booking.tokenHash, hashToken(token));
}
