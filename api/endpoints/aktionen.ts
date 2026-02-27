import type { HttpResponseInit } from '@azure/functions';
import type { Aktion } from '../lib/aktionen-list';
import { getAktionen, isLeitendeOnly } from '../lib/aktionen-list';
import { withErrorHandling } from '../lib/response-utils';

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

export async function GetAktionenEndpoint(): Promise<HttpResponseInit> {
  const aktionen = await getAktionen();
  const filteredAktionen = filterVisibleAktionen(aktionen);

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

export default withErrorHandling(GetAktionenEndpoint);
