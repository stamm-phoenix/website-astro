import type { HttpResponseInit } from '@azure/functions';
import type { Leitende } from '../lib/leitende-list';
import { getLeitende } from '../lib/leitende-list';
import { withErrorHandling } from '../lib/response-utils';

interface VorstandData {
  id: string;
  name: string;
  telephone: string | undefined;
  street: string | undefined;
  city: string | undefined;
  hasImage: boolean;
}

/**
 * Helper function to fetch and filter Leitende for the "Vorstand" team.
 */
async function getVorstandLeitende(): Promise<Leitende[]> {
  const leitende: Leitende[] = await getLeitende();
  return leitende.filter((l) => l.teams.includes('Vorstand'));
}

export async function GetVorstandEndpoint(): Promise<HttpResponseInit> {
  const vorstandLeitende = await getVorstandLeitende();

  const vorstaende = vorstandLeitende.map((l): VorstandData => {
    return {
      id: l.id,
      name: l.name,
      city: l.city,
      street: l.street,
      telephone: l.telephone,
      hasImage: l.hasImage,
    };
  });

  return {
    status: 200,
    jsonBody: vorstaende,
  };
}

export default withErrorHandling(GetVorstandEndpoint);
