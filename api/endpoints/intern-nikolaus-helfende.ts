import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { EinteilungDay } from '../lib/nikolaus-einteilung';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import { getAllBookings, getBooking, setBookingTags } from '../lib/nikolaus-bookings';
import { toStaffBooking } from '../lib/nikolaus-api';
import { NIKOLAUS_CONFIG, getNikolausTeams } from '../lib/nikolaus-config';
import { getAllDispoRows } from '../lib/nikolaus-dispo-list';
import {
  deleteEinteilungOfPerson,
  getEinteilungRows,
  getEinteilungVersion,
  renameInEinteilung,
  saveEinteilung,
} from '../lib/nikolaus-einteilung-list';
import type { EinteilungRow } from '../lib/nikolaus-einteilung-list';
import {
  createHelper,
  deleteHelper,
  getHelpers,
  updateHelper,
} from '../lib/nikolaus-helfende-list';
import { normalizeTag } from '../lib/nikolaus-einteilung';
import { getGraphStatus } from '../lib/sharepoint-data-access';
import { SharePointRestError } from '../lib/sharepoint-rest';
import {
  validateBookingTags,
  validateEinteilungSave,
  validateHelper,
} from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  CONFLICT,
  NO_CONTENT,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

function configuredDates(): string[] {
  return [...NIKOLAUS_CONFIG.days].map((day) => day.date).sort();
}

/** All tags in use (helpers and bookings), for the suggestions; first spelling wins. */
function collectTags(lists: string[][]): string[] {
  const tags = new Map<string, string>();
  for (const tag of lists.flat()) {
    const key = normalizeTag(tag);
    if (!tags.has(key)) tags.set(key, tag);
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

function toClientRow(row: EinteilungRow) {
  return {
    personId: row.personId,
    date: row.date,
    team: row.team,
    role: row.role,
    fixed: row.fixed,
  };
}

/**
 * Per configured day the teams and the tags of the families on each team's route, taken from
 * the saved Dispo. Days without a saved Dispo get `familyTags: null`.
 */
async function getEinteilungDays(bookings: NikolausBooking[]): Promise<EinteilungDay[]> {
  const dispoRows = await getAllDispoRows();
  const confirmed = new Map(
    bookings.filter((b) => b.status === 'Bestaetigt').map((b) => [b.id, b])
  );
  return configuredDates().map((date) => {
    const teams = getNikolausTeams(date).map((team) => team.name);
    const rows = dispoRows.filter((row) => row.date === date);
    if (rows.length === 0) return { date, teams, familyTags: null };
    const familyTags: Record<string, string[][]> = Object.fromEntries(teams.map((t) => [t, []]));
    for (const row of rows) {
      const booking = confirmed.get(row.bookingId);
      if (booking && booking.slotKey.startsWith(`${date}T`) && familyTags[row.team]) {
        familyTags[row.team].push(booking.internalTags);
      }
    }
    return { date, teams, familyTags };
  });
}

/** GET: all helpers with the tags in use and the configured days. */
export async function GetInternNikolausHelfendeEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const [helpers, bookings] = await Promise.all([getHelpers(), getAllBookings()]);
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      persons: helpers,
      tags: collectTags([
        ...helpers.flatMap((h) => [h.positiveTags, h.negativeTags]),
        ...bookings.map((b) => b.internalTags),
      ]),
      days: configuredDates().map((date) => ({
        date,
        teams: getNikolausTeams(date).map((team) => team.name),
      })),
    },
  };
}

/** GET: helpers, days with the family tags per team and the saved Einteilung. */
export async function GetInternNikolausEinteilungEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const [helpers, bookings, rows] = await Promise.all([
    getHelpers(),
    getAllBookings(),
    getEinteilungRows(),
  ]);
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      persons: helpers,
      days: await getEinteilungDays(bookings),
      rows: rows.map(toClientRow),
      version: getEinteilungVersion(rows),
    },
  };
}

/** POST: adds a helper. */
export const NikolausHelfendeCollection = pflegeHandler(
  'nikolaus-helfende',
  async (request: HttpRequest) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const input = validateHelper(await readJsonBody(request), configuredDates());
    const id = await createHelper(input);
    return ok({ id }, 201);
  }
);

/** PATCH: updates a helper (etag); DELETE: removes a helper and their Einteilung. */
export const NikolausHelfendeItem = pflegeHandler(
  'nikolaus-helfende',
  async (request: HttpRequest, context: InvocationContext) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    if (request.method === 'DELETE') {
      try {
        await deleteHelper(id, readIfMatch(request));
      } catch (error: unknown) {
        // Already deleted (e.g. retry after a failed cleanup): still remove the Einteilung
        const status = error instanceof SharePointRestError ? error.status : getGraphStatus(error);
        if (status !== 404) throw error;
      }
      await deleteEinteilungOfPerson(id);
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateHelper(body, configuredDates());
    await updateHelper(id, input, readEtag(body));
    try {
      // Only for reading the list in SharePoint; the Einteilung itself uses the ID
      await renameInEinteilung(id, input.name);
    } catch (error: unknown) {
      context.warn('Updating the name in the Einteilung failed', error);
    }
    return NO_CONTENT;
  }
);

/** PUT: replaces the internal tags of a booking. Never shown to the family. */
export const NikolausBookingTags = pflegeHandler('nikolaus-tags', async (request: HttpRequest) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const id = request.params.id ?? '';
  if (!/^\d+$/.test(id)) return NOT_FOUND;
  const body = await readJsonBody(request);
  const tags = validateBookingTags(body);
  const booking = await getBooking(id);
  if (!booking) return NOT_FOUND;
  const etag = readEtag(body);
  if (!etag || etag === '*' || etag !== booking.etag) {
    return CONFLICT;
  }
  await setBookingTags(id, tags, etag);
  const saved = await getBooking(id);
  if (!saved) return CONFLICT;
  return ok({ booking: toStaffBooking(saved, new Date()) });
});

/** PUT: saves the whole Einteilung. Answers with the saved rows and their new version. */
export const NikolausEinteilungSave = pflegeHandler(
  'nikolaus-einteilung',
  async (request: HttpRequest) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const [helpers, existing] = await Promise.all([getHelpers(), getEinteilungRows()]);
    const teamsByDate = new Map(
      configuredDates().map((date) => [date, getNikolausTeams(date).map((t) => t.name)])
    );
    const input = validateEinteilungSave(
      await readJsonBody(request),
      teamsByDate,
      new Set(helpers.map((h) => h.id))
    );
    await saveEinteilung(
      input.assignments,
      existing,
      new Map(helpers.map((h) => [h.id, h.name])),
      input.version
    );
    const rows = await getEinteilungRows();
    return ok({ rows: rows.map(toClientRow), version: getEinteilungVersion(rows) });
  }
);

export const NikolausHelfende = withErrorHandling(GetInternNikolausHelfendeEndpoint);
export const NikolausEinteilung = withErrorHandling(GetInternNikolausEinteilungEndpoint);
export const NikolausHelfendeCollectionEndpoint = withErrorHandling(NikolausHelfendeCollection);
export const NikolausHelfendeItemEndpoint = withErrorHandling(NikolausHelfendeItem);
export const NikolausBookingTagsEndpoint = withErrorHandling(NikolausBookingTags);
export const NikolausEinteilungSaveEndpoint = withErrorHandling(NikolausEinteilungSave);
