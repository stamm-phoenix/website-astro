import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { aktionInStufeFeed, isStufeKey, STUFE_KEYS } from '../lib/aktion-stufen';
import { getAktionen } from '../lib/aktionen-list';
import { buildIcs } from '../lib/ics-builder';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function GetAktionenStufeIcsEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const stufe = request.params.stufe ?? '';
  if (!isStufeKey(stufe)) return errorResponse(404, 'NOT_FOUND', 'Diese Stufe gibt es nicht.');

  const aktionen = (await getAktionen()).filter((a) => aktionInStufeFeed(a, stufe));
  const icsBody = buildIcs(aktionen, `DPSG Stamm Phoenix - ${STUFE_KEYS[stufe]}`);

  return {
    status: 200,
    body: icsBody,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="aktionen-${stufe}.ics"`,
    },
  };
}

export default withErrorHandling(GetAktionenStufeIcsEndpoint);
