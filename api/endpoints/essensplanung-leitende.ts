import { getDb } from '../lib/db';
import { istStammAdresse } from '../lib/essen-leitung-model';
import { darfMitgliederVerwalten } from '../lib/essen-planung-model';
import { planungHandler, zugangVon } from '../lib/essen-planung-http';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { METHOD_NOT_ALLOWED } from '../lib/pflege-api';
import { errorResponse } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { readTaskDirectory } from '../lib/task-directory';

const NICHT_ERLAUBT = errorResponse(
  403,
  'NICHT_ERLAUBT',
  'Mitglieder einladen dürfen nur Besitzer:innen der Planung (oder, wenn sie es erlauben, alle Bearbeitenden).'
);

const KEINE_STAMM_ADRESSE = errorResponse(
  403,
  'KEINE_STAMM_ADRESSE',
  'Die Leitenden des Stammes siehst du hier nur, wenn du im Leitendenbereich mit deinem Stammes-Konto angemeldet bist.'
);

const VERZEICHNIS_FEHLT = errorResponse(
  502,
  'VERZEICHNIS_FEHLT',
  'Die Liste der Leitenden konnte gerade nicht geladen werden. Lade sie neu oder lade die Person per Mail ein.'
);

/**
 * GET: the Leitende of the team „Leitende“ with name and address, to invite one with a click
 * (`docs/essensplanung.md`, „Leitende einladen“). Only for those who may invite in this Planung
 * and who are logged in to the Leitendenbereich with an address of the Stamm at the same time,
 * so a link alone never shows the Leitende.
 */
export const EssensplanungLeitende = planungHandler(async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('mitglieder_verwalten')
    .where('id', '=', zugang.planungId)
    .executeTakeFirstOrThrow();
  if (!darfMitgliederVerwalten(zugang.zugang, planung.mitglieder_verwalten)) return NICHT_ERLAUBT;
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (!istStammAdresse(principal.userDetails)) return KEINE_STAMM_ADRESSE;
  let leitende;
  try {
    leitende = await readTaskDirectory();
  } catch {
    return VERZEICHNIS_FEHLT;
  }
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      leitende: leitende
        .map((person) => ({ name: person.name, email: person.login }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    },
  };
});
