import { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import { getAktionen, Aktion, isLeitendeOnly } from '../lib/aktionen-list';
import { withErrorHandling, withEtag } from '../lib/response-utils';

interface AktionData {
  id: string;
  stufen: string[];
  title: string;
  campflow_link?: string | undefined;
  description?: string | undefined;
  start: string;
  end: string;
}

/**
 * Filters aktionen to exclude those that are only for "Leitende".
 */
function filterVisibleAktionen(aktionen: Aktion[]): Aktion[] {
  return aktionen.filter((a) => !isLeitendeOnly(a));
}

export async function GetAktionenEndpointInternal(
  request: HttpRequest,
  context: InvocationContext,
  filteredAktionen: Aktion[]
): Promise<HttpResponseInit> {
  const data: AktionData[] = filteredAktionen.map((a) => {
    return {
      id: a.id,
      stufen: a.stufen,
      title: a.title,
      campflow_link: a.campflow_link,
      description: a.description,
      start: a.start,
      end: a.end,
    };
  });

  return {
    status: 200,
    jsonBody: data,
  };
}

export default withErrorHandling(
  withEtag(GetAktionenEndpointInternal, async () => {
    const aktionen = await getAktionen();
    const filteredAktionen = filterVisibleAktionen(aktionen);
    return {
      tags: filteredAktionen.map((a) => a.eTag),
      data: filteredAktionen,
    };
  })
);
