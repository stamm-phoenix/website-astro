import type { HttpResponseInit } from '@azure/functions';
import { getAktionen, isLeitendeOnly } from '../lib/aktionen-list';
import { buildIcs } from '../lib/ics-builder';
import { publicHandler } from '../lib/handler';

export async function GetAktionenIcsEndpoint(): Promise<HttpResponseInit> {
  const aktionen = await getAktionen();
  const filteredAktionen = aktionen.filter((a) => !isLeitendeOnly(a));

  const icsBody = buildIcs(filteredAktionen, 'DPSG Stamm Phoenix - Aktionen');

  return {
    status: 200,
    body: icsBody,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="aktionen.ics"',
    },
  };
}

export default publicHandler(GetAktionenIcsEndpoint);
