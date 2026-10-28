import { z } from 'zod';
import { pflegeHandler, ok, readJsonBody } from '../lib/pflege-api';
import { parseSession, sessionSizeOk, validAbrechnungSession } from '../lib/abrechnung-session';
import {
  abrechnungDeleteAfter,
  getAbrechnungEingabe,
  saveAbrechnungEingabe,
} from '../lib/abrechnung-eingabe';
import { getCampflowEvents } from '../lib/campflow';
import { ValidationError } from '../lib/validation/errors';
import { parseWith } from '../lib/validation/zod';
import { EVENT_ID_PATTERN } from './intern-abrechnung';
import { withErrorHandling } from '../lib/response-utils';

const SAVE_MESSAGE = 'Die Eingaben konnten nicht gespeichert werden. Bitte prüfe die Felder.';

/** The body of a save: a session object that is not oversized, and the version of the draft read. */
const saveBodySchema = z.object(
  {
    session: z.custom<Record<string, unknown>>(
      (session) =>
        session !== null &&
        typeof session === 'object' &&
        sessionSizeOk(session as Record<string, unknown>),
      { error: SAVE_MESSAGE }
    ),
    etag: z.string({ error: SAVE_MESSAGE }).nullable(),
  },
  { error: SAVE_MESSAGE }
);

/** Never accept a retention date from the browser, including when reading older drafts. */
async function currentRetention(id: string, requireDate = false): Promise<string | null> {
  const event = (await getCampflowEvents()).find((entry) => entry.id === id);
  if (!event) return null;
  const end = (event.end_date ?? event.start_date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    if (!requireDate) return null;
    throw new ValidationError({
      session: 'Bitte trage zuerst ein Datum für die Aktion in CampFlow ein.',
    });
  }
  return abrechnungDeleteAfter(end);
}

export const AbrechnungEingabeEndpoint = pflegeHandler(
  'abrechnung-eingabe',
  async (request, _context, principal) => {
    const id = request.params.id ?? '';
    if (!EVENT_ID_PATTERN.test(id) || id.length > 128)
      throw new ValidationError({ id: 'Ungültige Aktion.' });
    if (request.method === 'GET')
      return ok(await getAbrechnungEingabe(principal.userId, id, await currentRetention(id)));
    const body = parseWith(saveBodySchema, await readJsonBody(request), () => 'session');
    const deleteAfter = await currentRetention(id, true);
    if (deleteAfter === null)
      return ok(
        {
          message:
            'Diese Aktion gibt es nicht mehr. Deine Eingaben bleiben auf der Seite erhalten.',
        },
        404
      );
    if (deleteAfter < new Date().toISOString().slice(0, 10)) {
      return ok(
        {
          message: 'Die Aufbewahrungsfrist ist abgelaufen. Die Eingaben wurden nicht gespeichert.',
        },
        410
      );
    }
    const session = parseSession(body.session);
    if (!validAbrechnungSession(body.session))
      throw new ValidationError({
        session: 'Die Eingaben sind unvollständig oder ungültig. Es wurde nichts gespeichert.',
      });
    return ok(
      await saveAbrechnungEingabe(
        principal.userId,
        id,
        principal.userDetails,
        session,
        body.etag,
        deleteAfter
      )
    );
  }
);
export const AbrechnungEingabeHandler = withErrorHandling(AbrechnungEingabeEndpoint);
