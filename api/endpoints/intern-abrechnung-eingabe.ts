import { pflegeHandler, ok, readJsonBody } from '../lib/pflege-api';
import { parseSession, validAbrechnungSession } from '../lib/abrechnung-session';
import {
  abrechnungDeleteAfter,
  getAbrechnungEingabe,
  saveAbrechnungEingabe,
} from '../lib/abrechnung-eingabe';
import { getCampflowEvents } from '../lib/campflow';
import { ValidationError } from '../lib/pflege-validation';
import { EVENT_ID_PATTERN } from './intern-abrechnung';
import { withErrorHandling } from '../lib/response-utils';

/** Never accept a retention date from the browser, including when reading older drafts. */
async function currentRetention(id: string): Promise<string | null> {
  const event = (await getCampflowEvents()).find((entry) => entry.id === id);
  if (!event) return null;
  const end = (event.end_date ?? event.start_date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end))
    throw new ValidationError({
      session: 'Bitte trage zuerst ein Datum für die Aktion in CampFlow ein.',
    });
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
    const body = (await readJsonBody(request)) as { session?: unknown; etag?: unknown };
    if (
      !body ||
      typeof body !== 'object' ||
      !body.session ||
      typeof body.session !== 'object' ||
      JSON.stringify(body.session).length > 100_000 ||
      !(body.etag === null || typeof body.etag === 'string')
    ) {
      throw new ValidationError({
        session: 'Die Eingaben konnten nicht gespeichert werden. Bitte prüfe die Felder.',
      });
    }
    const deleteAfter = await currentRetention(id);
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
