import { app, type HttpResponseInit } from '@azure/functions';
import { getLeitende } from '../lib/leitende-list';
import { withErrorHandling } from '../lib/response-utils';

interface LeitendeData {
  id: string;
  name: string;
  teams: string[];
  hasImage: boolean;
}

export async function GetLeitendeEndpoint(): Promise<HttpResponseInit> {
  const leitende = await getLeitende();

  const data = leitende.map((l): LeitendeData => {
    return {
      id: l.id,
      name: l.name,
      teams: l.teams,
      hasImage: l.hasImage,
    };
  });

  return {
    status: 200,
    jsonBody: data,
  };
}

const defaultHandler = withErrorHandling(GetLeitendeEndpoint);
export default defaultHandler;

app.http('leitende', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: defaultHandler,
});
