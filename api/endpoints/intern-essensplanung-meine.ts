import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { leitungPlanungen } from '../lib/essen-leitung';
import { leitungPlanungAnlegen } from '../lib/essen-leitung-anlegen';
import { anzeigeName, istStammAdresse } from '../lib/essen-leitung-model';
import { planungHandler } from '../lib/essen-planung-http';
import { validateLeitungAnlegen } from '../lib/essen-planung-validation';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { METHOD_NOT_ALLOWED, readJsonBody } from '../lib/pflege-api';
import { errorResponse } from '../lib/response-utils';
import { getClaim, isStaffError, requireStaff } from '../lib/staff-auth';

const KEINE_STAMM_ADRESSE = errorResponse(
  403,
  'KEINE_STAMM_ADRESSE',
  'Deine Essensplanungen gibt es hier nur mit einem Konto auf @stamm-phoenix.de. Öffne sie über die Links aus deinen Mails oder unter „Meine Planungen“ auf der Seite Essensplanung.'
);

/**
 * The own Planungen of a Leitende:r with an address of the Stamm (`docs/essensplanung.md`,
 * „Zugang aus dem Leitendenbereich“).
 *
 * - GET: the Planungen where the address of the login is a member, each with a token to open it.
 * - POST `{ planungName, ersterTag, letzterTag }`: creates a Planung with the Leitende:r as owner
 *   at once and answers with the token to open it (201).
 */
export async function EssensplanungMeineEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (!istStammAdresse(principal.userDetails)) return KEINE_STAMM_ADRESSE;
  if (request.method === 'GET') {
    const planungen = await leitungPlanungen(principal.userDetails);
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { planungen } };
  }
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const input = validateLeitungAnlegen(await readJsonBody(request));
  const name = anzeigeName(principal.userDetails, getClaim(principal, ['name']));
  const angelegt = await leitungPlanungAnlegen(principal.userDetails, name, input);
  return { status: 201, headers: NO_STORE_HEADERS, jsonBody: angelegt };
}

const defaultHandler = planungHandler(EssensplanungMeineEndpoint);
export default defaultHandler;

// Essensplanung: the own Planungen of a Leitende:r with an address of the Stamm.
app.http('internEssensplanungMeine', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/meine',
  handler: defaultHandler,
});
