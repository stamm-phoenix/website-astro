import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { leitungPlanungen } from '../lib/essen-leitung';
import { istStammAdresse } from '../lib/essen-leitung-model';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

const KEINE_STAMM_ADRESSE = errorResponse(
  403,
  'KEINE_STAMM_ADRESSE',
  'Deine Essensplanungen gibt es hier nur mit einem Konto auf @stamm-phoenix.de. Öffne sie über die Links aus deinen Mails oder unter „Meine Planungen“ auf der Seite Essensplanung.'
);

/**
 * GET: the Planungen of the Essensplanung where the logged-in Leitende:r is a member with the
 * address of the login, each with a token to open it (`docs/essensplanung.md`, „Zugang aus dem
 * Leitendenbereich“).
 */
export async function EssensplanungMeineEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (!istStammAdresse(principal.userDetails)) return KEINE_STAMM_ADRESSE;
  const planungen = await leitungPlanungen(principal.userDetails);
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { planungen } };
}

export default withErrorHandling(EssensplanungMeineEndpoint);
