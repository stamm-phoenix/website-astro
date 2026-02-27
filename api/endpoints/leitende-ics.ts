import type { HttpResponseInit } from '@azure/functions';
import { getAktionen, isLeitendeOnly } from '../lib/aktionen-list';
import { buildIcs } from '../lib/ics-builder';
import { withErrorHandling } from '../lib/response-utils';

export async function GetLeitendeIcsEndpoint(): Promise<HttpResponseInit> {
  const aktionen = await getAktionen();
  const filteredAktionen = aktionen.filter((a) => isLeitendeOnly(a));

  const icsBody = buildIcs(filteredAktionen, 'DPSG Stamm Phoenix - Leitende');

  return {
    status: 200,
    body: icsBody,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leitende.ics"',
    },
  };
}

export default withErrorHandling(GetLeitendeIcsEndpoint);
