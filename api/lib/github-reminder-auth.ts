import { createPublicKey, verify } from 'node:crypto';
import { CONFIG } from './config';

const ISSUER = 'https://token.actions.githubusercontent.com';
interface SigningKey {
  kid: string;
  kty: 'RSA';
  n: string;
  e: string;
}
let cached: { expires: number; keys: SigningKey[] } | undefined;
let lastRefresh = 0;
let loading: Promise<SigningKey[]> | undefined;

async function keys(): Promise<SigningKey[]> {
  if (cached && cached.expires > Date.now()) return cached.keys;
  loading ??= (async () => {
    const response = await fetch(`${ISSUER}/.well-known/jwks`, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('GitHub signing keys unavailable');
    const body = await response.text();
    if (body.length > 65536) throw new Error('Invalid signing keys');
    const parsed: unknown = JSON.parse(body);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { keys?: unknown }).keys)
    )
      throw new Error('Invalid signing keys');
    const result = (parsed as { keys: unknown[] }).keys.filter((key): key is SigningKey => {
      if (!key || typeof key !== 'object') return false;
      const value = key as Record<string, unknown>;
      return (
        value.kty === 'RSA' &&
        typeof value.kid === 'string' &&
        typeof value.n === 'string' &&
        typeof value.e === 'string'
      );
    });
    lastRefresh = Date.now();
    cached = { expires: Date.now() + 5 * 60_000, keys: result };
    return result;
  })();
  try {
    return await loading;
  } finally {
    loading = undefined;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JWT');
  return value as Record<string, unknown>;
}

/** Signed GitHub identity for this repository's scheduled main workflow only; no shared secret. */
export async function verifyTaskReminderToken(token: string | null): Promise<boolean> {
  try {
    if (!token || token.length > 16384) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const header = object(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
    const claims = object(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
    const config = CONFIG.taskReminders;
    const now = Date.now() / 1000;
    if (
      header.alg !== 'RS256' ||
      typeof header.kid !== 'string' ||
      claims.iss !== ISSUER ||
      claims.aud !== config.oidcAudience ||
      claims.sub !== `repo:${config.repository}:ref:refs/heads/main` ||
      claims.repository !== config.repository ||
      claims.ref !== 'refs/heads/main' ||
      claims.event_name !== 'schedule' ||
      claims.workflow_ref !== `${config.repository}/${config.workflow}@refs/heads/main` ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      typeof claims.iat !== 'number' ||
      !Number.isFinite(claims.iat) ||
      claims.iat > now + 30 ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 600 ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now + 30))
    )
      return false;
    let key = (await keys()).find((key) => key.kid === header.kid);
    if (!key && Date.now() - lastRefresh >= 30_000) {
      cached = undefined;
      key = (await keys()).find((key) => key.kid === header.kid);
    }
    return (
      !!key &&
      verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url')
      )
    );
  } catch {
    return false;
  }
}
