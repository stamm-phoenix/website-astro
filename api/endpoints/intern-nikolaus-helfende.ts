import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { EinteilungDay } from '../lib/nikolaus-einteilung';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import {
  getAllBookingTags,
  getAllBookings,
  getBooking,
  setBookingTags,
} from '../lib/nikolaus-bookings';
import { toStaffBooking } from '../lib/nikolaus-api';
import type { NikolausConfig } from '../lib/nikolaus-config';
import { getNikolausTeams } from '../lib/nikolaus-config';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { isNikolausStaffError, readAsNikolausStaff, nikolausGate } from '../lib/nikolaus-staff';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import { getAllDispoRows } from '../lib/nikolaus-dispo-list';
import {
  getEinteilungRows,
  getEinteilungVersion,
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
import { RecordNotFoundError } from '../lib/db';
import { validateBookingTags, validateHelper } from '../lib/validation/nikolaus-helfende';
import { validateEinteilungSave } from '../lib/validation/nikolaus-einteilung';
import { NOT_FOUND, CONFLICT, NO_CONTENT, ok, readEtag, readIfMatch } from '../lib/pflege-api';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { publicHandler, staffHandler } from '../lib/handler';

function configuredDates(config: NikolausConfig): string[] {
  return [...config.days].map((day) => day.date).sort();
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
function getEinteilungDays(
  bookings: NikolausBooking[],
  dispoRows: DispoRow[],
  config: NikolausConfig
): EinteilungDay[] {
  const confirmed = new Map(
    bookings.filter((b) => b.status === 'Bestaetigt').map((b) => [b.id, b])
  );
  return configuredDates(config).map((date) => {
    const teams = getNikolausTeams(date, config).map((team) => team.name);
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
  const access = await readAsNikolausStaff(request, () =>
    Promise.all([getHelpers(), getAllBookingTags()])
  );
  if (isNikolausStaffError(access)) return access;
  const {
    config,
    data: [helpers, bookingTags],
  } = access;

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      persons: helpers,
      tags: collectTags([
        ...helpers.flatMap((h) => [h.positiveTags, h.negativeTags]),
        ...bookingTags,
      ]),
      days: configuredDates(config).map((date) => ({
        date,
        teams: getNikolausTeams(date, config).map((team) => team.name),
      })),
    },
  };
}

/** GET: helpers, days with the family tags per team and the saved Einteilung. */
export async function GetInternNikolausEinteilungEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const access = await readAsNikolausStaff(request, () =>
    Promise.all([getHelpers(), getAllBookings(), getEinteilungRows(), getAllDispoRows()])
  );
  if (isNikolausStaffError(access)) return access;
  const {
    config,
    data: [helpers, bookings, rows, dispoRows],
  } = access;

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      persons: helpers,
      days: getEinteilungDays(bookings, dispoRows, config),
      rows: rows.map(toClientRow),
      version: getEinteilungVersion(rows),
    },
  };
}

/** POST: adds a helper. */
export const NikolausHelfendeCollection = staffHandler(
  'nikolaus-helfende',
  async (request: HttpRequest) => {
    const input = validateHelper(
      await readJsonBody(request),
      configuredDates(await getNikolausSettings())
    );
    const id = await createHelper(input);
    return ok({ id }, 201);
  },
  { gate: nikolausGate }
);

/** PATCH: updates a helper (etag); DELETE: removes a helper and their Einteilung. */
export const NikolausHelfendeItem = staffHandler(
  'nikolaus-helfende',
  async (request: HttpRequest) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    if (request.method === 'DELETE') {
      // Availability and Einteilung of the person are deleted with them
      try {
        await deleteHelper(id, readIfMatch(request));
      } catch (error: unknown) {
        // Already deleted, e.g. a retry after a lost response
        if (!(error instanceof RecordNotFoundError)) throw error;
      }
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const input = validateHelper(body, configuredDates(await getNikolausSettings()));
    await updateHelper(id, input, readEtag(body));
    return NO_CONTENT;
  },
  { gate: nikolausGate }
);

/** PUT: replaces the internal tags of a booking. Never shown to the family. */
export const NikolausBookingTags = staffHandler(
  'nikolaus-tags',
  async (request: HttpRequest) => {
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
  },
  { gate: nikolausGate }
);

/** PUT: saves the whole Einteilung. Answers with the saved rows and their new version. */
export const NikolausEinteilungSave = staffHandler(
  'nikolaus-einteilung',
  async (request: HttpRequest) => {
    const [helpers, config] = await Promise.all([getHelpers(), getNikolausSettings()]);
    const teamsByDate = new Map(
      configuredDates(config).map((date) => [
        date,
        getNikolausTeams(date, config).map((t) => t.name),
      ])
    );
    const input = validateEinteilungSave(
      await readJsonBody(request),
      teamsByDate,
      new Set(helpers.map((h) => h.id))
    );
    await saveEinteilung(input.assignments, input.version);
    const rows = await getEinteilungRows();
    return ok({ rows: rows.map(toClientRow), version: getEinteilungVersion(rows) });
  },
  { gate: nikolausGate }
);

export const NikolausHelfende = publicHandler(GetInternNikolausHelfendeEndpoint);
export const NikolausEinteilung = publicHandler(GetInternNikolausEinteilungEndpoint);

app.http('internNikolausHelfende', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/helfende',
  handler: NikolausHelfende,
});

app.http('internNikolausEinteilung', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/einteilung',
  handler: NikolausEinteilung,
});

app.http('internPflegeNikolausHelfende', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-helfende',
  handler: NikolausHelfendeCollection,
});

app.http('internPflegeNikolausHelfendeItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-helfende/{id}',
  handler: NikolausHelfendeItem,
});

app.http('internPflegeNikolausBookingTags', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-bookings/{id}/tags',
  handler: NikolausBookingTags,
});

app.http('internPflegeNikolausEinteilung', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-einteilung',
  handler: NikolausEinteilungSave,
});
