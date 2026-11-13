import { app, type HttpResponseInit } from '@azure/functions';
import { berlinDay } from '../lib/calendar-day';
import { CampflowError, getCampflowMembersWithTime } from '../lib/campflow';
import { gleicheAb } from '../lib/nami-abgleich';
import { getNamiMitglieder, NamiError } from '../lib/nami';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { hasTeam } from '../lib/staff-auth';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Den Nami-Abgleich sehen nur die Teams Admin und Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

function namiErrorResponse(error: NamiError): HttpResponseInit {
  if (error.status === 401) {
    return errorResponse(
      502,
      'NAMI_FORBIDDEN',
      'Die Anmeldung bei NaMi hat nicht geklappt. Bitte melde dich bei admin@stamm-phoenix.de.'
    );
  }
  return errorResponse(
    502,
    'NAMI_UNAVAILABLE',
    'NaMi ist gerade nicht erreichbar. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
  );
}

function campflowErrorResponse(error: CampflowError): HttpResponseInit {
  if (error.status === 401 || error.status === 402 || error.status === 403) {
    return errorResponse(
      502,
      'CAMPFLOW_FORBIDDEN',
      'Die Mitgliederliste ist für die Website in CampFlow nicht freigegeben. Bitte melde dich bei admin@stamm-phoenix.de.'
    );
  }
  return errorResponse(
    502,
    'CAMPFLOW_UNAVAILABLE',
    'Die Mitgliederliste konnte nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
  );
}

/**
 * How long the answer waits for the CampFlow member list, whose pages load one after another,
 * each with its own time limit. NaMi keeps to its own budget (`nami.ts`); both stay below the
 * 30 seconds the browser waits for a read (`web/src/lib/apiTimeout.ts`), so the browser gets
 * this answer instead of giving up and asking again. The shared load goes on and serves the next
 * request.
 */

/** `promise`, or the error of `timeout` once the budget is used up. */
function withinBudget<T>(promise: Promise<T>, timeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeout()), 25_000);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/**
 * Compares the members in NaMi with the CampFlow member list, read-only and only for the teams
 * Admin and Vorstand (`docs/nami-abgleich.md`). Both lists are shared for a while;
 * `?refresh=true` reads both again. Nothing is stored and nothing is written to NaMi or CampFlow.
 */
const getInternNamiAbgleich: StaffRequestHandler = async (request, _context, principal) => {
  if (!hasTeam(principal, 'admin') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;

  const refresh = request.query.get('refresh') === 'true';
  const [nami, campflow] = await Promise.allSettled([
    getNamiMitglieder(refresh),
    withinBudget(
      getCampflowMembersWithTime(refresh),
      () => new CampflowError(504, 'CampFlow member list took too long')
    ),
  ]);
  for (const result of [nami, campflow]) {
    if (result.status === 'fulfilled') continue;
    if (result.reason instanceof NamiError) return namiErrorResponse(result.reason);
    if (result.reason instanceof CampflowError) return campflowErrorResponse(result.reason);
    throw result.reason;
  }
  if (nami.status !== 'fulfilled' || campflow.status !== 'fulfilled')
    throw new Error('unreachable');

  const persons = campflow.value.value.filter((person) => typeof person.id === 'string');
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: gleicheAb(nami.value.value, persons, berlinDay(), {
      nami: nami.value.loadedAt,
      campflow: campflow.value.loadedAt,
    }),
  };
};

export const GetInternNamiAbgleichEndpoint = staffHandler('nami-abgleich', getInternNamiAbgleich);

export default GetInternNamiAbgleichEndpoint;

app.http('internNamiAbgleich', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nami-abgleich',
  handler: GetInternNamiAbgleichEndpoint,
});
