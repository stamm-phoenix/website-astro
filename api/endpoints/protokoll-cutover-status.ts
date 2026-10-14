import type { HttpResponseInit } from '@azure/functions';

/** Public deployment capability only; exposes no data, identity or database state. */
export async function ProtokollCutoverStatus(): Promise<HttpResponseInit> {
  return {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: { protocolBackend: 'sql-gated-v1' },
  };
}
