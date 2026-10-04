import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { Bilanz, PersonenZahlen } from '../lib/abrechnung';
import { costUnitForEvent, countPersons, summarizeEntries } from '../lib/abrechnung';
import type { CampflowEvent, CampflowPerson } from '../lib/campflow';
import { campflowGetAll, getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import type { EinzelnachweiseResponse } from '../lib/playwright-api';
import { getEinzelnachweise, playwrightErrorResponse } from '../lib/playwright-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;
const MAX_COST_UNIT_LENGTH = 200;

/** Financial overview of an Aktion; only sums, no personal data. */
export interface Abrechnung {
  event: { id: string; title: string; start_date: string | null; end_date: string | null };
  costUnit: { id: string; name: string };
  persons: PersonenZahlen;
  bilanz: Bilanz;
}

/**
 * Participants of a CampFlow event and income/expenses of its Kostenstelle (Einzelnachweise via
 * the Playwright API). `?kostenstelle=` overrides the Kostenstelle derived from the event.
 */
export async function GetInternAbrechnungEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const id = request.params.id ?? '';
  if (!EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }
  const requested = request.query.get('kostenstelle')?.trim() ?? '';
  if (requested.length > MAX_COST_UNIT_LENGTH) {
    return errorResponse(400, 'INVALID_KOSTENSTELLE', 'Ungültige Kostenstelle.');
  }

  let events: CampflowEvent[];
  let persons: CampflowPerson[];
  try {
    [events, persons] = await Promise.all([
      getCampflowEvents(),
      campflowGetAll<CampflowPerson>(`/lists/${encodeURIComponent(id)}/persons`),
    ]);
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }

  const event = events.find((e) => e.id === id);
  if (!event) {
    return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
  }

  const costUnit = requested || costUnitForEvent(event);
  let report: EinzelnachweiseResponse;
  try {
    report = await getEinzelnachweise(costUnit);
  } catch (error: unknown) {
    return playwrightErrorResponse(error, costUnit);
  }

  const body: Abrechnung = {
    event: {
      id: event.id,
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date,
    },
    costUnit: report.costUnit,
    persons: countPersons(persons, event.start_date),
    bilanz: summarizeEntries(report.entries),
  };
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
}

export default withErrorHandling(GetInternAbrechnungEndpoint);
