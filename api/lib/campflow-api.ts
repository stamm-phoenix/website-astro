import type { HttpResponseInit } from '@azure/functions';
import { CampflowError } from './campflow';
import { errorResponse } from './response-utils';

/** Maps CampFlow errors to API responses; other errors are rethrown. */
export function campflowErrorResponse(error: unknown): HttpResponseInit {
  if (!(error instanceof CampflowError)) throw error;

  switch (error.status) {
    case 401:
    case 402:
    case 403:
      return errorResponse(
        502,
        'CAMPFLOW_FORBIDDEN',
        'Der Zugriff auf CampFlow wurde verweigert. Bitte prüfe das API-Token.'
      );
    case 404:
      return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
    default:
      return errorResponse(
        502,
        'CAMPFLOW_UNAVAILABLE',
        'CampFlow ist gerade nicht erreichbar. Bitte versuche es später erneut.'
      );
  }
}
