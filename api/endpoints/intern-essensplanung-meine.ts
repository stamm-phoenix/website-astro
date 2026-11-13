import { app } from '@azure/functions';
import { leitungPlanungen } from '../lib/essen-leitung';
import { leitungPlanungAnlegen } from '../lib/essen-leitung-anlegen';
import { anzeigeName, istStammAdresse } from '../lib/essen-leitung-model';
import { mapPlanungErrors } from '../lib/essen-planung-http';
import { validateLeitungAnlegen } from '../lib/essen-planung-validation';
import { errorResponse, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { getClaim } from '../lib/staff-auth';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

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
const meinePlanungen: StaffRequestHandler = async (request, _context, principal) => {
  if (!istStammAdresse(principal.userDetails)) return KEINE_STAMM_ADRESSE;
  if (request.method === 'GET') {
    const planungen = await leitungPlanungen(principal.userDetails);
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { planungen } };
  }
  const input = validateLeitungAnlegen(await readJsonBody(request));
  const name = anzeigeName(principal.userDetails, getClaim(principal, ['name']));
  const angelegt = await leitungPlanungAnlegen(principal.userDetails, name, input);
  return { status: 201, headers: NO_STORE_HEADERS, jsonBody: angelegt };
};

const EssensplanungMeine = staffHandler('essensplanung-meine', mapPlanungErrors(meinePlanungen));
export default EssensplanungMeine;

// Essensplanung: the own Planungen of a Leitende:r with an address of the Stamm.
app.http('internEssensplanungMeine', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/meine',
  handler: EssensplanungMeine,
});
